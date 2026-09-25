import { db, SYNC_TABLES, getMeta, setMeta, uuid } from './db.js';
import { getHouseKey } from '../api/client.js';

// Stato osservabile del sync (per badge/UI).
let state = { status: 'idle', last: null, pending: 0, error: null };
const listeners = new Set();
function setState(patch) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}
export const getSyncState = () => state;
export function subscribeSync(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function deviceId() {
  let id = await getMeta('deviceId');
  if (!id) {
    const ua = navigator.userAgent;
    const kind = /Android/.test(ua) ? (/Mobile/.test(ua) ? 'telefono' : 'tablet') : 'pc';
    id = `${kind}-${uuid().slice(0, 6)}`;
    await setMeta('deviceId', id);
  }
  return id;
}

let running = null;
let again = false;

export function syncNow() {
  if (running) {
    again = true;
    return running;
  }
  running = doSync()
    .catch(() => {})
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        syncNow();
      }
    });
  return running;
}

let timer = null;
export function scheduleSync(ms = 1200) {
  clearTimeout(timer);
  timer = setTimeout(syncNow, ms);
  db.outbox.count().then((pending) => setState({ pending }));
}

async function doSync() {
  const key = getHouseKey();
  if (!key) return setState({ status: 'no-key' });
  if (!navigator.onLine) return setState({ status: 'offline', pending: await db.outbox.count() });
  setState({ status: 'syncing', error: null });
  const device = await deviceId();

  try {
    let more = true;
    let rounds = 0;
    while (more && rounds++ < 50) {
      // Push: righe correnti di cio' che e' in coda (dedup per tabella+id).
      const queue = await db.outbox.orderBy('seq').limit(400).toArray();
      const maxSeq = queue.length ? queue[queue.length - 1].seq : 0;
      const seen = new Set();
      const changes = [];
      for (const { table, id } of queue) {
        const k = `${table}:${id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const row = await db.table(table).get(id);
        if (row) changes.push({ table, row });
      }
      const since = await getMeta('cursor', -1);

      const res = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-House-Key': key },
        body: JSON.stringify({ since, changes, device }),
      });
      if (res.status === 401) return setState({ status: 'bad-key' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      await db.transaction('rw', [...SYNC_TABLES, 'outbox', 'meta'], async () => {
        if (maxSeq) await db.outbox.where('seq').belowOrEqual(maxSeq).delete();
        // Pull: LWW, ma non sovrascrivere modifiche locali piu' recenti ancora in coda.
        for (const { table, row } of data.changes) {
          if (!SYNC_TABLES.includes(table)) continue;
          const cur = await db.table(table).get(row.id);
          if (cur && cur.updated_at > row.updated_at) continue;
          const { rev, ...clean } = row;
          await db.table(table).put(clean);
        }
        await db.meta.put({ key: 'cursor', value: data.cursor });
      });

      const left = await db.outbox.count();
      more = data.more || left > 0;
    }
    setState({ status: 'ok', last: Date.now(), pending: await db.outbox.count() });
  } catch (e) {
    setState({ status: navigator.onLine ? 'error' : 'offline', error: e.message, pending: await db.outbox.count() });
  }
}

// Avvio: sync subito, al ritorno online, quando l'app torna in primo piano e ogni 2 minuti.
let started = false;
export function startSync() {
  if (started) return;
  started = true;
  syncNow();
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncNow();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow();
  }, 120000);
}
