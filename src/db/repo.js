import { db, uuid } from './db.js';
import { scheduleSync } from './sync.js';

const HISTORY_MAX = 300;

// Scrive una o piu' righe: aggiorna updated_at, accoda per il sync, salva il "prima" per l'annulla.
// ops: [{ table, row }]  (row parziale ok se esiste gia': viene fusa)
export async function save(ops, label) {
  const now = Date.now();
  const tables = [...new Set(ops.map((o) => o.table)), 'outbox', 'history'];
  const saved = await db.transaction('rw', tables, async () => {
    const out = [];
    const before = [];
    let t = now;
    for (const { table, row } of ops) {
      const id = row.id || uuid();
      const cur = await db.table(table).get(id);
      const next = { ...(cur || { deleted: 0 }), ...row, id, updated_at: Math.max(t++, (cur?.updated_at ?? 0) + 1) };
      await db.table(table).put(next);
      await db.outbox.add({ table, id });
      before.push({ table, id, row: cur || null });
      out.push(next);
    }
    if (label) {
      await db.history.add({ at: now, label, before });
      const n = await db.history.count();
      if (n > HISTORY_MAX) {
        const old = await db.history.orderBy('hid').limit(n - HISTORY_MAX).primaryKeys();
        await db.history.bulkDelete(old);
      }
    }
    return out;
  });
  scheduleSync();
  return saved;
}

export const put = (table, row, label) => save([{ table, row }], label).then((r) => r[0]);
export const remove = (table, id, label) => save([{ table, row: { id, deleted: 1 } }], label);

// Annulla un'operazione registrata: ripristina lo stato "prima" (come nuova modifica, cosi' si sincronizza).
export async function undo(hid) {
  const h = hid ? await db.history.get(hid) : await db.history.orderBy('hid').last();
  if (!h) return null;
  const ops = h.before.map(({ table, id, row }) => ({ table, row: row ? { ...row } : { id, deleted: 1 } }));
  await save(ops);
  await db.history.delete(h.hid);
  return h.label;
}
