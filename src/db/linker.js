import { apiFetch } from '../api/client.js';
import { uuid } from './db.js';
import { save } from './repo.js';
import { ingKey, tokens, learnedLinks, matchProduct, normUnit, NO_PRODUCT } from './recipes.js';

// "Collega ingredienti": raggruppa gli ingredienti senza prodotto, propone un collegamento
// (memoria -> regole -> simile -> AI) e lo applica in blocco. L'AI propone, Andrea conferma.

const MASS = ['g', 'kg'];
const VOL = ['ml', 'cl', 'dl', 'l', 'cucchiaio', 'cucchiaino', 'tazza', 'bicchiere'];

// Unita' del nuovo prodotto dedotta dalle unita' usate nelle ricette (se l'AI non la da').
function unitFromUsage(ings) {
  const n = { g: 0, ml: 0, pz: 0 };
  for (const i of ings) {
    const u = normUnit(i.unit);
    if (MASS.includes(u)) n.g++;
    else if (VOL.includes(u)) n.ml++;
    else if (u && u !== 'q.b.') n.pz++;
  }
  const best = Object.entries(n).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : 'g';
}

// Prodotto "simile": stesso primo termine ("Pecorino romano DOP" -> "Pecorino"). Proposta da confermare.
function similarProduct(text, products) {
  const tt = tokens(text);
  if (!tt.length) return null;
  let best = null;
  for (const p of Object.values(products)) {
    if (p.area !== 'cibo' || p.category_id === 'cat-avanzi') continue;
    const pt = tokens(p.name);
    if (!pt.length || pt[0] !== tt[0]) continue;
    const common = pt.filter((w) => tt.includes(w)).length;
    if (!best || common > best.common || (common === best.common && pt.length < best.len)) best = { p, common, len: pt.length };
  }
  return best?.p || null;
}

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Gruppi di ingredienti non collegati. ai = { [key]: proposta AI } (cache della sessione).
export function unlinkedGroups(rec, data, ai = {}) {
  const learned = learnedLinks(rec.ings, data.products);
  const groups = new Map();
  for (const r of rec.list) {
    for (const i of rec.ings[r.id] || []) {
      if (i.product_id === NO_PRODUCT || (i.product_id && data.products[i.product_id])) continue;
      const key = ingKey(i.text) || i.text.toLowerCase();
      const g = groups.get(key) || { key, ings: [], recipes: new Map(), texts: {} };
      g.ings.push(i);
      g.recipes.set(r.id, r.title);
      g.texts[i.text] = (g.texts[i.text] || 0) + 1;
      groups.set(key, g);
    }
  }
  const out = [];
  for (const g of groups.values()) {
    g.text = Object.entries(g.texts).sort((a, b) => b[1] - a[1])[0][0];
    let prop = null;
    const mem = learned[g.key];
    if (mem === NO_PRODUCT) prop = { kind: 'skip', source: 'memoria' };
    else if (mem && data.products[mem]) prop = { kind: 'link', product: data.products[mem], source: 'memoria', sure: true };
    if (!prop) {
      const p = matchProduct(g.text, data.products);
      if (p) prop = { kind: 'link', product: p, source: 'regole', sure: true };
    }
    if (!prop && ai[g.key]) prop = ai[g.key];
    if (!prop) {
      const p = similarProduct(g.text, data.products);
      if (p) prop = { kind: 'link', product: p, source: 'simile', sure: false };
    }
    if (prop?.kind === 'new') {
      // nel frattempo il prodotto puo' essere stato creato (altro gruppo, altro device)
      const same = Object.values(data.products).find((p) => p.area === 'cibo' && p.name.toLowerCase() === prop.draft.name.toLowerCase());
      if (same) prop = { kind: 'link', product: same, source: prop.source, sure: true };
    }
    out.push({ ...g, count: g.ings.length, prop });
  }
  return out.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, 'it'));
}

// Proposte AI per i gruppi senza proposta sicura. Lotti da 30 (limite di risposta del modello).
export async function aiProposals(groups, data, { onProgress } = {}) {
  const catalog = Object.values(data.products).filter((p) => p.area === 'cibo' && p.category_id !== 'cat-avanzi').map((p) => p.name);
  const byName = new Map(Object.values(data.products).filter((p) => p.area === 'cibo').map((p) => [p.name.toLowerCase(), p]));
  const categories = data.categoryList.filter((c) => c.area === 'cibo' && c.id !== 'cat-avanzi').map((c) => ({ id: c.id, name: c.name }));
  const catIds = new Set(categories.map((c) => c.id));
  const LOC = { frigo: 'loc-frigo', freezer: 'loc-freezer', dispensa: 'loc-dispensa' };
  const out = {};
  const BATCH = 30;
  for (let s = 0; s < groups.length; s += BATCH) {
    const part = groups.slice(s, s + BATCH);
    const res = await apiFetch('/api/ai/match', { method: 'POST', body: JSON.stringify({ items: part.map((g) => g.text), catalog, categories }) });
    res.items.forEach((r, n) => {
      const g = part[n];
      if (!g) return;
      if (r.skip) out[g.key] = { kind: 'skip', source: 'AI' };
      else if (r.catalog && byName.get(r.catalog.toLowerCase())) out[g.key] = { kind: 'link', product: byName.get(r.catalog.toLowerCase()), source: 'AI', sure: false };
      else if (r.new) {
        const unit = ['g', 'kg', 'ml', 'l', 'pz', 'conf'].includes(r.new.unit) ? r.new.unit : unitFromUsage(g.ings);
        out[g.key] = {
          kind: 'new',
          source: 'AI',
          sure: false,
          draft: {
            name: cap(r.new.name.slice(0, 60)),
            category_id: catIds.has(r.new.category_id) ? r.new.category_id : 'cat-spezie',
            default_unit: unit,
            default_location_id: LOC[r.new.location] || 'loc-dispensa',
          },
        };
      }
    });
    onProgress?.(Math.min(s + BATCH, groups.length), groups.length);
  }
  return out;
}

// Applica le scelte: [{ group, prop }] con prop link|new|skip. Un'unica operazione (annullabile).
export async function applyLinks(choices, label) {
  const ops = [];
  const created = new Map(); // nome -> id (due gruppi che creano lo stesso prodotto)
  for (const { group, prop } of choices) {
    let pid = null;
    if (prop.kind === 'skip') pid = NO_PRODUCT;
    else if (prop.kind === 'link') pid = prop.product.id;
    else if (prop.kind === 'new') {
      const k = prop.draft.name.toLowerCase();
      pid = created.get(k);
      if (!pid) {
        pid = uuid();
        created.set(k, pid);
        ops.push({ table: 'products', row: { id: pid, area: 'cibo', favorite: 0, essential: 0, deleted: 0, ...prop.draft, name: prop.draft.name.trim() } });
      }
    }
    if (!pid) continue;
    for (const i of group.ings) ops.push({ table: 'recipe_ingredients', row: { id: i.id, product_id: pid } });
  }
  if (ops.length) await save(ops, label);
  return { ingredients: ops.filter((o) => o.table === 'recipe_ingredients').length, products: created.size };
}

// Quanti ingredienti restano da collegare (per il banner nel ricettario).
export function countUnlinked(rec, data) {
  let n = 0;
  for (const r of rec.list) for (const i of rec.ings[r.id] || []) if (i.product_id !== NO_PRODUCT && !(i.product_id && data.products[i.product_id])) n++;
  return n;
}
