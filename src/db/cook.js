// 0.14: "Ho cucinato" da ogni punto (planner, diario, ricetta) e rimetti in dispensa.
import { addDays, format } from 'date-fns';
import { db, uuid } from './db.js';
import { save } from './repo.js';
import { todayISO, usesOf, autoAddBelowStock } from './logic.js';
import { consumeOps, ingredientStatus, niceQty, convert, NO_PRODUCT, stockIn } from './recipes.js';
import { mealOps } from './meals.js';
import { HOME_PLACES } from './variety.js';

// Casa e Schiscia = cucinato da me: si scala la dispensa. Casa Crema, fuori, mensa: no.
export const scalesAt = (place) => HOME_PLACES.includes(place || 'casa');

// Dose "standard" di un prodotto senza ricetta (alimenti, scritti a mano): 1 uso, 1 pz, 100 g, 125 ml
export function portionQty(p, n = 1) {
  if (!p) return 0;
  const u = usesOf(p);
  const per = u ? 1 / u : p.default_unit === 'g' ? 100 : p.default_unit === 'ml' ? 125 : ['kg', 'l'].includes(p.default_unit) ? 0.1 : 1;
  return Math.round(per * n * 1000) / 1000;
}

const isCookEntry = (e) => e && !e.leftover_of && !String(e.dish_features || '').split(',').includes('alimento');
// Il piatto chiede gli ingredienti quando diventa "mangiato"? (ricetta o scritto a mano, non avanzi/alimenti)
export const needsCook = (e, place) => isCookEntry(e) && !e.scaled && scalesAt(place) && (e.recipe_id || e.dish_ings);

// Dosi usate le ultime volte, per porzione cucinata: { product_id: { last, mine } }.
// "mine" = dose tua: le ultime 2 volte uguali.
export function doseMemory(rec, recipeId) {
  const cooks = rec.events
    .filter((e) => e.type === 'cucinato' && e.recipe_id === recipeId && Number(e.qty) > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updated_at || 0) - (a.updated_at || 0))
    .slice(0, 2);
  const per = cooks.map((c) => {
    const evs = rec.events.filter((e) => e.type === 'consumo' && e.recipe_id === recipeId && (c.plan_id ? e.plan_id === c.plan_id : !e.plan_id && e.date === c.date));
    const m = {};
    for (const e of evs) m[e.product_id] = (m[e.product_id] || 0) + Number(e.qty) / Number(c.qty);
    return m;
  });
  const out = {};
  for (const pid of Object.keys(per[0] || {})) {
    const last = per[0][pid];
    const prev = per[1]?.[pid];
    out[pid] = { last, mine: prev != null && Math.abs(prev - last) <= Math.max(0.001, last * 0.02) ? last : null };
  }
  return out;
}

// Prodotti tra cui scegliere per una riga: il suo, i sostituti, poi gli altri della stessa categoria che hai in casa.
function optionsFor(p, data, rec) {
  const out = [{ product: p, ratio: 1 }];
  for (const s of rec.subs[p.id] || []) {
    const sp = data.products[s.substitute_id];
    if (sp && !out.some((o) => o.product.id === sp.id)) out.push({ product: sp, ratio: Number(s.ratio) || 1 });
  }
  const same = Object.values(data.products)
    .filter((x) => x.category_id && x.category_id === p.category_id && x.id !== p.id && (data.stock[x.id] || 0) > 0 && x.default_unit === p.default_unit)
    .slice(0, 5);
  for (const x of same) if (!out.some((o) => o.product.id === x.id)) out.push({ product: x, ratio: 1 });
  return out;
}

// Righe del pannello. cooked = porzioni cucinate.
export function buildUses({ recipe, entry, cooked, data, rec }) {
  const rows = [];
  let unlinked = 0;
  if (recipe) {
    const scale = cooked / (Number(recipe.servings) || 1);
    const mem = doseMemory(rec, recipe.id);
    for (const ing of rec.ings[recipe.id] || []) {
      if (ing.product_id === NO_PRODUCT) continue;
      const p = ing.product_id && data.products[ing.product_id];
      if (!p) {
        unlinked++;
        continue;
      }
      const st = ingredientStatus(ing, scale, data, rec.subs);
      const opts = optionsFor(p, data, rec);
      const useSub = st.level !== 'ok' && st.sub;
      const chosen = useSub ? st.sub.product : p;
      const m = mem[chosen.id];
      let qty = useSub ? st.sub.need : st.need;
      if (m?.mine) qty = m.mine * cooked;
      qty = qty == null ? 0 : niceQty(qty, chosen.default_unit) || 0;
      const prev = rows.find((r) => r.product.id === chosen.id);
      if (prev) {
        prev.qty = Math.round((prev.qty + qty) * 1000) / 1000;
        prev.text += `, ${ing.text}`;
        continue;
      }
      rows.push({
        key: ing.id,
        text: ing.text,
        base: p,
        product: chosen,
        options: opts,
        need: st.need, // in unita' del prodotto della ricetta
        qty,
        on: !ing.optional && qty > 0,
        optional: !!ing.optional,
        mem: m || null,
        action: 'comunque', // se non c'e' in dispensa: comunque | lista | no
      });
    }
  } else if (entry?.dish_ings) {
    for (const id of String(entry.dish_ings).split(',').filter(Boolean)) {
      const p = data.products[id];
      if (!p) continue;
      rows.push({ key: id, text: p.name, base: p, product: p, options: optionsFor(p, data, rec), need: null, qty: portionQty(p, Number(entry.servings) || 1), on: true, optional: false, mem: null, action: 'comunque' });
    }
  }
  return { rows, unlinked };
}

// Quantita' di una riga quando cambi prodotto (sostituto con ratio)
export function qtyForOption(row, opt) {
  if (row.need == null) return row.qty;
  return niceQty(row.need * (opt.ratio || 1), opt.product.default_unit) || row.qty;
}

export const rowState = (row, data) => {
  const have = stockIn(data, row.product.id, row.product.default_unit);
  return have <= 0 ? 'missing' : have + 1e-6 < row.qty ? 'low' : 'ok';
};

// Operazioni di consumo per le righe scelte (stessa logica per ricette, scritti a mano, aggiunte).
export function usesOps(rows, data, { date, plan_id, recipe_id = null }) {
  const ops = [];
  for (const r of rows) {
    if (!r.on || !(r.qty > 0)) continue;
    if (r.action === 'no' && rowState(r, data) === 'missing') continue;
    ops.push(...consumeOps(r.product, r.qty, data, { date, plan_id, recipe_id, overflow: r.action === 'comunque' }));
    if (r.action === 'lista' && rowState(r, data) !== 'ok' && !data.shopping.some((s) => s.product_id === r.product.id && !s.checked))
      ops.push({ table: 'shopping_items', row: { product_id: r.product.id, qty: 1, unit: r.product.default_unit, origin: 'ricetta', checked: 0, note: 'finito cucinando' } });
  }
  return ops;
}
export const opsValue = (ops) => Math.round(ops.filter((o) => o.table === 'events' && o.row.type === 'consumo').reduce((s, o) => s + (Number(o.row.value) || 0), 0) * 100) / 100;

// Salva "Ho cucinato": diario + dispensa + avanzi + voto, una sola operazione annullabile.
export async function cookSave({ rec, data, recipe, entry, date = todayISO(), meal, place = 'casa', cooked = 1, eaten = 1, rows = [], leftLoc = 'loc-frigo', rating = null, usedExpiring = 0 }) {
  const plan_id = entry?.id || uuid();
  const scales = scalesAt(place);
  const ops = [];
  const today = todayISO();
  const planRow = { id: plan_id, date, meal, done: 1, done_at: today, servings: eaten, cooked: recipe ? cooked : null, scaled: scales ? 1 : 0, used_expiring: usedExpiring };
  ops.push({ table: 'meal_plan', row: entry ? planRow : { ...planRow, recipe_id: recipe?.id || null, auto: 0 } });
  ops.push(...mealOps(date, meal, { place }, rec));
  let total = 0;
  if (scales) {
    const u = usesOps(rows, data, { date, plan_id, recipe_id: recipe?.id || null });
    total = opsValue(u);
    ops.push(...u);
    if (recipe) {
      ops.push({ table: 'events', row: { type: 'cucinato', recipe_id: recipe.id, qty: cooked, unit: 'porz', date, plan_id, value: total || null } });
      const last = recipe.last_cooked_at && recipe.last_cooked_at > date ? recipe.last_cooked_at : date;
      ops.push({ table: 'recipes', row: { id: recipe.id, cooked_count: (Number(recipe.cooked_count) || 0) + 1, last_cooked_at: last } });
      const left = Math.round((cooked - eaten) * 1000) / 1000;
      if (left > 0) {
        const pid = `p-avanzo-${recipe.id}`;
        const freezer = leftLoc === 'loc-freezer';
        ops.push({ table: 'products', row: { id: pid, name: `Avanzo: ${recipe.title}`, area: 'cibo', category_id: 'cat-avanzi', default_unit: 'pz', default_location_id: 'loc-frigo', freezer_max_months: 3, deleted: 0 } });
        ops.push({
          table: 'stock_lots',
          row: {
            product_id: pid, qty: left, unit: 'pz', location_id: leftLoc, is_leftover: 1, plan_id,
            expiry_date: freezer ? null : format(addDays(new Date(`${date}T12:00:00`), 3), 'yyyy-MM-dd'),
            frozen_at: freezer ? today : null,
            unit_cost: total > 0 ? Math.round((total / cooked) * 100) / 100 : null,
            note: `${String(left).replace('.', ',')} porzioni`,
          },
        });
      }
    }
  }
  if (recipe && rating && rating !== recipe.rating) ops.push({ table: 'recipes', row: { id: recipe.id, rating } });
  await save(ops, `Cucinato: ${recipe?.title || entry?.note || 'piatto'}`);
  if (scales) await autoAddBelowStock();
  return { total, plan_id };
}

// Rimetti in dispensa quello che un piatto aveva scalato (lotti originali, avanzi creati, conteggio ricetta).
export async function restoreOps(rec, data, entry) {
  const evs = rec.events.filter((e) => e.plan_id === entry.id && (e.type === 'consumo' || e.type === 'cucinato'));
  const ids = [...new Set(evs.filter((e) => e.lot_id).map((e) => e.lot_id))];
  const lots = Object.fromEntries((await db.stock_lots.bulkGet(ids)).filter(Boolean).map((l) => [l.id, l]));
  const add = {};
  const ops = [];
  for (const e of evs) {
    ops.push({ table: 'events', row: { id: e.id, deleted: 1 } });
    if (e.type !== 'consumo' || !e.lot_id || !lots[e.lot_id]) continue;
    const l = lots[e.lot_id];
    add[l.id] = (add[l.id] || 0) + (convert(Number(e.qty), e.unit, l.unit) ?? Number(e.qty));
  }
  for (const [id, q] of Object.entries(add)) {
    const l = lots[id];
    const base = l.deleted ? 0 : Number(l.qty) || 0;
    ops.push({ table: 'stock_lots', row: { id, qty: Math.round((base + q) * 1000) / 1000, deleted: 0 } });
  }
  for (const l of data.lots.filter((x) => x.plan_id === entry.id)) ops.push({ table: 'stock_lots', row: { id: l.id, qty: 0, deleted: 1 } });
  const r = entry.recipe_id && rec.byId[entry.recipe_id];
  if (r && evs.some((e) => e.type === 'cucinato')) ops.push({ table: 'recipes', row: { id: r.id, cooked_count: Math.max(0, (Number(r.cooked_count) || 1) - 1) } });
  ops.push({ table: 'meal_plan', row: { id: entry.id, scaled: 0 } });
  return ops;
}

// Ingredienti aggiunti dopo a un piatto gia' cucinato (es. parmigiano dimenticato): scala la dispensa
// con la data del piatto, li lega al piatto e aggiorna costo reale e costo per porzione dell'avanzo.
export async function addUsedSave({ rec, data, entry, rows }) {
  const recipe_id = entry.recipe_id || null;
  const u = usesOps(rows.map((r) => ({ ...r, on: true })), data, { date: entry.date, plan_id: entry.id, recipe_id });
  if (!u.length) return 0;
  const added = opsValue(u);
  const ops = [...u, { table: 'meal_plan', row: { id: entry.id, scaled: 1 } }];
  const cook = rec.events.find((e) => e.type === 'cucinato' && e.plan_id === entry.id);
  if (cook && added > 0) {
    const total = Math.round(((Number(cook.value) || 0) + added) * 100) / 100;
    ops.push({ table: 'events', row: { id: cook.id, value: total } });
    const cooked = Number(cook.qty) || Number(entry.cooked) || 1;
    for (const l of data.lots.filter((x) => x.plan_id === entry.id)) ops.push({ table: 'stock_lots', row: { id: l.id, unit_cost: Math.round((total / cooked) * 100) / 100 } });
  }
  const title = (recipe_id && rec.byId[recipe_id]?.title) || entry.note || 'piatto';
  await save(ops, `${title}: + ${rows.map((r) => r.product.name).join(', ')}`);
  await autoAddBelowStock();
  return added;
}
