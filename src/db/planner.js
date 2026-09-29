import { addDays, format, startOfWeek, parseISO } from 'date-fns';
import { save } from './repo.js';
import { stockIn, niceQty, normUnit, toProductUnit } from './recipes.js';

export const MEALS = [
  { id: 'pranzo', label: 'Pranzo' },
  { id: 'cena', label: 'Cena' },
];

export const iso = (d) => format(d, 'yyyy-MM-dd');
export const weekStart = (d = new Date()) => startOfWeek(d, { weekStartsOn: 1 });
export const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

// Fabbisogno aggregato di piu' pasti (stessa pasta in 2 ricette = somma), confrontato con la dispensa.
export function planNeeds(entries, rec, data) {
  const need = new Map(); // product_id -> { product, qty|null, recipes:Set }
  for (const e of entries) {
    const r = e.recipe_id && rec.byId[e.recipe_id];
    if (!r) continue;
    const scale = (Number(e.servings) || 1) / (r.servings || 1);
    for (const ing of rec.ings[r.id] || []) {
      if (ing.optional || !ing.product_id) continue;
      const p = data.products[ing.product_id];
      if (!p) continue;
      const cur = need.get(p.id) || { product: p, qty: 0, vague: false, recipes: new Set() };
      const vague = ing.qty == null || normUnit(ing.unit) === 'q.b.';
      const q = vague ? (Number(p.uses_per_pack) > 0 ? scale / Number(p.uses_per_pack) : null) : toProductUnit(ing.qty * scale, ing.unit, p);
      if (q == null) cur.vague = true;
      else cur.qty += q;
      cur.recipes.add(r.title);
      need.set(p.id, cur);
    }
  }
  const out = [];
  for (const n of need.values()) {
    const have = stockIn(data, n.product.id, n.product.default_unit);
    // sostituto disponibile = non serve comprare
    const hasSub = (rec.subs[n.product.id] || []).some((s) => data.products[s.substitute_id] && stockIn(data, s.substitute_id, data.products[s.substitute_id].default_unit) > 0);
    let missing = 0;
    if (n.qty > 0) missing = Math.max(0, n.qty - have);
    else if (n.vague && have <= 0) missing = null; // "q.b." e non ce l'ho: 1 confezione
    if ((missing === null || missing > 1e-6) && !hasSub) out.push({ ...n, have, missing, recipes: [...n.recipes] });
  }
  return out.sort((a, b) => a.product.name.localeCompare(b.product.name, 'it'));
}

export async function addNeedsToList(needs, data, label) {
  const inList = new Set(data.shopping.filter((s) => !s.checked).map((s) => s.product_id).filter(Boolean));
  const ops = needs
    .filter((n) => !inList.has(n.product.id))
    .map((n) => ({
      table: 'shopping_items',
      row: {
        product_id: n.product.id,
        qty: n.missing ? Math.max(niceQty(n.missing, n.product.default_unit), 0.001) : 1,
        unit: n.product.default_unit,
        origin: 'planner',
        checked: 0,
        note: n.recipes.slice(0, 3).join(', '),
      },
    }));
  if (ops.length) await save(ops, label);
  return ops.length;
}

export const dayLabel = (d, opts = { weekday: 'short', day: 'numeric' }) => (typeof d === 'string' ? parseISO(d) : d).toLocaleDateString('it-IT', opts);
