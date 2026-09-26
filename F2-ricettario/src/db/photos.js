import { useEffect, useState } from 'react';
import { db, uuid } from './db.js';
import { getHouseKey } from '../api/client.js';

// Foto offline-first: salvate subito in IndexedDB (tabella files), caricate sul server quando c'e' rete.
// Il sync delle righe porta solo photo_key; il blob si scarica su richiesta e resta in cache locale.

const MAX_SIDE = 1600;
const QUALITY = 0.82;

async function compress(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file; // formato non decodificabile: lo teniamo com'e'
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return new Promise((res) => canvas.toBlob((b) => res(b || file), 'image/jpeg', QUALITY));
}

// Ritorna la photo_key da salvare nella riga.
export async function addPhoto(file) {
  const blob = await compress(file);
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
