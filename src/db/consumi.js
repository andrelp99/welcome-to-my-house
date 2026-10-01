// 0.14 · Dispensa → Consumi: cosa hai usato, quanto, quanto ti e' costato. Funzioni pure su rec + data.
import { convert, priceOf } from './recipes.js';
import { recipeCost } from './insights.js';
import { mealId, addDaysIso, daysBetween, isoDay, OUT_PLACES, MEALS_ALL } from './variety.js';

const r2 = (v) => Math.round(v * 100) / 100;
const MEAL_ORDER = Object.fromEntries(MEALS_ALL.map((m, i) => [m.id, i]));
export const isLeftoverProduct = (p) => p?.category_id === 'cat-avanzi' || String(p?.id || '').startsWith('p-avanzo-');
const qtyIn = (e, p) => convert(Number(e.qty) || 0, e.unit || p.default_unit, p.default_unit) ?? (Number(e.qty) || 0);
// valore di un evento: quelli vecchi (prima della 0.14, senza lotto) si ricalcolano dall'ultimo prezzo con le unita' giuste
export function valueOf(e, p, data) {
  if (e.lot_id || e.plan_id || e.type !== 'consumo') return e.value != null ? Number(e.value) : null;
  const v = priceOf(p, qtyIn(e, p), data);
  return v != null ? Math.round(v * 100) / 100 : e.value != null ? Number(e.value) : null;
}
const titleOf = (rec, e) => (e.recipe_id && rec.byId[e.recipe_id]?.title) || (e.leftover_of && `Avanzo: ${rec.byId[e.leftover_of]?.title || ''}`) || e.note || 'Piatto';
// quota di costo del piatto mangiato: porzioni mangiate / cucinate (il resto e' avanzo)
export const shareOf = (entry) => (Number(entry?.cooked) > 0 ? Math.min(1, (Number(entry.servings) || 1) / Number(entry.cooked)) : 1);

function linesOf(evs, data) {
  const by = {};
  for (const e of evs) {
    const p = data.products[e.product_id];
    if (!p) continue;
    const x = (by[p.id] ||= { p, qty: 0, value: 0, known: false });
    x.qty += qtyIn(e, p);
    if (e.value != null) {
      x.value += Number(e.value);
      x.known = true;
    }
  }
  return Object.values(by).map((x) => ({ ...x, qty: Math.round(x.qty * 1000) / 1000, value: x.known ? r2(x.value) : null }));
}

// ── B1 · Recap di un giorno, pasto per pasto ──
export function dayRecap(rec, data, date) {
  const evs = rec.events.filter((e) => e.date === date);
  const byPlan = {};
  for (const e of evs) if (e.type === 'consumo' && e.plan_id) (byPlan[e.plan_id] ||= []).push(e);
  const entries = rec.plan.filter((e) => e.date === date && e.done);
  const meals = [];
  for (const m of MEALS_ALL) {
    const list = entries.filter((e) => e.meal === m.id);
    if (!list.length) continue;
    const dishes = list.map((e) => {
      const lines = linesOf(byPlan[e.id] || [], data);
      const share = shareOf(e);
      const cost = r2(lines.reduce((t, l) => t + (l.value || 0), 0) * share);
      return { entry: e, title: titleOf(rec, e), lines, share, cost, item: String(e.dish_features || '').includes('alimento') };
    });
    const ml = rec.meals[mealId(date, m.id)];
    meals.push({ meal: m, place: ml?.place || 'casa', outCost: ml?.cost ? Number(ml.cost) : null, dishes, cost: r2(dishes.reduce((t, d) => t + d.cost, 0)) });
  }
  const known = new Set(entries.map((e) => e.id));
  const outside = evs
    .filter((e) => (e.type === 'consumo' && !(e.plan_id && known.has(e.plan_id))) || e.type === 'buttato' || e.type === 'rettifica')
    .map((e) => ({ e, p: data.products[e.product_id], recipe: e.recipe_id && rec.byId[e.recipe_id] }))
    .filter((x) => x.p);
  return { date, meals, outside, total: r2(meals.reduce((t, m) => t + m.cost, 0)) };
}
export const dayCost = (rec, data, date) => dayRecap(rec, data, date).total;

// ── B2 B3 B6 B7 B8 · Periodo ──
function aggregate(rec, data, from, to) {
  const by = {};
  let used = 0;
  let wasted = 0;
  for (const e of rec.events) {
    if (e.date < from || e.date > to) continue;
    const p = data.products[e.product_id];
    if (!p || isLeftoverProduct(p)) continue;
    if (e.type === 'buttato') wasted += Number(e.value) || 0;
    if (e.type !== 'consumo') continue;
    const x = (by[p.id] ||= { p, qty: 0, value: 0, uses: new Set(), recipes: new Set(), days: new Set() });
    x.qty += qtyIn(e, p);
    const val = valueOf(e, p, data) || 0;
    x.value += val;
    x.uses.add(e.plan_id || `${e.date}|${e.recipe_id || e.id}`);
    x.days.add(e.date);
    if (e.recipe_id && rec.byId[e.recipe_id]) x.recipes.add(rec.byId[e.recipe_id].title);
    used += val;
  }
  return { by, used: r2(used), wasted: r2(wasted) };
}

export function periodStats(rec, data, from, to) {
  const len = daysBetween(from, to) + 1;
  const pFrom = addDaysIso(from, -len);
  const pTo = addDaysIso(from, -1);
  const cur = aggregate(rec, data, from, to);
  const prev = aggregate(rec, data, pFrom, pTo);
  const rows = Object.values(cur.by)
    .map((x) => {
      const pv = prev.by[x.p.id];
      return { p: x.p, qty: Math.round(x.qty * 1000) / 1000, uses: x.uses.size, value: r2(x.value), recipes: [...x.recipes], days: [...x.days].sort(), prevQty: pv ? pv.qty : 0, trend: !pv ? 'new' : x.qty > pv.qty * 1.1 ? 'up' : x.qty < pv.qty * 0.9 ? 'down' : 'eq' };
    })
    .sort((a, b) => b.value - a.value || b.uses - a.uses);
  const cats = {};
  for (const r of rows) {
    const c = data.categories[r.p.category_id]?.name || 'Altro';
    cats[c] = r2((cats[c] || 0) + r.value);
  }
  const byCategory = Object.entries(cats).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);

  // B6 costo per pasto (pranzo/cena/colazione/merenda con almeno un piatto)
  const groups = { casa: [], schiscia: [], fuori: [] };
  const entries = rec.plan.filter((e) => e.done && e.date >= from && e.date <= to);
  const meals = {};
  for (const e of entries) (meals[`${e.date}|${e.meal}`] ||= []).push(e);
  const evByPlan = {};
  for (const e of rec.events) if (e.type === 'consumo' && e.plan_id && e.date >= from && e.date <= to) (evByPlan[e.plan_id] ||= []).push(e);
  for (const [k, list] of Object.entries(meals)) {
    const [date, meal] = k.split('|');
    const ml = rec.meals[mealId(date, meal)];
    const place = ml?.place || 'casa';
    if (place === 'casa' || place === 'schiscia') {
      const cost = list.reduce((t, e) => t + (evByPlan[e.id] || []).reduce((s, x) => s + (Number(x.value) || 0), 0) * shareOf(e), 0);
      if (cost > 0) groups[place].push(cost);
    } else if ((OUT_PLACES.includes(place) || place === 'lavoro') && Number(ml?.cost) > 0) groups.fuori.push(Number(ml.cost));
  }
  const avg = (a) => (a.length ? r2(a.reduce((t, v) => t + v, 0) / a.length) : null);
  const mealCosts = Object.fromEntries(Object.entries(groups).map(([k, a]) => [k, { n: a.length, avg: avg(a), total: r2(a.reduce((t, v) => t + v, 0)) }]));

  // B7 costo reale delle ricette cucinate nel periodo
  const recipes = rec.events
    .filter((e) => e.type === 'cucinato' && e.date >= from && e.date <= to && Number(e.qty) > 0 && rec.byId[e.recipe_id])
    .map((e) => {
      const r = rec.byId[e.recipe_id];
      const est = recipeCost(rec.ings[r.id] || [], 1 / (Number(r.servings) || 1), data);
      return { r, date: e.date, real: e.value != null ? r2(Number(e.value) / Number(e.qty)) : null, est: est.known ? est.total : null };
    })
    .filter((x) => x.real != null)
    .sort((a, b) => b.date.localeCompare(a.date));

  return {
    from, to, len, prevFrom: pFrom, prevTo: pTo,
    rows, byCategory, mealCosts, recipes,
    used: cur.used, wasted: cur.wasted, prevUsed: prev.used, prevWasted: prev.wasted,
    count: rows.length, prevCount: Object.keys(prev.by).length,
    perDay: r2(cur.used / len),
    topUsed: [...rows].sort((a, b) => b.uses - a.uses).slice(0, 5),
    topCost: rows.slice(0, 5),
  };
}

// B8 · Dormienti: in dispensa, nessun uso da 30+ giorni
export function dormant(rec, data, today, days = 30) {
  const last = {};
  for (const e of rec.events) if (e.type === 'consumo' && (!last[e.product_id] || e.date > last[e.product_id])) last[e.product_id] = e.date;
  const since = addDaysIso(today, -days);
  const out = [];
  const seen = new Set();
  for (const l of data.lots) {
    const p = data.products[l.product_id];
    if (!p || p.area !== 'cibo' || isLeftoverProduct(p) || seen.has(p.id)) continue;
    const lastUse = last[p.id];
    const lotsP = data.lots.filter((x) => x.product_id === p.id);
    const oldest = Math.min(...lotsP.map((x) => Number(x.updated_at) || Date.now()));
    const ref = lastUse || isoDay(oldest);
    if (ref <= since) {
      seen.add(p.id);
      out.push({ p, days: daysBetween(ref, today), never: !lastUse });
    }
  }
  return out.sort((a, b) => b.days - a.days);
}

// ── B4 · Bilancio: comprato / usato / buttato ──
export function balance(rec, data, from, to) {
  const by = {};
  const get = (p) => (by[p.id] ||= { p, bought: 0, boughtValue: 0, used: 0, usedValue: 0, wasted: 0, wastedValue: 0 });
  let bought = 0;
  for (const pl of data.lines || []) {
    const r = data.receipts?.[pl.receipt_id];
    const p = data.products[pl.product_id];
    if (!r || !p || p.area !== 'cibo' || r.date < from || r.date > to) continue;
    const x = get(p);
    x.bought += convert(Number(pl.qty) || 0, pl.unit || p.default_unit, p.default_unit) ?? (Number(pl.qty) || 0);
    x.boughtValue += Number(pl.price_paid) || 0;
    bought += Number(pl.price_paid) || 0;
  }
  let used = 0;
  let wasted = 0;
  for (const e of rec.events) {
    if (e.date < from || e.date > to || (e.type !== 'consumo' && e.type !== 'buttato')) continue;
    const p = data.products[e.product_id];
    if (!p || p.area !== 'cibo' || isLeftoverProduct(p)) continue;
    const x = get(p);
    const q = qtyIn(e, p);
    if (e.type === 'consumo') {
      const val = valueOf(e, p, data) || 0;
      x.used += q;
      x.usedValue += val;
      used += val;
    } else {
      x.wasted += q;
      x.wastedValue += Number(e.value) || 0;
      wasted += Number(e.value) || 0;
    }
  }
  const rows = Object.values(by)
    .map((x) => {
      const base = Math.max(x.bought, x.used + x.wasted) || 1;
      return { ...x, pctUsed: Math.min(1, x.used / base), pctWasted: Math.min(1, x.wasted / base), waste: x.used + x.wasted > 0 ? x.wasted / (x.used + x.wasted) : 0 };
    })
    .sort((a, b) => b.waste - a.waste || b.boughtValue - a.boughtValue);
  return { rows, bought: r2(bought), used: r2(used), wasted: r2(wasted), wastePct: used + wasted > 0 ? wasted / (used + wasted) : 0 };
}

// ── B5 · Scheda prodotto ──
export function productCard(rec, data, pid, today) {
  const p = data.products[pid];
  if (!p) return null;
  const evs = rec.events.filter((e) => e.product_id === pid && (e.type === 'consumo' || e.type === 'buttato')).sort((a, b) => b.date.localeCompare(a.date));
  const weeks = [];
  for (let i = 7; i >= 0; i--) {
    const to = addDaysIso(today, -7 * i);
    const from = addDaysIso(to, -6);
    weeks.push({ from, to, qty: Math.round(evs.filter((e) => e.type === 'consumo' && e.date >= from && e.date <= to).reduce((t, e) => t + qtyIn(e, p), 0) * 1000) / 1000 });
  }
  const firstUse = evs.length ? evs[evs.length - 1].date : null;
  const span = firstUse ? Math.min(56, Math.max(7, daysBetween(firstUse, today) + 1)) : 56;
  const total8 = weeks.reduce((t, w) => t + w.qty, 0);
  const perWeek = total8 > 0 ? Math.round(((total8 / span) * 7) * 100) / 100 : 0;
  const have = data.stock[pid] || 0;
  const finishes = perWeek > 0 && have > 0 ? Math.floor(have / (perWeek / 7)) : null;
  const purchases = (data.lines || [])
    .filter((pl) => pl.product_id === pid && data.receipts?.[pl.receipt_id])
    .map((pl) => {
      const r = data.receipts[pl.receipt_id];
      return { date: r.date, qty: Number(pl.qty), unit: pl.unit || p.default_unit, paid: pl.price_paid != null ? Number(pl.price_paid) : null, chain: data.storesById?.[r.store_id]?.chain || null };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
  const priced = purchases.filter((x) => x.paid != null && x.qty > 0);
  const since3 = addDaysIso(today, -92);
  const recent = priced.filter((x) => x.date >= since3);
  const avgPrice = recent.length ? recent.reduce((t, x) => t + x.paid, 0) / recent.reduce((t, x) => t + x.qty, 0) : null;
  const history = [
    ...evs.map((e) => ({ date: e.date, kind: e.type, qty: qtyIn(e, p), value: valueOf(e, p, data), label: e.type === 'buttato' ? 'buttato' : (e.recipe_id && rec.byId[e.recipe_id]?.title) || (e.plan_id && titleOf(rec, rec.plan.find((x) => x.id === e.plan_id) || {})) || 'usato' })),
    ...purchases.map((x) => ({ date: x.date, kind: 'acquisto', qty: x.qty, value: x.paid, label: `comprato${x.chain ? ` ${x.chain}` : ''}` })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return { p, have, perWeek, finishes, weeks, last: priced[0] || null, avgPrice, history };
}

// ── B9 · CSV del periodo ──
export function periodCsv(stats) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Ingrediente', 'Categoria', 'Quantità', 'Unità', 'Utilizzi', 'Euro', 'Ricette', 'Giorni'];
  const lines = stats.rows.map((r) => [r.p.name, r.p.category_id || '', String(r.qty).replace('.', ','), r.p.default_unit, r.uses, r.value.toFixed(2).replace('.', ','), r.recipes.join(' | '), r.days.join(' ')].map(esc).join(';'));
  return [head.map(esc).join(';'), ...lines].join('\r\n');
}

export const sortMeals = (a, b) => MEAL_ORDER[a] - MEAL_ORDER[b];
