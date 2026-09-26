import { addDays, format } from 'date-fns';
import { db, alive } from './db.js';
import { save } from './repo.js';
import { lotLimit, todayISO, autoAddBelowStock, fmtQty } from './logic.js';

// ── Liste semplici salvate come testo "a, b, c" (il sync non gestisce array) ──
export const parseList = (s) => (Array.isArray(s) ? s : String(s || '').split(',')).map((x) => String(x).trim()).filter(Boolean);
export const joinList = (arr) => [...new Set(arr.map((x) => x.trim()).filter(Boolean))].join(', ');

export const DIET_TAGS = ['vegetariano', 'vegano', 'senza lattosio', 'senza glutine', 'veloce', 'leggero'];
export const DIFFICULTY = ['facile', 'media', 'difficile'];

// ── Unità ──
const UNIT_ALIASES = {
  g: ['g', 'gr', 'grammi', 'grammo'],
  kg: ['kg', 'chili', 'chilo', 'chilogrammi'],
  ml: ['ml', 'millilitri'],
  cl: ['cl'],
  dl: ['dl'],
  l: ['l', 'lt', 'litro', 'litri'],
  pz: ['pz', 'pezzo', 'pezzi'],
  conf: ['conf', 'confezione', 'confezioni'],
  cucchiaio: ['cucchiaio', 'cucchiai'],
  cucchiaino: ['cucchiaino', 'cucchiaini'],
  tazza: ['tazza', 'tazze'],
  bicchiere: ['bicchiere', 'bicchieri'],
  spicchio: ['spicchio', 'spicchi'],
  foglia: ['foglia', 'foglie', 'foglioline'],
  fetta: ['fetta', 'fette'],
  pizzico: ['pizzico', 'pizzichi'],
  rametto: ['rametto', 'rametti'],
  ciuffo: ['ciuffo', 'ciuffi'],
  mazzetto: ['mazzetto', 'mazzetti'],
  noce: ['noce'],
  bustina: ['bustina', 'bustine'],
  vasetto: ['vasetto', 'vasetti'],
  scatola: ['scatola', 'scatole'],
  lattina: ['lattina', 'lattine'],
  'q.b.': ['q.b.', 'qb', 'q.b'],
};
const ALIAS = Object.fromEntries(Object.entries(UNIT_ALIASES).flatMap(([k, v]) => v.map((a) => [a, k])));
export const RECIPE_UNITS = ['', 'g', 'kg', 'ml', 'l', 'pz', 'conf', 'cucchiaio', 'cucchiaino', 'spicchio', 'foglia', 'fetta', 'pizzico', 'q.b.'];

export function normUnit(u) {
  if (u == null) return '';
  const k = String(u).trim().toLowerCase();
  return ALIAS[k] ?? k;
}

const BASE = { g: ['m', 1], kg: ['m', 1000], ml: ['v', 1], cl: ['v', 10], dl: ['v', 100], l: ['v', 1000] };
const SPOON_ML = { cucchiaio: 15, cucchiaino: 5, tazza: 240, bicchiere: 200 };

// Converte qty da un'unita' all'altra; null se non si puo' (es. "2 spicchi" -> kg).
export function convert(qty, from, to) {
  if (qty == null) return null;
  const f = normUnit(from) || 'pz';
  const t = normUnit(to) || 'pz';
  if (f === t) return qty;
  if (BASE[f] && BASE[t] && BASE[f][0] === BASE[t][0]) return (qty * BASE[f][1]) / BASE[t][1];
  if (SPOON_ML[f] && BASE[t]?.[0] === 'v') return (qty * SPOON_ML[f]) / BASE[t][1];
  return null;
}

// Arrotonda in modo leggibile per la cucina.
export function niceQty(q, unit) {
  if (q == null) return null;
  const u = normUnit(unit);
  if ((u === 'g' || u === 'ml') && q >= 10) return q >= 100 ? Math.round(q / 5) * 5 : Math.round(q);
  if (q >= 10) return Math.round(q);
  return Math.round(q * 100) / 100;
}
const FRACTIONS = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
const PLURAL = { spicchio: 'spicchi', cucchiaio: 'cucchiai', cucchiaino: 'cucchiaini', foglia: 'foglie', fetta: 'fette', bicchiere: 'bicchieri', tazza: 'tazze', pizzico: 'pizzichi', rametto: 'rametti', bustina: 'bustine', vasetto: 'vasetti', scatola: 'scatole', lattina: 'lattine', ciuffo: 'ciuffi', mazzetto: 'mazzetti' };
export function fmtAmount(q, unit) {
  if (normUnit(unit) === 'q.b.') return 'q.b.';
  if (q == null) return unit || '';
  const n = niceQty(q, unit);
  const int = Math.floor(n);
  const frac = Math.round((n - int) * 100) / 100;
  const txt = FRACTIONS[frac] && !['g', 'ml', 'kg', 'l'].includes(normUnit(unit)) ? `${int || ''}${FRACTIONS[frac]}` : fmtQty(n);
  const u = n > 1 && PLURAL[normUnit(unit)] ? PLURAL[normUnit(unit)] : unit;
  return u ? `${txt} ${u}` : txt;
}

// ── Parsing righe ingrediente: "200 g spaghetti", "2 spicchi d'aglio", "Sale q.b.", "Spaghetti 320 g" ──
const NUM = '(\\d+(?:[.,]\\d+)?(?:\\s*\\/\\s*\\d+)?|½|¼|¾|mezz[oa]|un[oa]?|un\')';
const UNIT_WORDS = Object.keys(ALIAS)
  .filter((a) => a !== 'q.b' && a !== 'q.b.' && a !== 'qb')
  .sort((a, b) => b.length - a.length)
  .map((a) => a.replace(/\./g, '\\.'))
  .join('|');
const RE_LEAD = new RegExp(`^${NUM}\\s*(?:(${UNIT_WORDS})\\.?(?![a-zà-ù]))?\\s*(?:di\\s+|d'\\s*)?(.+)$`, 'i');
const RE_TRAIL = new RegExp(`^(.+?)\\s+${NUM}\\s*(?:(${UNIT_WORDS})\\.?)?$`, 'i');
const RE_QB = /\s*\(?\bq\.?\s?b\.?\)?\s*$/i;

function toNumber(s) {
  if (!s) return null;
  const t = s.toLowerCase().trim();
  if (t === '½' || t.startsWith('mezz')) return 0.5;
  if (t === '¼') return 0.25;
  if (t === '¾') return 0.75;
  if (/^un[oa']?$/.test(t)) return 1;
  if (t.includes('/')) {
    const [a, b] = t.split('/').map((x) => Number(x.trim()));
    return b ? a / b : null;
  }
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseIngredientLine(line) {
  let s = String(line || '').replace(/^[\s\-•*·–]+/, '').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  if (RE_QB.test(s)) return { text: cap(s.replace(RE_QB, '').replace(/[,:]\s*$/, '')), qty: null, unit: 'q.b.' };
  let m = s.match(RE_LEAD);
  if (m) {
    const qty = toNumber(m[1]);
    const unit = m[2] ? normUnit(m[2]) : '';
    return { text: cap(m[3]), qty, unit };
  }
  m = s.match(RE_TRAIL);
  if (m) return { text: cap(m[1].replace(/[,:]\s*$/, '')), qty: toNumber(m[2]), unit: m[3] ? normUnit(m[3]) : '' };
  return { text: cap(s), qty: null, unit: '' };
}
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// ── Match ingrediente -> prodotto del catalogo (regole semplici, senza AI) ──
const STOP = new Set(['di', 'd', 'del', 'della', 'dello', 'dei', 'degli', 'delle', 'il', 'lo', 'la', 'i', 'gli', 'le', 'l', 'e', 'a', 'al', 'alla', 'con', 'per', 'in', 'da', 'fresco', 'fresca', 'freschi', 'fresche']);
function tokens(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/[aeio]$/, '') : w));
}

export function matchProduct(text, products) {
  const tt = tokens(text);
  if (!tt.length) return null;
  const set = new Set(tt);
  let best = null;
  let bestScore = 0;
  for (const p of Object.values(products)) {
    if (p.area !== 'cibo' || p.category_id === 'cat-avanzi') continue;
    const pt = tokens(p.name);
    if (!pt.length) continue;
    let score = 0;
    if (pt.every((w) => set.has(w))) score = 100 + pt.join('').length; // tutto il nome del prodotto nel testo
    else if (tt.every((w) => pt.includes(w))) score = 50 - pt.length; // testo generico ("sale" -> "Sale fino")
    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }
  return best;
}

// ── Stato ingredienti rispetto alla dispensa ──
export function stockIn(data, productId, unit) {
  let tot = 0;
  for (const l of data.lots) {
    if (l.product_id !== productId) continue;
    const q = convert(Number(l.qty), l.unit, unit);
    if (q != null) tot += q;
  }
  return Math.round(tot * 1000) / 1000;
}

// level: ok (ce l'ho) · low (poco) · missing (manca) · unlinked (non collegato al catalogo)
export function ingredientStatus(ing, scale, data, subs) {
  const p = ing.product_id && data.products[ing.product_id];
  if (!p) return { level: 'unlinked' };
  const unit = p.default_unit;
  const have = stockIn(data, p.id, unit);
  const vague = ing.qty == null || normUnit(ing.unit) === 'q.b.';
  const need = vague ? null : convert(ing.qty * scale, ing.unit, unit);
  let level;
  if (have <= 0) level = 'missing';
  else if (need == null || have >= need - 1e-6) level = 'ok';
  else level = 'low';
  const res = { level, have, need, unit, product: p, missing: need != null ? Math.max(0, need - have) : null };
  if (level !== 'ok') {
    for (const s of subs[p.id] || []) {
      const sp = data.products[s.substitute_id];
      if (!sp) continue;
      const sHave = stockIn(data, sp.id, sp.default_unit);
      const sNeed = vague ? null : convert(ing.qty * scale * (s.ratio || 1), ing.unit, sp.default_unit);
      if (sHave > 0 && (sNeed == null || sHave >= sNeed - 1e-6)) {
        res.sub = { ...s, product: sp, need: sNeed };
        break;
      }
    }
  }
  return res;
}

export function recipeStatus(ings, scale, data, subs) {
  const rows = ings.map((ing) => ({ ing, st: ingredientStatus(ing, scale, data, subs) }));
  const req = rows.filter((r) => !r.ing.optional && r.st.level !== 'unlinked');
  const missing = req.filter((r) => (r.st.level === 'missing' || r.st.level === 'low') && !r.st.sub);
  return {
    rows,
    missing: missing.length,
    withSub: req.filter((r) => r.st.sub).length,
    unlinked: rows.filter((r) => r.st.level === 'unlinked').length,
    feasible: req.length > 0 && missing.length === 0,
  };
}

// Raggruppa le righe delle tabelle figlie per ricetta.
export async function loadRecipes() {
  const [recipes, ings, steps, subs] = await Promise.all([
    db.recipes.toArray(),
    db.recipe_ingredients.toArray(),
    db.recipe_steps.toArray(),
    db.substitutions.toArray(),
  ]);
  const group = (arr) => {
    const g = {};
    for (const r of arr.filter(alive)) (g[r.recipe_id] ||= []).push(r);
    for (const k in g) g[k].sort((a, b) => a.sort - b.sort);
    return g;
  };
  const subsBy = {};
  for (const s of subs.filter(alive)) (subsBy[s.product_id] ||= []).push(s);
  return {
    list: recipes.filter(alive).sort((a, b) => a.title.localeCompare(b.title, 'it')),
    byId: Object.fromEntries(recipes.filter(alive).map((r) => [r.id, r])),
    ings: group(ings),
    steps: group(steps),
    subs: subsBy,
    subList: subs.filter(alive),
  };
}

// Tag dieta suggeriti dagli ingredienti collegati (Andrea conferma).
export function suggestDiet(recipe, ings, data) {
  const out = [];
  const total = (Number(recipe.prep_min) || 0) + (Number(recipe.cook_min) || 0);
  if (recipe.prep_min != null && recipe.cook_min != null && total > 0 && total <= 30) out.push('veloce');
  const req = ings.filter((i) => !i.optional);
  if (!req.length || req.some((i) => !data.products[i.product_id])) return out;
  const cats = new Set(req.map((i) => data.products[i.product_id].category_id));
  const has = (...c) => c.some((x) => cats.has(x));
  if (!has('cat-carne', 'cat-pesce', 'cat-salumi')) {
    out.push('vegetariano');
    if (!has('cat-latte', 'cat-formaggi', 'cat-uova')) out.push('vegano');
  }
  if (!has('cat-latte', 'cat-formaggi')) out.push('senza lattosio');
  return out;
}

// "Aggiungi mancanti alla lista"
export async function addMissingToList(recipe, status, data) {
  const inList = new Set(data.shopping.filter((s) => !s.checked).map((s) => s.product_id).filter(Boolean));
  const ops = [];
  for (const { ing, st } of status.rows) {
    if (ing.optional || st.sub || !(st.level === 'missing' || st.level === 'low')) continue;
    if (inList.has(st.product.id)) continue;
    inList.add(st.product.id);
    const qty = st.missing != null && st.missing > 0 ? niceQty(st.missing, st.unit) : 1;
    ops.push({
      table: 'shopping_items',
      row: { product_id: st.product.id, qty: Math.max(qty, 0.001), unit: st.unit, origin: 'ricetta', checked: 0, note: recipe.title },
    });
  }
  if (ops.length) await save(ops, `${recipe.title}: ${ops.length} mancanti in lista`);
  return ops.length;
}

// Consuma qty (in unita' prodotto) dai lotti piu' vicini alla scadenza.
function consumeOps(product, qty, data) {
  const lots = data.lots
    .filter((l) => l.product_id === product.id)
    .sort((a, b) => {
      const la = lotLimit(a, product);
      const lb = lotLimit(b, product);
      return (la ? la.getTime() : Infinity) - (lb ? lb.getTime() : Infinity);
    });
  const ops = [];
  let toTake = qty;
  for (const l of lots) {
    if (toTake <= 1e-9) break;
    const lotQty = convert(Number(l.qty), l.unit, product.default_unit);
    if (lotQty == null || lotQty <= 0) continue;
    const take = Math.min(lotQty, toTake);
    toTake -= take;
    const leftInLotUnit = Math.round(convert(lotQty - take, product.default_unit, l.unit) * 1000) / 1000;
    ops.push({ table: 'stock_lots', row: leftInLotUnit > 0 ? { id: l.id, qty: leftInLotUnit } : { id: l.id, qty: 0, deleted: 1 } });
  }
  return ops;
}

// "Ho cucinato": scala la dispensa, registra eventi, crea avanzi in frigo/freezer.
// uses: [{ product, qty }] in unita' prodotto. leftovers: { portions, location_id }
export async function cookRecipe({ recipe, servings, uses, leftovers, data }) {
  const date = todayISO();
  const ops = [];
  for (const { product, qty } of uses) {
    if (!(qty > 0)) continue;
    ops.push(...consumeOps(product, qty, data));
    const price = data.lastPrice[product.id];
    ops.push({
      table: 'events',
      row: { type: 'consumo', product_id: product.id, recipe_id: recipe.id, qty, unit: product.default_unit, value: price != null ? Math.round(price * qty * 100) / 100 : null, date },
    });
  }
  ops.push({ table: 'events', row: { type: 'cucinato', recipe_id: recipe.id, qty: servings, unit: 'porz', date } });
  ops.push({ table: 'recipes', row: { id: recipe.id, cooked_count: (recipe.cooked_count || 0) + 1, last_cooked_at: date } });

  if (leftovers?.portions > 0) {
    const pid = `p-avanzo-${recipe.id}`;
    const freezer = leftovers.location_id === 'loc-freezer';
    ops.push({
      table: 'products',
      row: { id: pid, name: `Avanzo: ${recipe.title}`, area: 'cibo', category_id: 'cat-avanzi', default_unit: 'pz', default_location_id: 'loc-frigo', freezer_max_months: 3, deleted: 0 },
    });
    ops.push({
      table: 'stock_lots',
      row: {
        product_id: pid,
        qty: leftovers.portions,
        unit: 'pz',
        location_id: leftovers.location_id,
        expiry_date: freezer ? null : format(addDays(new Date(), 3), 'yyyy-MM-dd'),
        frozen_at: freezer ? date : null,
        is_leftover: 1,
        note: `${fmtQty(leftovers.portions)} porzioni`,
      },
    });
  }
  await save(ops, `Cucinato: ${recipe.title}`);
  await autoAddBelowStock();
}

// Quantita' proposte per "Ho cucinato" (solo cio' che e' convertibile nell'unita' del prodotto).
export function proposedUses(status) {
  const map = new Map();
  for (const { ing, st } of status.rows) {
    const src = st.level !== 'ok' && st.sub ? { product: st.sub.product, need: st.sub.need } : st.product ? { product: st.product, need: st.need } : null;
    if (!src || (ing.optional && st.level !== 'ok')) continue;
    if (!st.sub && !(st.have > 0)) continue; // niente in casa: niente da scalare
    const cur = map.get(src.product.id) || { product: src.product, qty: 0, known: true, label: [] };
    if (src.need == null) cur.known = cur.qty > 0;
    else cur.qty += src.need;
    cur.label.push(ing.text);
    map.set(src.product.id, cur);
  }
  return [...map.values()].map((u) => ({ ...u, qty: niceQty(u.qty, u.product.default_unit) || 0 }));
}

// Testo condivisibile (WhatsApp ecc.)
export function recipeToText(recipe, ings, steps, scale) {
  const lines = [`🍳 ${recipe.title}`, `Porzioni: ${fmtQty(recipe.servings * scale)}`];
  const t = [recipe.prep_min && `prep ${recipe.prep_min}′`, recipe.cook_min && `cottura ${recipe.cook_min}′`, recipe.rest_min && `riposo ${recipe.rest_min}′`].filter(Boolean);
  if (t.length) lines.push(`Tempi: ${t.join(' · ')}`);
  lines.push('', 'Ingredienti:');
  let grp = null;
  for (const i of ings) {
    if ((i.grp || null) !== grp) {
      grp = i.grp || null;
      if (grp) lines.push(`${grp}:`);
    }
    lines.push(`- ${i.text}${i.qty != null || i.unit ? ` ${fmtAmount(i.qty != null ? i.qty * scale : null, i.unit)}` : ''}${i.optional ? ' (facoltativo)' : ''}`);
  }
  if (steps.length) {
    lines.push('', 'Preparazione:');
    steps.forEach((s, n) => lines.push(`${n + 1}. ${s.text}`));
  }
  if (recipe.source_url) lines.push('', recipe.source_url);
  return lines.join('\n');
}

// Minuti di timer suggeriti dal testo del passaggio ("cuocere 10 minuti", "per 1 ora").
export function detectTimer(text) {
  const s = String(text || '').toLowerCase();
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*or[ae]\b/);
  const m = s.match(/(\d+)(?:\s*[-–]\s*(\d+))?\s*(?:minuti|min\.?|′)(?![a-z])/);
  if (m) return Number(m[2] || m[1]);
  if (h) return Math.round(Number(h[1].replace(',', '.')) * 60);
  return null;
}
