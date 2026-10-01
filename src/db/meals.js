import { save } from './repo.js';
import { uuid } from './db.js';
import { recipeStatus, NO_PRODUCT, consumeOps } from './recipes.js';
import { courseOf } from './tags.js';
import { expiringSet, urgentOf } from './insights.js';
import { todayISO, autoAddBelowStock } from './logic.js';
import {
  toDish, mealId, ITEM_BY_ID, goalConfig, periodContext, evaluate, scoreRecipe, weekStartIso, addDaysIso, isoDay, DEFAULT_WEIGHTS, OUT_PLACES, MEALS_ALL, COST_PLACES, HOME_PLACES,
} from './variety.js';

// ── Impostazioni condivise (tabella settings, JSON) ──
export const getSetting = (rec, id, fallback) => (rec?.settings?.[id] ?? fallback);
export const weightsOf = (rec) => ({ ...DEFAULT_WEIGHTS, ...(getSetting(rec, 'weights', {}) || {}) });
export const goalsOf = (rec) => goalConfig(getSetting(rec, 'goals', {}));
export const saveSetting = (id, value, label) => save([{ table: 'settings', row: { id, value: JSON.stringify(value), deleted: 0 } }], label);

// Pasto dall'ora: prima delle 10:30 colazione (se attiva), prima delle 16 pranzo, poi cena.
export function mealFromClock(extra = false, d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (extra && h < 10.5) return 'colazione';
  if (h < 16) return 'pranzo';
  if (extra && h < 18.5) return 'merenda';
  return 'cena';
}

// ── Diario: piatti fatti (done) normalizzati ──
export function doneDishes(rec) {
  return rec.plan
    .filter((e) => e.done)
    .map((e) => toDish(e, rec.byId[e.recipe_id] || rec.byId[e.leftover_of] || null, rec.meals[mealId(e.date, e.meal)], courseOf));
}
export function lastDoneMap(dishes) {
  const m = new Map();
  for (const d of dishes) if (d.recipe_id && !d.leftover && (!m.has(d.recipe_id) || m.get(d.recipe_id) < d.date)) m.set(d.recipe_id, d.date);
  return m;
}
export const recipeAsDish = (r, date = todayISO(), meal = 'cena') => toDish({ id: `x-${r.id}`, date, meal, recipe_id: r.id }, r, null, courseOf);

export function weekEval(rec, today = todayISO(), dishes = doneDishes(rec)) {
  const from = weekStartIso(today);
  const ctx = periodContext({ all: dishes, mealsById: rec.meals, events: rec.events, recipesById: rec.byId, from, to: addDaysIso(from, 6) });
  return { ctx, ...evaluate(goalsOf(rec).filter((g) => g.period === 'week'), ctx, today) };
}
export function monthEval(rec, today = todayISO(), dishes = doneDishes(rec)) {
  const from = `${today.slice(0, 7)}-01`;
  const d = new Date(`${from}T12:00:00`);
  const to = isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0));
  const ctx = periodContext({ all: dishes, mealsById: rec.meals, events: rec.events, recipesById: rec.byId, from, to });
  return { ctx, ...evaluate(goalsOf(rec).filter((g) => g.period === 'month'), ctx, today) };
}

// ── Consigliate: tutte le ricette con punteggio (escluse in fondo) ──
export function rankRecipes(rec, data, { today = todayISO(), dishes = doneDishes(rec), weekRows = null } = {}) {
  const exp = expiringSet(data);
  const ctx = {
    today,
    weights: weightsOf(rec),
    lastDone: lastDoneMap(dishes),
    recentDishes: dishes.filter((d) => d.date >= addDaysIso(today, -3) && d.date <= today),
    weekRows: weekRows || weekEval(rec, today, dishes).rows,
  };
  return rec.list
    .map((r) => {
      const ings = rec.ings[r.id] || [];
      const st = recipeStatus(ings, 1 / (r.servings || 1), data, rec.subs);
      const sc = scoreRecipe(r, { st, urgent: urgentOf(ings, exp, data).length, dish: recipeAsDish(r, today) }, ctx);
      return { r, st, ...sc };
    })
    .sort((a, b) => b.total - a.total);
}

// ── Registra un pasto fatto ──
// Scrive la riga meal_plan (o segna fatta quella gia' pianificata) + la riga meals (luogo/costo).
export function mealOps(date, meal, { place, cost } = {}, rec) {
  const id = mealId(date, meal);
  const cur = rec?.meals?.[id];
  const ops = [];
  const row = { id, date, meal, deleted: 0 };
  if (place) row.place = place;
  else if (!cur) row.place = 'casa';
  if (cost !== undefined) {
    row.cost = cost;
    // costo fuori casa → spesa extra "ristoranti" in Finanze (una per pasto)
    const exId = cur?.expense_id || `ex-${id}`;
    const out = COST_PLACES.includes(place || cur?.place);
    if (cost > 0 && out) {
      ops.push({ table: 'extra_expenses', row: { id: exId, amount: cost, date, area: 'cibo', category: 'ristoranti', note: `${MEALS_ALL.find((m) => m.id === meal)?.label || meal} fuori`, deleted: 0 } });
      row.expense_id = exId;
    } else if (cur?.expense_id) {
      ops.push({ table: 'extra_expenses', row: { id: cur.expense_id, deleted: 1 } });
      row.expense_id = null;
    }
  }
  if (!cur || Object.keys(row).length > 4) ops.push({ table: 'meals', row });
  return ops;
}

// Piatto aggiunto a mano dal planner/diario (ricetta, avanzo o scritto a mano).
// dish: { recipe_id?, leftover_of?, note?, dish_course?, dish_main?, dish_second?, dish_features?, dish_ings? }
export async function addDish({ rec, date, meal, dish, servings = 1, done, place, cost, auto = 0, id = null, extraOps = [] }) {
  const ops = [{ table: 'meal_plan', row: { id: id || uuid(), date, meal, servings, done: done ? 1 : 0, auto, ...dish, ...(done ? { done_at: todayISO() } : {}), ...(extraOps.length ? { scaled: 1 } : {}) } }];
  ops.push(...extraOps);
  ops.push(...mealOps(date, meal, { place, cost }, rec));
  await save(ops, `Planner: ${dish.note || rec.byId[dish.recipe_id]?.title || rec.byId[dish.leftover_of]?.title || 'piatto'}`);
  if (extraOps.length) await autoAddBelowStock();
}

// Alimento singolo (frutta, verdura, dolce, snack…) nel pasto. Se preso dalla dispensa la scala (usedQty nell'unita' del prodotto).
// Una sola operazione: si annulla tutto insieme.
export async function addItem({ rec, data, date, meal, kind, name, product = null, main, usedQty = 0, n = 1, done, place, cost }) {
  const k = ITEM_BY_ID[kind] || ITEM_BY_ID.altro;
  const plan_id = uuid();
  const scaled = product && usedQty > 0;
  const ops = [
    {
      table: 'meal_plan',
      row: {
        id: plan_id, date, meal, scaled: scaled ? 1 : 0, servings: n, done: done ? 1 : 0, auto: 0, note: name,
        dish_course: k.course, dish_main: main === undefined ? k.main : main, dish_second: null, dish_features: 'alimento', dish_ings: product?.id || null,
        ...(done ? { done_at: todayISO() } : {}),
      },
    },
  ];
  if (scaled) ops.push(...consumeOps(product, usedQty, data, { date, plan_id, overflow: false }));
  ops.push(...mealOps(date, meal, { place, cost }, rec));
  await save(ops, `${name}${n > 1 ? ` ×${n}` : ''} nel pasto`);
  if (product && usedQty > 0) await autoAddBelowStock();
}

// Piatto "da pasto" (per proposte di pranzo/cena): niente contorni, antipasti, dolci, salse, pane, colazioni.
const NOT_MEAL = ['Contorno', 'Antipasto', 'Dolce', 'Colazione', 'Bevanda', 'Salsa e sugo', 'Pane e lievitati'];
export const isMealDish = (r) => !NOT_MEAL.includes(recipeAsDish(r).course);

// ── Riempi con proposte ──
// slots: [{ date, meal }] in ordine. Ogni scelta entra nella "storia" simulata, cosi' la varieta' vale anche tra le proposte.
export function proposeFor(rec, data, slots, { skip = new Set() } = {}) {
  const base = doneDishes(rec);
  const planned = rec.plan.filter((e) => !e.done && e.recipe_id).map((e) => toDish(e, rec.byId[e.recipe_id], rec.meals[mealId(e.date, e.meal)], courseOf));
  const sim = [...base, ...planned];
  const chosen = new Set();
  const out = [];
  for (const s of slots) {
    const ranked = rankRecipes(rec, data, { today: s.date, dishes: sim.filter((d) => d.date <= s.date) });
    const pick = ranked.find((x) => x.total >= 0 && !chosen.has(x.r.id) && !skip.has(`${s.date}|${s.meal}|${x.r.id}`) && (s.meal === 'pranzo' || s.meal === 'cena' ? isMealDish(x.r) : true));
    if (!pick) continue;
    chosen.add(pick.r.id);
    out.push({ ...s, r: pick.r, total: pick.total, reasons: pick.reasons, alternatives: ranked.filter((x) => x.total >= 0 && x.r.id !== pick.r.id).slice(0, 6) });
    sim.push({ ...recipeAsDish(pick.r, s.date, s.meal), id: `sim-${s.date}-${s.meal}` });
  }
  return out;
}

export async function saveProposals(rec, props) {
  const ops = [];
  for (const p of props) {
    ops.push({ table: 'meal_plan', row: { id: uuid(), date: p.date, meal: p.meal, recipe_id: p.r.id, servings: 1, done: 0, auto: 1 } });
    ops.push(...mealOps(p.date, p.meal, {}, rec));
  }
  if (ops.length) await save(ops, `Proposte nel planner (${props.length})`);
}
export async function removeProposals(rec, dates) {
  const set = new Set(dates);
  const ops = rec.plan.filter((e) => e.auto && !e.done && set.has(e.date)).map((e) => ({ table: 'meal_plan', row: { id: e.id, deleted: 1 } }));
  if (ops.length) await save(ops, `Tolte ${ops.length} proposte`);
  return ops.length;
}

// Storico di una ricetta (piatti fatti, anche avanzi)
export function recipeHistory(rec, recipeId) {
  return rec.plan
    .filter((e) => e.done && (e.recipe_id === recipeId || e.leftover_of === recipeId))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((e) => ({ ...e, place: rec.meals[mealId(e.date, e.meal)]?.place || 'casa' }));
}

export const isOut = (place) => OUT_PLACES.includes(place);
export { NO_PRODUCT };

// Avanzo mangiato: -1 porzione dal lotto + piatto nel diario (una sola operazione, annullabile).
export async function eatLeftover(lot, product, data, rec, { date = todayISO(), meal, place, cost } = {}) {
  const extra = !!getSetting(rec, 'planner', {})?.extraMeals;
  const m = meal || mealFromClock(extra);
  const rid = product.id.replace(/^p-avanzo-/, '');
  const plan_id = uuid();
  const ops = [
    ...consumeOps(product, 1, data, { date, plan_id, lots: [lot] }),
    { table: 'meal_plan', row: { id: plan_id, date, meal: m, servings: 1, done: 1, done_at: date, scaled: 1, ...(rec.byId[rid] ? { leftover_of: rid } : { note: product.name }) } },
    ...mealOps(date, m, { place, cost }, rec),
  ];
  await save(ops, `Avanzo mangiato: ${product.name.replace(/^Avanzo: /, '')}`);
}
