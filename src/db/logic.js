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
  const linePrice = {}; // prezzo unitario della riga d'acquisto (valore esatto del lotto)
  const liveLines = lines.filter(alive).sort((a, b) => a.updated_at - b.updated_at);
  for (const pl of liveLines)
    if (pl.price_paid != null && pl.qty) {
      lastPrice[pl.product_id] = pl.price_paid / pl.qty;
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
    if (last && !last.expiry_date) ops.push({ table: 'stock_lots', row: { id: last.id, qty: Number(last.qty) + diff } });
    else
      ops.push({
        table: 'stock_lots',
        row: { product_id: product.id, qty: diff, unit: product.default_unit, location_id: product.default_location_id || 'loc-altro' },
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
