import { apiFetch } from '../api/client.js';
import { db, alive, uuid } from './db.js';
import { save } from './repo.js';
import { addPhoto, fileToDataUrl } from './photos.js';
import { matchProduct, convert, niceQty } from './recipes.js';

// Scontrino con l'AI: foto -> bozza di check-in da rivedere (niente entra in dispensa senza conferma).
// 0.14: la bozza letta resta salvata (tabella settings, id "scontrino-…", sincronizzata) finche' non la registri o la elimini:
// chiudere con la X non butta la lettura (e i token).
export const DRAFT_PREFIX = 'scontrino-';
export function draftToJson(r, form = {}) {
  return {
    chain: r.chain || null, branch: r.branch || '', date: r.date || null, total: r.total ?? null, photo_key: r.photo_key || null, model: r.model || null,
    created_at: r.created_at || Date.now(),
    form,
    lines: (r.lines || []).map((l) => ({
      key: l.key, raw: l.raw || null, name: l.name || null, count: l.count ?? null, size: l.size ?? null, size_unit: l.size_unit || null,
      qty: l.qty, unit: l.unit, price_paid: l.price_paid ?? '', price_full: l.price_full ?? '', location_id: l.location_id || null, expiry_date: l.expiry_date || '',
      product_id: l.p?.id || null, item_id: l.it?.id || null,
    })),
  };
}
export function draftFromJson(id, d, data) {
  return {
    ...d,
    draftId: id,
    lines: (d.lines || []).map((l) => ({ ...l, p: (l.product_id && data.products[l.product_id]) || null, it: (l.item_id && data.shopping.find((s) => s.id === l.item_id)) || null })),
  };
}
export const saveDraft = (id, r, form) => save([{ table: 'settings', row: { id, value: JSON.stringify(draftToJson(r, form)), deleted: 0 } }]);
export const deleteDraft = (id, label = 'Scontrino eliminato') => save([{ table: 'settings', row: { id, deleted: 1 } }], label);
export const newDraftId = () => `${DRAFT_PREFIX}${uuid()}`;

export const normRaw = (s) =>
  String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export async function readReceipt(files, data) {
  const images = await Promise.all(files.map((f) => fileToDataUrl(f, 2200, 0.85)));
  const photo_key = await addPhoto(files[0], 2200); // foto scontrino conservata (cancellabile)
  const catalog = Object.values(data.products)
    .filter((p) => p.category_id !== 'cat-avanzi')
    .map((p) => p.name);
  const stores = data.stores.map((s) => [s.chain, s.branch].filter(Boolean).join(' '));
  const res = await apiFetch('/api/ai/receipt', { method: 'POST', body: JSON.stringify({ images, catalog, stores }) });
  const aliases = (await db.receipt_aliases.toArray()).filter(alive);
  return { ...buildDraft(res.receipt || {}, data, aliases), photo_key, model: res.model };
}

// Quantita' e unita' del lotto per un prodotto: formato confezione convertito se possibile.
export function lineQty(line, p) {
  const q = line.size ? convert((line.count || 1) * line.size, line.size_unit, p.default_unit) : null;
  if (q != null) return { qty: niceQty(q, p.default_unit), unit: p.default_unit };
  return { qty: line.count || 1, unit: ['pz', 'conf'].includes(p.default_unit) ? p.default_unit : 'conf' };
}

export function buildDraft(r, data, aliases) {
  const byAlias = new Map(aliases.filter((a) => data.products[a.product_id]).map((a) => [normRaw(a.text), data.products[a.product_id]]));
  const byName = new Map(Object.values(data.products).map((p) => [p.name.toLowerCase(), p]));
  const used = new Set();
  const lines = (r.lines || [])
    .filter((l) => l && (l.raw || l.name) && num(l.price_paid) != null)
    .map((l, i) => {
      const raw = String(l.raw || l.name).trim();
      const p = byAlias.get(normRaw(raw)) || (l.catalog && byName.get(String(l.catalog).toLowerCase())) || matchProduct(l.name || raw, data.products, { anyArea: true }) || null;
      const count = num(l.count) || 1;
      const size = num(l.size_qty);
      const { qty, unit } = p ? lineQty({ count, size, size_unit: l.size_unit }, p) : { qty: count, unit: 'pz' };
      const it = p && data.shopping.find((s) => s.product_id === p.id && !used.has(s.id));
      if (it) used.add(it.id);
      const paid = num(l.price_paid);
      const full = num(l.price_full);
      return {
        key: `ocr-${i}`,
        it: it || null,
        p,
        raw,
        name: l.name || raw,
        count,
        size,
        size_unit: l.size_unit || null,
        qty,
        unit,
        price_paid: paid != null ? paid.toFixed(2) : '',
        price_full: full != null && full > paid ? full.toFixed(2) : '',
        location_id: p?.default_location_id || 'loc-altro',
        expiry_date: '',
      };
    });
  const chain = matchChain(r.chain, data.stores);
  return { chain, branch: r.branch || '', date: /^\d{4}-\d{2}-\d{2}$/.test(r.date || '') ? r.date : null, total: num(r.total), lines };
}

function matchChain(c, stores) {
  if (!c) return null;
  const n = normRaw(c);
  const known = [...new Set(stores.map((s) => s.chain))];
  return known.find((k) => n.includes(normRaw(k)) || normRaw(k).includes(n)) || String(c).trim();
}
