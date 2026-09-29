import { useEffect, useState } from 'react';
import { db, uuid } from './db.js';
import { getHouseKey } from '../api/client.js';

// Foto offline-first: salvate subito in IndexedDB (tabella files), caricate sul server quando c'e' rete.
// Il sync delle righe porta solo photo_key; il blob si scarica su richiesta e resta in cache locale.

const MAX_SIDE = 1600;
const QUALITY = 0.82;

async function compress(file, maxSide = MAX_SIDE, quality = QUALITY) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file; // formato non decodificabile: lo teniamo com'e'
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((res) => canvas.toBlob((b) => res(b || file), 'image/jpeg', quality));
}

const blobToDataUrl = (b) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(b);
  });

// Foto compressa come data URL (per l'AI). Scontrini: lato lungo maggiore per leggere il testo.
export async function fileToDataUrl(file, maxSide = MAX_SIDE, quality = QUALITY) {
  return blobToDataUrl(await compress(file, maxSide, quality));
}

// Ritorna la photo_key da salvare nella riga.
export async function addPhoto(file, maxSide = MAX_SIDE) {
  const blob = await compress(file, maxSide);
  const id = `ph-${uuid()}`;
  await db.files.put({ id, blob, mime: blob.type || 'image/jpeg', uploaded: 0, at: Date.now() });
  uploadPending();
  return id;
}

let uploading = null;
export function uploadPending() {
  if (uploading) return uploading;
  uploading = (async () => {
    const key = getHouseKey();
    if (!key || !navigator.onLine) return;
    const list = await db.files.where('uploaded').equals(0).toArray();
    for (const f of list) {
      try {
        const res = await fetch(`/api/files/${f.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': f.mime, 'X-House-Key': key },
          body: f.blob,
        });
        if (res.ok) await db.files.update(f.id, { uploaded: 1 });
        else if (res.status === 413 || res.status === 415) await db.files.update(f.id, { uploaded: -1 }); // non ritentare
      } catch {
        break; // rete caduta: riprova al prossimo giro
      }
    }
  })().finally(() => (uploading = null));
  return uploading;
}

const inflight = new Map();
async function loadBlob(id) {
  const local = await db.files.get(id);
  if (local?.blob) return local.blob;
  if (inflight.has(id)) return inflight.get(id);
  const p = (async () => {
    const key = getHouseKey();
    if (!key || !navigator.onLine) return null;
    const res = await fetch(`/api/files/${id}`, { headers: { 'X-House-Key': key } });
    if (!res.ok) return null;
    const blob = await res.blob();
    await db.files.put({ id, blob, mime: blob.type, uploaded: 1, at: Date.now() });
    return blob;
  })()
    .catch(() => null)
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

// URL oggetto per <img>; null finche' non disponibile.
export function usePhoto(id) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!id) return setUrl(null);
    let alive = true;
    let obj = null;
    loadBlob(id).then((b) => {
      if (!alive || !b) return;
      obj = URL.createObjectURL(b);
      setUrl(obj);
    });
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [id]);
  return url;
}

// Backup: foto come data URL (locale o scaricata dal server).
export async function photoToDataUrl(id) {
  const b = await loadBlob(id);
  return b ? blobToDataUrl(b) : null;
}
// Ripristino: rimette la foto in locale e la ricarica sul server se serve.
export async function restorePhoto(id, dataUrl) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id) || !String(dataUrl).startsWith('data:image/')) return false;
  if ((await db.files.get(id))?.blob) return false;
  const blob = await (await fetch(dataUrl)).blob();
  await db.files.put({ id, blob, mime: blob.type || 'image/jpeg', uploaded: 0, at: Date.now() });
  uploadPending();
  return true;
}

// Cancella una foto (es. scontrino dopo il check-in): locale + server.
export async function deletePhoto(id) {
  if (!id) return;
  await db.files.delete(id);
  const key = getHouseKey();
  if (key) await fetch(`/api/files/${id}`, { method: 'DELETE', headers: { 'X-House-Key': key } }).catch(() => {});
}
