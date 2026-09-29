import { save } from './repo.js';
import { uuid } from './db.js';
import { recipeStatus, NO_PRODUCT } from './recipes.js';
import { courseOf } from './tags.js';
import { expiringSet, urgentOf } from './insights.js';
import { todayISO } from './logic.js';
import {
  toDish, mealId, goalConfig, periodContext, evaluate, scoreRecipe, weekStartIso, addDaysIso, isoDay, DEFAULT_WEIGHTS, OUT_PLACES, MEALS_ALL,
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
    const out = (place || cur?.place) && (place || cur?.place) !== 'casa';
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

export function cookedDiaryOps({ rec, recipe, date = todayISO(), meal, servings = 1, planId = null, usedExpiring = 0, rating = null }) {
  const ops = [];
  const existing =
    (planId && rec.plan.find((e) => e.id === planId)) ||
    rec.plan.find((e) => e.date === date && e.meal === meal && e.recipe_id === recipe.id && !e.done);
  if (existing) ops.push({ table: 'meal_plan', row: { id: existing.id, done: 1, date, meal, used_expiring: usedExpiring, done_at: todayISO() } });
  else ops.push({ table: 'meal_plan', row: { id: uuid(), date, meal, recipe_id: recipe.id, servings, done: 1, used_expiring: usedExpiring, auto: 0, done_at: todayISO() } });
  ops.push(...mealOps(date, meal, {}, rec));
  if (rating) ops.push({ table: 'recipes', row: { id: recipe.id, rating } });
  return ops;
}

// Piatto aggiunto a mano dal planner/diario (ricetta, avanzo o scritto a mano).
// dish: { recipe_id?, leftover_of?, note?, dish_course?, dish_main?, dish_second?, dish_features?, dish_ings? }
export async function addDish({ rec, date, meal, dish, servings = 1, done, place, cost, auto = 0 }) {
  const ops = [{ table: 'meal_plan', row: { id: uuid(), date, meal, servings, done: done ? 1 : 0, auto, ...dish, ...(done ? { done_at: todayISO() } : {}) } }];
  ops.push(...mealOps(date, meal, { place, cost }, rec));
  await save(ops, `Planner: ${dish.note || rec.byId[dish.recipe_id]?.title || rec.byId[dish.leftover_of]?.title || 'piatto'}`);
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
export async function eatLeftover(lot, product, data, rec, { date = todayISO(), meal } = {}) {
  const extra = !!getSetting(rec, 'planner', {})?.extraMeals;
  const m = meal || mealFromClock(extra);
  const rid = product.id.replace(/^p-avanzo-/, '');
  const left = Math.round((Number(lot.qty) - 1) * 1000) / 1000;
  const ops = [
    { table: 'stock_lots', row: left > 0 ? { id: lot.id, qty: left } : { id: lot.id, qty: 0, deleted: 1 } },
    { table: 'events', row: { type: 'consumo', product_id: product.id, qty: 1, unit: 'pz', date } },
    { table: 'meal_plan', row: { id: uuid(), date, meal: m, servings: 1, done: 1, done_at: date, ...(rec.byId[rid] ? { leftover_of: rid } : { note: product.name }) } },
    ...mealOps(date, m, {}, rec),
  ];
  await save(ops, `Avanzo mangiato: ${product.name.replace(/^Avanzo: /, '')}`);
}
