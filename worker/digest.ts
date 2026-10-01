// Contenuti delle notifiche calcolati dal server su D1 (stesse regole dell'app).
import { toDish, periodContext, evaluate, goalConfig, weekStartIso, addDaysIso, mealId, OUT_PLACES } from '../src/db/variety.js';

type Row = Record<string, any>;
const FREEZER_DEFAULT_MONTHS = 3;
const TZ = 'Europe/Rome';

// Data/ora locale Italia (ora legale gestita da Intl).
export function romeNow(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    weekday: parts.weekday as string, // Mon..Sun
    day: Number(parts.day),
    month: `${parts.year}-${parts.month}`,
  };
}

const dayNum = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1 + n, +iso.slice(8, 10)));
  return d.toISOString().slice(0, 10);
};

function lotLimit(lot: Row, p: Row): string | null {
  const dates: string[] = [];
  if (lot.expiry_date && !lot.frozen_at) dates.push(lot.expiry_date);
  if (lot.opened_at && p?.open_shelf_days && !lot.frozen_at) dates.push(addDays(lot.opened_at, p.open_shelf_days));
  if (lot.frozen_at) dates.push(addMonths(lot.frozen_at, p?.freezer_max_months || FREEZER_DEFAULT_MONTHS));
  return dates.length ? dates.sort()[0] : null;
}

const label = (days: number) => (days < -1 ? `scaduto da ${-days} gg` : days === -1 ? 'scaduto ieri' : days === 0 ? 'oggi' : days === 1 ? 'domani' : `tra ${days} gg`);

async function all(db: D1Database, sql: string, ...binds: unknown[]) {
  return (await db.prepare(sql).bind(...binds).all<Row>()).results;
}

export async function loadState(db: D1Database, today: string) {
  const [products, lots, locations, categories] = await Promise.all([
    all(db, 'SELECT * FROM products WHERE deleted = 0'),
    all(db, 'SELECT * FROM stock_lots WHERE deleted = 0 AND qty > 0'),
    all(db, 'SELECT * FROM locations WHERE deleted = 0'),
    all(db, 'SELECT * FROM categories WHERE deleted = 0'),
  ]);
  const P = Object.fromEntries(products.map((p) => [p.id, p]));
  const L = Object.fromEntries(locations.map((l) => [l.id, l]));
  const C = Object.fromEntries(categories.map((c) => [c.id, c]));
  const stock: Record<string, number> = {};
  const expiring: { name: string; days: number; warn: number; product_id: string }[] = [];
  for (const lot of lots) {
    const p = P[lot.product_id];
    if (!p) continue;
    stock[p.id] = (stock[p.id] || 0) + Number(lot.qty);
    const lim = lotLimit(lot, p);
    if (!lim) continue;
    const days = dayNum(lim) - dayNum(today);
    const warn = L[lot.location_id]?.expiry_warn_days ?? 7;
    if (days <= warn) expiring.push({ name: p.name, days, warn, product_id: p.id });
  }
  expiring.sort((a, b) => a.days - b.days);
  const below = products.filter((p) => p.essential && (stock[p.id] || 0) < (p.min_stock ?? C[p.category_id]?.default_stock ?? 1));
  return { P, stock, expiring, below };
}

// 9:30: solo se qualcosa entra ora nella finestra di avviso o e' urgente (niente ripetizioni inutili).
export async function dailyMessage(db: D1Database, today: string) {
  const { expiring } = await loadState(db, today);
  const hot = expiring.filter((e) => e.days === e.warn || e.days <= 1);
  if (!hot.length) return null;
  const seen = new Set<string>();
  const items = hot.filter((e) => !seen.has(e.name) && seen.add(e.name));
  const body = items
    .slice(0, 5)
    .map((e) => `${e.name} ${label(e.days)}`)
    .join(' · ');
  return {
    title: `In scadenza (${items.length})`,
    body: items.length > 5 ? `${body} · +${items.length - 5}` : body,
    url: '/dispensa',
    tag: 'scadenze',
  };
}

// Ricette consigliate: tutti gli ingredienti obbligatori in casa, prima quelle che usano roba in scadenza.
async function suggestRecipes(db: D1Database, stock: Record<string, number>, expiringIds: Set<string>, n = 3) {
  const [recipes, ings] = await Promise.all([
    all(db, 'SELECT id, title, last_cooked_at FROM recipes WHERE deleted = 0'),
    all(db, 'SELECT recipe_id, product_id, optional FROM recipe_ingredients WHERE deleted = 0 AND product_id IS NOT NULL'),
  ]);
  const by: Record<string, Row[]> = {};
  for (const i of ings) (by[i.recipe_id] ||= []).push(i);
  return recipes
    .map((r) => {
      const req = (by[r.id] || []).filter((i) => !i.optional);
      const have = req.filter((i) => (stock[i.product_id] || 0) > 0).length;
      return { r, ok: req.length > 0 && have === req.length, urgent: req.filter((i) => expiringIds.has(i.product_id)).length };
    })
    .filter((x) => x.ok)
    .sort((a, b) => b.urgent - a.urgent || String(a.r.last_cooked_at || '').localeCompare(String(b.r.last_cooked_at || '')))
    .slice(0, n)
    .map((x) => x.r.title as string);
}

const euro = (v: number) => `${v.toFixed(2).replace('.', ',')} €`;

// Domenica 20:00: diario (varietà, pasti fuori, pasti da registrare), cosa scade, cosa manca, 3 ricette, spesa della settimana vs budget.
export async function weeklyMessage(db: D1Database, today: string, month: string) {
  const { stock, expiring, below } = await loadState(db, today);
  const weekAgo = addDays(today, -6);
  const [week, spent, budget, planned] = await Promise.all([
    db.prepare('SELECT COALESCE(SUM(total_paid), 0) AS t FROM receipts WHERE deleted = 0 AND date >= ? AND date <= ?').bind(weekAgo, today).first<{ t: number }>(),
    db
      .prepare(
        "SELECT (SELECT COALESCE(SUM(total_paid), 0) FROM receipts WHERE deleted = 0 AND substr(date, 1, 7) = ?1) + (SELECT COALESCE(SUM(amount), 0) FROM extra_expenses WHERE deleted = 0 AND substr(date, 1, 7) = ?1) AS t"
      )
      .bind(month)
      .first<{ t: number }>(),
    db.prepare('SELECT COALESCE(SUM(amount), 0) AS t FROM budgets WHERE deleted = 0 AND month = ?').bind(month).first<{ t: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM meal_plan WHERE deleted = 0 AND date > ? AND date <= ?').bind(today, addDays(today, 7)).first<{ n: number }>(),
  ]);
  const ideas = await suggestRecipes(db, stock, new Set(expiring.filter((e) => e.days <= 3).map((e) => e.product_id)));
  const parts: string[] = [];
  const soon = expiring.filter((e) => e.days <= 7);
  if (soon.length) parts.push(`Scadono: ${soon.slice(0, 3).map((e) => e.name).join(', ')}${soon.length > 3 ? ` +${soon.length - 3}` : ''}`);
  if (below.length) parts.push(`Sotto scorta: ${below.length}`);
  parts.push(`Spesa settimana ${euro(week?.t || 0)}${budget?.t ? ` · mese ${euro(spent?.t || 0)} su ${euro(budget.t)}` : ''}`);
  if (ideas.length) parts.push(`Idee: ${ideas.join(', ')}`);
  parts.push(planned?.n ? `Pianificati ${planned.n} pasti` : 'Settimana da pianificare');
  const recap = await weekRecap(db, today).catch(() => null);
  if (recap) parts.unshift(...recap);
  return { title: 'Riepilogo della settimana', body: parts.join('\n'), url: '/planner', tag: 'settimana' };
}

// Diario della settimana: varieta', pasti fuori, pasti non registrati (pranzo/cena; domenica sera esclusa).
const WD_IT = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
async function weekRecap(db: D1Database, today: string) {
  const from = weekStartIso(today);
  const to = addDaysIso(from, 6);
  const [plan, recipes, meals, events, goalsRow] = await Promise.all([
    all(db, 'SELECT * FROM meal_plan WHERE deleted = 0 AND done = 1 AND date >= ? AND date <= ?', from, to),
    all(db, 'SELECT id, title, course, main_food, second_food, features, rating, want_freq FROM recipes WHERE deleted = 0'),
    all(db, 'SELECT * FROM meals WHERE deleted = 0 AND date >= ? AND date <= ?', from, to),
    all(db, "SELECT type, date, product_id, value, lot_id, plan_id FROM events WHERE deleted = 0 AND date >= ? AND date <= ?", from, to),
    db.prepare("SELECT value FROM settings WHERE id = 'goals' AND deleted = 0").first<{ value: string }>(),
  ]);
  const R = Object.fromEntries(recipes.map((r) => [r.id, r]));
  const M = Object.fromEntries(meals.map((m) => [m.id, m]));
  const dishes = plan.map((e) => toDish(e, R[e.recipe_id] || R[e.leftover_of] || null, M[mealId(e.date, e.meal)]));
  const missing: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDaysIso(from, i);
    for (const m of ['pranzo', 'cena']) {
      if (d > today || (d === today && m === 'cena')) continue;
      if (!dishes.some((x: any) => x.date === d && x.meal === m)) missing.push(`${WD_IT[i]} ${m}`);
    }
  }
  if (!dishes.length) return [`Diario vuoto questa settimana: registra i pasti per la varietà`];
  let saved = null;
  try {
    saved = goalsRow?.value ? JSON.parse(goalsRow.value) : null;
  } catch {
    saved = null;
  }
  const goals = goalConfig(saved).filter((g: any) => g.period === 'week');
  const ctx = periodContext({ all: dishes, mealsById: M, events, recipesById: R, from, to });
  const ev = evaluate(goals, ctx, to);
  const todo = ev.rows.filter((r: any) => r.status === 'todo').map((r: any) => r.label.toLowerCase());
  const over = ev.rows.filter((r: any) => r.status === 'over').map((r: any) => r.label.toLowerCase());
  const out = [`Varietà ${ev.score}/100 · ${ev.okCount}/${ev.rows.length} obiettivi`];
  if (todo.length) out.push(`Mancati: ${todo.slice(0, 4).join(', ')}${todo.length > 4 ? '…' : ''}`);
  if (over.length) out.push(`Oltre il limite: ${over.join(', ')}`);
  // ingredienti usati (avanzi esclusi: gia' contati quando li hai cucinati) e buttati; solo eventi 0.14+ (con lotto o pasto)
  const sumOf = (t: string) => events.filter((e: any) => e.type === t && (e.lot_id || e.plan_id) && !String(e.product_id || '').startsWith('p-avanzo-')).reduce((s: number, e: any) => s + (Number(e.value) || 0), 0);
  const used = sumOf('consumo');
  const wasted = sumOf('buttato');
  if (used || wasted) out.push(`Ingredienti usati ${euro(used)} · buttati ${euro(wasted)}`);
  const outMeals = meals.filter((m) => OUT_PLACES.includes(m.place) && dishes.some((d: any) => d.date === m.date && d.meal === m.meal));
  if (outMeals.length) out.push(`Pasti fuori ${outMeals.length}${outMeals.some((m) => m.cost) ? ` · ${euro(outMeals.reduce((s, m) => s + (m.cost || 0), 0))}` : ''}`);
  if (missing.length) out.push(`Da registrare: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` +${missing.length - 5}` : ''}`);
  return out;
}

const prevMonthOf = (month: string, n = 1) => {
  const d = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7) - 1 - n, 1));
  return d.toISOString().slice(0, 7);
};

async function monthSpent(db: D1Database, month: string) {
  const r = await db
    .prepare(
      "SELECT (SELECT COALESCE(SUM(total_paid), 0) FROM receipts WHERE deleted = 0 AND substr(date, 1, 7) = ?1) + (SELECT COALESCE(SUM(amount), 0) FROM extra_expenses WHERE deleted = 0 AND substr(date, 1, 7) = ?1) AS t"
    )
    .bind(month)
    .first<{ t: number }>();
  return r?.t || 0;
}

// Il 1° del mese: speso vs budget, confronto col mese prima, 3 affari migliori, sprechi.
export async function monthlyMessage(db: D1Database, currentMonth: string) {
  const m = prevMonthOf(currentMonth, 1);
  const m2 = prevMonthOf(currentMonth, 2);
  const [spent, before, budgets, best, saved, waste] = await Promise.all([
    monthSpent(db, m),
    monthSpent(db, m2),
    all(db, 'SELECT area, amount, month FROM budgets WHERE deleted = 0 AND month <= ? ORDER BY month DESC, updated_at DESC', m),
    all(
      db,
      `SELECT p.name AS name, pl.discount AS discount FROM purchase_lines pl JOIN receipts r ON r.id = pl.receipt_id LEFT JOIN products p ON p.id = pl.product_id
       WHERE pl.deleted = 0 AND r.deleted = 0 AND substr(r.date, 1, 7) = ? AND pl.discount > 0 ORDER BY pl.discount DESC LIMIT 3`,
      m
    ),
    db.prepare('SELECT COALESCE(SUM(total_discount), 0) AS t FROM receipts WHERE deleted = 0 AND substr(date, 1, 7) = ?').bind(m).first<{ t: number }>(),
    db.prepare("SELECT COALESCE(SUM(value), 0) AS t FROM events WHERE deleted = 0 AND type = 'buttato' AND substr(date, 1, 7) = ?").bind(m).first<{ t: number }>(),
  ]);
  const seen = new Set<string>();
  const budget = budgets.filter((b) => !seen.has(b.area) && seen.add(b.area)).reduce((s, b) => s + (b.amount || 0), 0);
  const name = new Date(`${m}-15T12:00:00Z`).toLocaleDateString('it-IT', { month: 'long', timeZone: TZ });
  const parts = [`Speso ${euro(spent)}${budget ? ` su ${euro(budget)} di budget${spent > budget ? ' (sforato)' : ''}` : ''}`];
  if (before > 0) {
    const pct = Math.round((spent / before - 1) * 100);
    parts.push(pct === 0 ? 'Come il mese prima' : `${pct > 0 ? '+' : ''}${pct}% rispetto al mese prima`);
  }
  if (saved?.t) parts.push(`Risparmiato con le offerte ${euro(saved.t)}`);
  if (best.length) parts.push(`Affari: ${best.map((b) => `${b.name || 'articolo'} −${euro(b.discount)}`).join(', ')}`);
  if (waste?.t) parts.push(`Buttato ${euro(waste.t)} di cibo`);
  return { title: `Report di ${name}`, body: parts.join('\n'), url: '/finanze', tag: 'mese' };
}
