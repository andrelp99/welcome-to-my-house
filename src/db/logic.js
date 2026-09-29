import { addDays, addMonths, differenceInCalendarDays, parseISO, format } from 'date-fns';
import { db, alive } from './db.js';
import { save } from './repo.js';

export const UNITS = ['pz', 'conf', 'g', 'kg', 'ml', 'l'];
export const todayISO = () => format(new Date(), 'yyyy-MM-dd');
export const FREEZER_DEFAULT_MONTHS = 3;

// Data limite effettiva di un lotto: scadenza, apertura + giorni, congelamento + mesi (la piu' vicina).
export function lotLimit(lot, product) {
  const dates = [];
  if (lot.expiry_date && !lot.frozen_at) dates.push(parseISO(lot.expiry_date));
  if (lot.opened_at && product?.open_shelf_days && !lot.frozen_at)
    dates.push(addDays(parseISO(lot.opened_at), product.open_shelf_days));
  if (lot.frozen_at)
    dates.push(addMonths(parseISO(lot.frozen_at), product?.freezer_max_months || FREEZER_DEFAULT_MONTHS));
  if (!dates.length) return null;
  return dates.reduce((a, b) => (a < b ? a : b));
}

// ── Durate per luogo ──
// Dispensa e frigo: giorni da quando entra in casa. Freezer: mesi (freezer_max_months). Vuoto = non ci va,
// ma solo se il prodotto ha almeno una durata impostata (altrimenti va ovunque, come prima).
export const LOC_DAYS = { 'loc-dispensa': 'pantry_days', 'loc-frigo': 'fridge_days' };
const set_ = (v) => v != null && v !== '';
export const hasDurations = (p) => !!p && p.area === 'cibo' && (set_(p.pantry_days) || set_(p.fridge_days));
export function allowedLocation(p, locId) {
  if (!hasDurations(p)) return true;
  if (locId === 'loc-freezer') return set_(p.freezer_max_months);
  const k = LOC_DAYS[locId];
  return k ? set_(p[k]) : true; // "altro" sempre
}
// Scadenza proposta per un lotto che entra in un luogo (null se il prodotto non ha la durata per quel luogo).
export function autoExpiry(p, locId, from = todayISO()) {
  const k = LOC_DAYS[locId];
  if (!p || !k || !set_(p[k])) return null;
  return format(addDays(parseISO(from), Number(p[k])), 'yyyy-MM-dd');
}
// Durata in parole per un luogo: "7 gg", "3 mesi".
export function durationLabel(p, locId) {
  if (locId === 'loc-freezer') return set_(p?.freezer_max_months) ? `${p.freezer_max_months} mesi` : null;
  const k = LOC_DAYS[locId];
  return k && set_(p?.[k]) ? `${p[k]} gg` : null;
}

// ── Usi / porzioni per unita' (dado 10 per conf, pasta 12 per kg, pesto 3 per vasetto, parmigiano 20 per 100 g) ──
// Salvati in products.uses_per_pack come usi per 1 unita' del prodotto; per g/ml si mostrano "per 100".
export const useBase = (unit) => (unit === 'g' || unit === 'ml' ? 100 : 1);
export const usesOf = (p) => (Number(p?.uses_per_pack) > 0 ? Number(p.uses_per_pack) : null);
export const usesShown = (p) => (usesOf(p) ? Math.round(usesOf(p) * useBase(p.default_unit) * 100) / 100 : null);
export const usesFromShown = (v, unit) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return v === '' || v == null || !(n > 0) ? null : n / useBase(unit);
};
export const usesUnitLabel = (unit) => (useBase(unit) === 100 ? `100 ${unit}` : unit || 'unità');
// Categoria "a utilizzo" (salse, spezie...): i suoi prodotti vanno contati in usi.
export const byUse = (p, categories) => !!categories?.[p?.category_id]?.by_use;
// "2 conf · ~20 usi"
export function qtyLabel(qty, unit, p) {
  const u = usesOf(p);
  const base = `${fmtQty(Math.round(qty * 1000) / 1000)} ${unit}`;
  return u && unit === p.default_unit ? `${base} · ~${fmtQty(Math.round(qty * u * 10) / 10)} usi` : base;
}
// Usi fatti / rimasti di un lotto: le unita' iniziate (per eccesso) contano come piene.
export function lotUses(qty, p) {
  const u = usesOf(p);
  if (!u) return null;
  const units = Math.max(1, Math.ceil(Number(qty) - 1e-9));
  const left = Math.round(Number(qty) * u * 10) / 10;
  return { units, total: units * u, left, used: Math.max(0, Math.round((units * u - left) * 10) / 10) };
}
// Passo del "-" in dispensa: 1 uso se il prodotto ha gli usi.
export const stepForProduct = (p, unit) => (usesOf(p) && unit === p.default_unit ? 1 / usesOf(p) : stepFor(unit));

// Semaforo: scaduto (rosso) / in scadenza entro anticipo del luogo (giallo) / ok (verde) / senza data.
export function lotStatus(lot, product, location) {
  const limit = lotLimit(lot, product);
  if (!limit) return { level: 'none', days: null, limit: null };
  const days = differenceInCalendarDays(limit, new Date());
  const warn = location?.expiry_warn_days ?? 7;
  const level = days < 0 ? 'expired' : days <= warn ? 'soon' : 'ok';
  return { level, days, limit };
}

export const LEVEL_ORDER = { expired: 0, soon: 1, ok: 2, none: 3 };

export function daysLabel(days) {
  if (days == null) return 'senza data';
  if (days < -1) return `scaduto da ${-days} gg`;
  if (days === -1) return 'scaduto ieri';
  if (days === 0) return 'scade oggi';
  if (days === 1) return 'scade domani';
  return `tra ${days} gg`;
}

// Carica tutto quello che serve alle viste inventario in un colpo solo (dataset piccolo).
export async function loadAll() {
  const [products, lots, locations, categories, shopping, lines, stores, receipts] = await Promise.all([
    db.products.toArray(),
    db.stock_lots.toArray(),
    db.locations.toArray(),
    db.categories.toArray(),
    db.shopping_items.toArray(),
    db.purchase_lines.toArray(),
    db.stores.toArray(),
    db.receipts.toArray(),
  ]);
  const byId = (arr) => Object.fromEntries(arr.filter(alive).map((r) => [r.id, r]));
  const P = byId(products);
  const L = byId(locations);
  const C = byId(categories);
  const liveLots = lots.filter((l) => alive(l) && l.qty > 0 && P[l.product_id]);
  const stock = {};
  for (const l of liveLots) stock[l.product_id] = (stock[l.product_id] || 0) + Number(l.qty);
  // ultimo prezzo pagato per prodotto (stima costo lista)
  const lastPrice = {};
  const lastPriceUnit = {}; // unita' della riga d'acquisto a cui si riferisce lastPrice
  const linePrice = {}; // prezzo unitario della riga d'acquisto (valore esatto del lotto)
  const liveLines = lines.filter(alive).sort((a, b) => a.updated_at - b.updated_at);
  for (const pl of liveLines)
    if (pl.price_paid != null && pl.qty) {
      lastPrice[pl.product_id] = pl.price_paid / pl.qty;
      lastPriceUnit[pl.product_id] = pl.unit || null;
      linePrice[pl.id] = pl.price_paid / pl.qty;
    }
  // ultimo prezzo per catena (stima lista per supermercato)
  const S = byId(stores);
  const R = byId(receipts);
  const lastPriceByChain = {};
  for (const pl of liveLines) {
    const chain = S[R[pl.receipt_id]?.store_id]?.chain;
    if (chain && pl.price_paid != null && pl.qty && pl.product_id) (lastPriceByChain[chain] ||= {})[pl.product_id] = pl.price_paid / pl.qty;
  }
  return {
    products: P,
    locations: L,
    categories: C,
    stores: stores.filter(alive).sort((a, b) => (a.chain + (a.branch || '')).localeCompare(b.chain + (b.branch || ''))),
    lots: liveLots,
    stock,
    lastPrice,
    lastPriceUnit,
    lastPriceByChain,
    linePrice,
    shopping: shopping.filter(alive),
    locationList: Object.values(L).sort((a, b) => a.sort - b.sort),
    categoryList: Object.values(C).sort((a, b) => a.sort - b.sort),
  };
}

export function minStock(p, categories) {
  if (!p.essential) return null;
  return p.min_stock ?? categories[p.category_id]?.default_stock ?? 1;
}

export function belowStock(data) {
  return Object.values(data.products).filter((p) => {
    const m = minStock(p, data.categories);
    return m != null && (data.stock[p.id] || 0) < m;
  });
}

// Essenziali sotto scorta -> in lista spesa (se non gia' presenti). Chiamata dopo modifiche alle scorte.
export async function autoAddBelowStock() {
  const data = await loadAll();
  const inList = new Set(data.shopping.map((s) => s.product_id).filter(Boolean));
  const ops = belowStock(data)
    .filter((p) => !inList.has(p.id))
    .map((p) => {
      const m = minStock(p, data.categories);
      return {
        table: 'shopping_items',
        row: { product_id: p.id, qty: Math.max(1, m - (data.stock[p.id] || 0)), unit: p.default_unit, origin: 'scorta', checked: 0 },
      };
    });
  if (ops.length) await save(ops, `Sotto scorta: ${ops.length} in lista spesa`);
  return ops.length;
}

// Imposta la quantita' totale di un prodotto (conta rapida). Aumenti -> lotto nuovo/ultimo; cali -> consuma dal piu' vicino a scadere.
export async function setTotalQty(product, target, data) {
  const lots = data.lots
    .filter((l) => l.product_id === product.id)
    .sort((a, b) => {
      const la = lotLimit(a, product);
      const lb = lotLimit(b, product);
      return (la ? la.getTime() : Infinity) - (lb ? lb.getTime() : Infinity);
    });
  const current = lots.reduce((s, l) => s + Number(l.qty), 0);
  let diff = Math.round((target - current) * 1000) / 1000;
  if (diff === 0) return;
  const ops = [];
  if (diff > 0) {
    const last = lots[lots.length - 1];
    const loc = product.default_location_id || 'loc-altro';
    const exp = autoExpiry(product, loc);
    if (last && !last.expiry_date && !exp) ops.push({ table: 'stock_lots', row: { id: last.id, qty: Math.round((Number(last.qty) + diff) * 1000) / 1000 } });
    else
      ops.push({
        table: 'stock_lots',
        row: { product_id: product.id, qty: diff, unit: product.default_unit, location_id: loc, expiry_date: exp, frozen_at: loc === 'loc-freezer' ? todayISO() : null },
      });
  } else {
    let toTake = -diff;
    let value = 0;
    let known = false;
    for (const l of lots) {
      if (toTake <= 0) break;
      const take = Math.min(Number(l.qty), toTake);
      toTake -= take;
      const v = lotValue(l, take, data);
      if (v != null) {
        value += v;
        known = true;
      }
      const left = Math.round((Number(l.qty) - take) * 1000) / 1000;
      ops.push({ table: 'stock_lots', row: left > 0 ? { id: l.id, qty: left } : { id: l.id, qty: 0, deleted: 1 } });
    }
    // consumo registrato: serve a previsione esaurimento e statistiche
    ops.push({ table: 'events', row: { type: 'consumo', product_id: product.id, qty: Math.round((-diff - toTake) * 1000) / 1000, unit: product.default_unit, value: known ? Math.round(value * 100) / 100 : null, date: todayISO() } });
  }
  await save(ops, `${product.name}: ${fmtQty(current)} → ${fmtQty(target)}`);
  await autoAddBelowStock();
}

// Valore in euro di una quantita' di un lotto: prezzo della sua riga d'acquisto, altrimenti ultimo prezzo pagato.
export function lotValue(lot, qty, data) {
  const unit = data.linePrice?.[lot.purchase_line_id] ?? data.lastPrice?.[lot.product_id];
  return unit != null ? Math.round(unit * qty * 100) / 100 : null;
}

// Lotto finito (consumo) o buttato (spreco): toglie il lotto e registra l'evento.
export async function closeLot(lot, product, data, type = 'consumo') {
  const qty = Number(lot.qty);
  await save(
    [
      { table: 'stock_lots', row: { id: lot.id, qty: 0, deleted: 1 } },
      { table: 'events', row: { type, product_id: product.id, qty, unit: lot.unit || product.default_unit, value: lotValue(lot, qty, data), date: todayISO() } },
    ],
    `${type === 'buttato' ? 'Buttato' : 'Finito'} ${product.name}`
  );
  await autoAddBelowStock();
}

export function fmtQty(q) {
  const n = Number(q);
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '').replace('.', ',');
}

export function euro(v) {
  if (v == null || Number.isNaN(v)) return '—';
  return v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

export function stepFor(unit) {
  return unit === 'g' || unit === 'ml' ? 50 : unit === 'kg' || unit === 'l' ? 0.5 : 1;
}
