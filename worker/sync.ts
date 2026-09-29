// Sync offline-first: i client inviano righe modificate (push) e scaricano quelle con rev > cursore (pull).
// Conflitti: vince la modifica con updated_at piu' recente (last-write-wins, per riga).

export const TABLES: Record<string, string[]> = {
  locations: ['id', 'name', 'area', 'icon', 'sort', 'expiry_warn_days'],
  categories: ['id', 'name', 'area', 'icon', 'default_stock', 'sort', 'by_use'],
  stores: ['id', 'chain', 'branch', 'city'],
  products: [
    'id', 'name', 'area', 'category_id', 'default_unit', 'default_location_id', 'favorite', 'essential',
    'min_stock', 'open_shelf_days', 'freezer_max_months', 'diet_tags', 'alternatives', 'notes',
    'pantry_days', 'fridge_days', 'uses_per_pack',
  ],
  receipts: ['id', 'store_id', 'date', 'total_paid', 'total_discount', 'photo_key', 'notes'],
  purchase_lines: ['id', 'receipt_id', 'product_id', 'qty', 'unit', 'price_paid', 'price_full', 'discount', 'offer_type', 'from_list'],
  stock_lots: [
    'id', 'product_id', 'qty', 'unit', 'location_id', 'expiry_date', 'opened_at', 'frozen_at',
    'purchase_line_id', 'is_leftover', 'note',
  ],
  shopping_items: ['id', 'product_id', 'free_text', 'qty', 'unit', 'origin', 'checked', 'note'],
  extra_expenses: ['id', 'amount', 'date', 'area', 'category', 'note'],
  budgets: ['id', 'month', 'area', 'amount'],
  recipes: [
    'id', 'title', 'servings', 'prep_min', 'cook_min', 'rest_min', 'difficulty', 'tags', 'diet_tags', 'nutrition',
    'photo_key', 'source_url', 'notes', 'favorite', 'cooked_count', 'last_cooked_at', 'course',
    'main_food', 'second_food', 'features', 'rating', 'want_freq',
  ],
  recipe_ingredients: ['id', 'recipe_id', 'product_id', 'text', 'qty', 'unit', 'optional', 'grp', 'sort'],
  recipe_steps: ['id', 'recipe_id', 'sort', 'text', 'timer_min', 'photo_key'],
  substitutions: ['id', 'product_id', 'substitute_id', 'ratio', 'note'],
  events: ['id', 'type', 'product_id', 'recipe_id', 'qty', 'unit', 'value', 'date', 'note'],
  receipt_aliases: ['id', 'text', 'product_id', 'store_chain'],
  meal_plan: [
    'id', 'date', 'meal', 'recipe_id', 'servings', 'note', 'done', 'dish_course', 'dish_main', 'dish_second', 'dish_features',
    'dish_ings', 'leftover_of', 'used_expiring', 'auto', 'done_at',
  ],
  meals: ['id', 'date', 'meal', 'place', 'cost', 'expense_id', 'note'],
  settings: ['id', 'value'],
};
const TABLE_ORDER = Object.keys(TABLES); // ordine utile per le foreign key

export type Change = { table: string; row: Record<string, unknown>; op?: string | null; label?: string | null; undoes?: string | null };
export type PushResult = { applied: number; skipped: number; rejected: number };

const PAGE = 500;
const MAX_PUSH = 500;

function cleanRow(table: string, row: Record<string, unknown>) {
  const cols = TABLES[table];
  if (!cols || typeof row?.id !== 'string' || !row.id) return null;
  const updated_at = Number(row.updated_at);
  if (!Number.isFinite(updated_at)) return null;
  const out: Record<string, unknown> = {};
  for (const c of cols) {
    const v = row[c];
    if (v === undefined) continue; // lascia i default della tabella
    out[c] = typeof v === 'boolean' ? (v ? 1 : 0) : v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
  }
  out.updated_at = updated_at;
  out.deleted = row.deleted ? 1 : 0;
  return out;
}

export async function push(db: D1Database, changes: Change[], device: string): Promise<PushResult> {
  const res: PushResult = { applied: 0, skipped: 0, rejected: 0 };
  if (!Array.isArray(changes) || changes.length === 0) return res;
  if (changes.length > MAX_PUSH) throw new Error('Troppe modifiche in un solo invio');

  const clean: { table: string; row: Record<string, unknown>; op: string | null; label: string | null }[] = [];
  const OP = /^[A-Za-z0-9_-]{4,64}$/;
  const undoes = [...new Set(changes.map((c) => c?.undoes).filter((x): x is string => typeof x === 'string' && OP.test(x)))];
  for (const ch of changes) {
    const row = cleanRow(ch?.table, ch?.row);
    const op = typeof ch?.op === 'string' && OP.test(ch.op) ? ch.op : null;
    const label = typeof ch?.label === 'string' ? ch.label.slice(0, 120) : null;
    if (row) clean.push({ table: ch.table, row, op, label });
    else res.rejected++;
  }
  clean.sort((a, b) => TABLE_ORDER.indexOf(a.table) - TABLE_ORDER.indexOf(b.table));

  // Stato attuale per LWW + before_json della cronologia.
  const existing = new Map<string, Record<string, unknown>>();
  for (const table of new Set(clean.map((c) => c.table))) {
    const ids = clean.filter((c) => c.table === table).map((c) => c.row.id as string);
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const { results } = await db
        .prepare(`SELECT * FROM ${table} WHERE id IN (${chunk.map(() => '?').join(',')})`)
        .bind(...chunk)
        .all<Record<string, unknown>>();
      for (const r of results) existing.set(`${table}:${r.id}`, r);
    }
  }

  const winners = clean.filter(({ table, row }) => {
    const cur = existing.get(`${table}:${row.id}`);
    const ok = !cur || Number(row.updated_at) >= Number(cur.updated_at);
    if (!ok) res.skipped++;
    return ok;
  });
  if (undoes.length) await db.prepare(`UPDATE change_log SET undone = 1 WHERE op_id IN (${undoes.map(() => '?').join(',')})`).bind(...undoes).run();
  if (winners.length === 0) return res;

  // Riserva un blocco di rev in modo atomico.
  const top = await db
    .prepare(`UPDATE sync_meta SET v = v + ? WHERE k = 'rev' RETURNING v`)
    .bind(winners.length)
    .first<{ v: number }>();
  let rev = (top?.v ?? winners.length) - winners.length;

  const now = Date.now();
  const pairs: D1PreparedStatement[][] = [];
  for (const { table, row, op, label } of winners) {
    const stmts: D1PreparedStatement[] = [];
    pairs.push(stmts);
    rev++;
    const full: Record<string, unknown> = { ...row, rev };
    const cols = Object.keys(full);
    const updates = cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ');
    stmts.push(
      db
        .prepare(
          `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
           ON CONFLICT(id) DO UPDATE SET ${updates}`
        )
        .bind(...cols.map((c) => full[c] as string | number | null))
    );
    const before = existing.get(`${table}:${row.id}`);
    stmts.push(
      db
        .prepare(
          'INSERT INTO change_log (id, table_name, row_id, before_json, after_json, device, at, op_id, label) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .bind(crypto.randomUUID(), table, row.id as string, before ? JSON.stringify(before) : null, JSON.stringify(row), device, now, op, label)
    );
  }
  try {
    await db.batch(pairs.flat());
    res.applied = winners.length;
  } catch {
    // Una riga non valida non deve bloccare la coda: applica una per una e scarta le rotte.
    for (const p of pairs) {
      try {
        await db.batch(p);
        res.applied++;
      } catch (e) {
        res.rejected++;
        console.error(JSON.stringify({ level: 'warn', msg: 'riga scartata', err: String(e) }));
      }
    }
  }
  return res;
}

export async function pull(db: D1Database, since: number) {
  // Una query per tabella (D1 limita le UNION), in un solo batch.
  const results = await db.batch(
    TABLE_ORDER.map((t) => db.prepare(`SELECT * FROM ${t} WHERE rev > ? ORDER BY rev LIMIT ${PAGE + 1}`).bind(since))
  );
  const all: (Change & { rev: number })[] = [];
  results.forEach((r, i) => {
    for (const row of (r.results ?? []) as Record<string, unknown>[])
      all.push({ table: TABLE_ORDER[i], row, rev: Number(row.rev) });
  });
  all.sort((a, b) => a.rev - b.rev);
  const more = all.length > PAGE;
  let page = all.slice(0, PAGE);
  // Non spezzare un gruppo con la stessa rev (es. dati iniziali con rev 0).
  if (more) {
    const lastRev = page[page.length - 1].rev;
    const whole = all.filter((c) => c.rev <= lastRev);
    page = whole.length > page.length ? whole : page;
  }
  const cursor = page.length ? page[page.length - 1].rev : since;
  return { changes: page.map(({ table, row }) => ({ table, row })), cursor, more };
}

// ── Annulla da qualsiasi dispositivo ──
// Operazioni recenti (gruppi di modifiche con la stessa etichetta), da tutti i dispositivi.
export async function recentOps(db: D1Database, limit: number) {
  const { results } = await db
    .prepare(
      `SELECT op_id, MAX(label) AS label, MAX(device) AS device, MIN(at) AS at, COUNT(*) AS n, MAX(undone) AS undone
       FROM change_log WHERE op_id IS NOT NULL AND label IS NOT NULL
       GROUP BY op_id ORDER BY MIN(at) DESC LIMIT ?`
    )
    .bind(limit)
    .all();
  return results;
}

// Ripristina lo stato "prima" di un'operazione. Righe modificate dopo (da altre operazioni) = conflitti:
// senza force non si tocca niente e si restituiscono.
export async function undoOp(db: D1Database, opId: string, device: string, force = false) {
  const { results } = await db
    .prepare('SELECT table_name, row_id, before_json, after_json, label, undone FROM change_log WHERE op_id = ? ORDER BY at, rowid')
    .bind(opId)
    .all<{ table_name: string; row_id: string; before_json: string | null; after_json: string; label: string | null; undone: number }>();
  if (!results.length) return { error: 'Operazione non trovata' as const };
  if (results.some((r) => r.undone)) return { error: 'Già annullata' as const };
  // per riga: il "prima" della prima modifica, il "dopo" dell'ultima
  const rows = new Map<string, { table: string; id: string; before: any; after: any }>();
  for (const r of results) {
    const k = `${r.table_name}:${r.row_id}`;
    const cur = rows.get(k);
    if (cur) cur.after = JSON.parse(r.after_json);
    else rows.set(k, { table: r.table_name, id: r.row_id, before: r.before_json ? JSON.parse(r.before_json) : null, after: JSON.parse(r.after_json) });
  }
  const conflicts: string[] = [];
  const changes: Change[] = [];
  const label = `Annullato: ${results.find((r) => r.label)?.label || 'operazione'}`.slice(0, 120);
  const newOp = `undo-${crypto.randomUUID().slice(0, 18)}`;
  let t = Date.now();
  for (const x of rows.values()) {
    if (!TABLES[x.table]) continue;
    const now = await db.prepare(`SELECT * FROM ${x.table} WHERE id = ?`).bind(x.id).first<Record<string, unknown>>();
    if (now && Number(now.updated_at) !== Number(x.after.updated_at)) conflicts.push(`${x.table}:${x.id}`);
    const base = x.before ? { ...x.before } : { ...(now || x.after), deleted: 1 };
    const stamp = Math.max(t++, Number(now?.updated_at ?? 0) + 1);
    changes.push({ table: x.table, row: { ...base, updated_at: stamp }, op: newOp, label });
  }
  if (conflicts.length && !force) return { conflicts };
  const res = await push(db, changes, device);
  await db.prepare('UPDATE change_log SET undone = 1 WHERE op_id = ?').bind(opId).run();
  return { ok: true, applied: res.applied, conflicts };
}
