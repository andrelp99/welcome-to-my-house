import { lotStatus } from './logic.js';
import { toProductUnit, normUnit, NO_PRODUCT, priceOf } from './recipes.js';
export { priceOf };

// Prodotti con lotti scaduti o in scadenza (anticipo del luogo): da usare per primi.
export function expiringSet(data) {
  const out = new Set();
  for (const lot of data.lots) {
    const p = data.products[lot.product_id];
    const st = lotStatus(lot, p, data.locations[lot.location_id]);
    if (st.level === 'soon' || st.level === 'expired') out.add(lot.product_id);
  }
  return out;
}

// Ingredienti della ricetta che usano prodotti in scadenza (nomi).
export function urgentOf(ings, exp, data) {
  const names = [];
  for (const i of ings) if (!i.optional && i.product_id && exp.has(i.product_id)) names.push(data.products[i.product_id]?.name || i.text);
  return [...new Set(names)];
}

// Costo stimato della ricetta alla scala data (scale = porzioni / dosi originali).
// Ingredienti "q.b." o senza quantita' convertibile: esclusi (di solito sale, olio: pochi centesimi).
export function recipeCost(ings, scale, data) {
  let total = 0;
  let known = 0;
  const unknown = [];
  for (const i of ings) {
    if (i.optional || !i.product_id || i.product_id === NO_PRODUCT) continue;
    const p = data.products[i.product_id];
    if (!p || p.always_have) continue;
    if (i.qty == null || normUnit(i.unit) === 'q.b.') continue;
    const need = toProductUnit(i.qty * scale, i.unit, p);
    const v = need == null ? null : priceOf(p, need, data);
    if (v == null) unknown.push(p.name);
    else {
      total += v;
      known++;
    }
  }
  return { total: Math.round(total * 100) / 100, known, unknown: [...new Set(unknown)] };
}

// Valori nutrizionali per porzione salvati come JSON.
export function nutritionOf(r) {
  if (!r?.nutrition) return null;
  try {
    const n = typeof r.nutrition === 'string' ? JSON.parse(r.nutrition) : r.nutrition;
    return n && n.kcal != null ? n : null;
  } catch {
    return null;
  }
}
export const NUTRI_LABELS = [
  ['kcal', 'Energia', 'kcal'],
  ['carbs', 'Carboidrati', 'g'],
  ['sugar', 'di cui zuccheri', 'g'],
  ['fat', 'Grassi', 'g'],
  ['satfat', 'di cui saturi', 'g'],
  ['protein', 'Proteine', 'g'],
  ['fiber', 'Fibre', 'g'],
  ['chol', 'Colesterolo', 'mg'],
  ['sodium', 'Sodio', 'mg'],
];
