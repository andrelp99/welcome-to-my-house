// Ricettario → Ingredienti (0.16): tutti gli ingredienti delle ricette, collegamenti, sostituti, "sempre in casa", "sempre non necessario".
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Search, ChevronDown, Sparkles, Loader2, Trash2, Plus, Check, X } from 'lucide-react';
import { Button, IconButton, Empty, ProductPicker, Select } from '../components/ui/kit.jsx';
import { LinkModal } from '../components/recipes.jsx';
import { ProductForm } from '../components/forms.jsx';
import { ingKey, NO_PRODUCT, stockIn } from '../db/recipes.js';
import { unlinkedGroups } from '../db/linker.js';
import { save, put, remove, undo } from '../db/repo.js';
import { fmtQty } from '../db/logic.js';
import { apiFetch } from '../api/client.js';
import { showToast } from '../hooks/useData.js';

const STATUS = {
  unlinked: { label: 'non collegato', cls: 'text-warning border-warning/50' },
  free: { label: 'non serve', cls: 'text-text-muted border-bg-border' },
  always: { label: 'sempre in casa', cls: 'text-positive border-positive/50' },
  stock: { label: 'in dispensa', cls: 'text-positive border-positive/50' },
  out: { label: 'non in dispensa', cls: 'text-negative border-negative/50' },
};
const STATUS_FILTERS = [
  ['all', 'Tutti'],
  ['unlinked', 'Non collegati'],
  ['stock', 'In dispensa'],
  ['out', 'Non in dispensa'],
  ['always', 'Sempre in casa'],
  ['free', 'Non serve'],
];
const FLAG_FILTERS = [
  ['nosubs', 'Senza sostituti'],
  ['subs', 'Con sostituti'],
  ['optional', 'Non necessari'],
  ['many', 'In 3+ ricette'],
];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// Righe: una per prodotto collegato, una per testo (non collegati / "non serve").
function buildRows(rec, data) {
  const by = new Map();
  for (const r of rec.list) {
    for (const i of rec.ings[r.id] || []) {
      const p = i.product_id && i.product_id !== NO_PRODUCT ? data.products[i.product_id] : null;
      const free = i.product_id === NO_PRODUCT;
      const key = p ? `p:${p.id}` : `${free ? 'f' : 't'}:${ingKey(i.text) || i.text.toLowerCase()}`;
      const g = by.get(key) || { key, p, kind: p ? 'product' : free ? 'free' : 'text', ings: [], recipes: new Map(), texts: {} };
      g.ings.push(i);
      g.recipes.set(r.id, r.title);
      g.texts[i.text] = (g.texts[i.text] || 0) + 1;
      by.set(key, g);
    }
  }
  const props = Object.fromEntries(unlinkedGroups(rec, data).map((g) => [`t:${g.key}`, g.prop]));
  return [...by.values()].map((g) => {
    const text = Object.entries(g.texts).sort((a, b) => b[1] - a[1])[0][0];
    const have = g.p ? stockIn(data, g.p.id, g.p.default_unit) : 0;
    const status = g.kind === 'text' ? 'unlinked' : g.kind === 'free' ? 'free' : g.p.always_have ? 'always' : have > 0 ? 'stock' : 'out';
    const subs = g.p ? (rec.subs[g.p.id] || []).filter((s) => data.products[s.substitute_id]) : [];
    const optional = g.ings.filter((i) => i.optional).length;
    return { ...g, name: g.p ? g.p.name : cap(text), text, have, status, subs, optional, count: g.recipes.size, prop: props[g.key] || null };
  });
}

// Sostituti facili: stessa categoria, in dispensa, non gia' sostituti
function easySubs(row, data) {
  if (!row.p?.category_id) return [];
  const taken = new Set([row.p.id, ...row.subs.map((s) => s.substitute_id)]);
  return Object.values(data.products)
    .filter((x) => x.category_id === row.p.category_id && !taken.has(x.id) && (data.stock[x.id] || 0) > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'it'))
    .slice(0, 8);
}

export default function Ingredienti({ rec, data }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [flags, setFlags] = useState(new Set());
  const [sort, setSort] = useState('count');
  const [open, setOpen] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [linking, setLinking] = useState(null); // riga
  const [creating, setCreating] = useState(null); // { row, name }
  const [aiBusy, setAiBusy] = useState(null);
  const [ai, setAi] = useState({}); // product_id -> [{ product, ratio, note }]
  const rows = useMemo(() => buildRows(rec, data), [rec, data]);

  const s = q.trim().toLowerCase();
  const list = rows
    .filter((r) => status === 'all' || r.status === status)
    .filter((r) => !flags.has('nosubs') || (r.p && !r.p.always_have && r.subs.length === 0))
    .filter((r) => !flags.has('subs') || r.subs.length > 0)
    .filter((r) => !flags.has('optional') || r.p?.always_optional || r.optional > 0)
    .filter((r) => !flags.has('many') || r.count >= 3)
    .filter((r) => !s || r.name.toLowerCase().includes(s) || Object.keys(r.texts).some((t) => t.toLowerCase().includes(s)))
    .sort(
      sort === 'az'
        ? (a, b) => a.name.localeCompare(b.name, 'it')
        : sort === 'nosubs'
          ? (a, b) => (a.p && !a.subs.length ? 0 : 1) - (b.p && !b.subs.length ? 0 : 1) || b.count - a.count
          : (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'it')
    );
  const counts = Object.fromEntries(STATUS_FILTERS.map(([k]) => [k, k === 'all' ? rows.length : rows.filter((r) => r.status === k).length]));
  const selRows = rows.filter((r) => sel.has(r.key));
  const toggleFlag = (k) => setFlags((f) => {
    const n = new Set(f);
    if (n.has(k)) n.delete(k);
    else {
      n.add(k);
      if (k === 'subs') n.delete('nosubs');
      if (k === 'nosubs') n.delete('subs');
    }
    return n;
  });
  const toggleSel = (k) => setSel((x) => {
    const n = new Set(x);
    n.has(k) ? n.delete(k) : n.add(k);
    return n;
  });

  // ── azioni ──
  async function setAlwaysOptional(targets, on) {
    const ops = [];
    for (const r of targets.filter((x) => x.p)) {
      ops.push({ table: 'products', row: { id: r.p.id, always_optional: on ? 1 : 0, ...(on ? { always_have: 0 } : {}) } });
      for (const i of r.ings) if (!!i.optional !== on) ops.push({ table: 'recipe_ingredients', row: { id: i.id, optional: on ? 1 : 0 } });
    }
    if (!ops.length) return showToast('Seleziona ingredienti collegati');
    await save(ops, on ? `Sempre non necessari: ${targets.length}` : 'Di nuovo necessari');
    showToast(on ? 'Superflui in tutte le ricette' : 'Contano di nuovo in tutte le ricette', { label: 'Annulla', run: () => undo() });
  }
  async function setAlwaysHave(targets, on) {
    const ops = [];
    for (const r of targets) {
      if (r.p) ops.push({ table: 'products', row: { id: r.p.id, always_have: on ? 1 : 0, ...(on ? { always_optional: 0 } : {}) } });
      else if (on) {
        // testo non collegato / "non serve": crea il prodotto "sempre in casa" e collega tutte le righe
        const existing = Object.values(data.products).find((p) => p.name.toLowerCase() === r.name.toLowerCase());
        const pid = existing?.id || `p-sempre-${(ingKey(r.text) || r.text).replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40)}`;
        if (existing) ops.push({ table: 'products', row: { id: pid, always_have: 1, always_optional: 0 } });
        else ops.push({ table: 'products', row: { id: pid, name: r.name, area: 'cibo', category_id: /acqua|ghiaccio/i.test(r.name) ? 'cat-bevande' : 'cat-condimenti', default_unit: 'pz', default_location_id: 'loc-dispensa', favorite: 0, essential: 0, always_have: 1, always_optional: 0, deleted: 0 } });
        for (const i of r.ings) ops.push({ table: 'recipe_ingredients', row: { id: i.id, product_id: pid } });
      }
    }
    if (!ops.length) return;
    await save(ops, on ? `Sempre in casa: ${targets.length}` : 'Non più sempre in casa');
    showToast(on ? 'Sempre in casa: verdi, mai scalati, mai in lista' : 'Tolto “sempre in casa”', { label: 'Annulla', run: () => undo() });
  }
  async function linkRow(r, p) {
    const ops = r.ings.map((i) => ({ table: 'recipe_ingredients', row: { id: i.id, product_id: p.id, ...(p.always_optional ? { optional: 1 } : {}) } }));
    await save(ops, `${r.name} → ${p.name} (${r.ings.length})`);
    showToast(`Collegato in ${r.count} ricett${r.count === 1 ? 'a' : 'e'}`, { label: 'Annulla', run: () => undo() });
    setLinking(null);
  }
  async function skipRow(r) {
    await save(r.ings.map((i) => ({ table: 'recipe_ingredients', row: { id: i.id, product_id: NO_PRODUCT } })), `${r.name}: non serve in dispensa`);
    showToast('Segnato “non serve”', { label: 'Annulla', run: () => undo() });
    setLinking(null);
  }
  async function addSub(r, sp, ratio = 1, note = null) {
    await put('substitutions', { product_id: r.p.id, substitute_id: sp.id, ratio, note }, `Sostituto: ${r.p.name} → ${sp.name}`);
  }
  async function askAi(targets) {
    const items = targets.filter((r) => r.p && !r.p.always_have);
    if (!items.length) return showToast('Seleziona ingredienti collegati');
    const catalog = Object.values(data.products).filter((p) => p.area === 'cibo' && p.category_id !== 'cat-avanzi').map((p) => p.name);
    const byName = new Map(Object.values(data.products).map((p) => [p.name.toLowerCase(), p]));
    setAiBusy({ done: 0, total: items.length });
    try {
      const next = { ...ai };
      for (let i = 0; i < items.length; i += 25) {
        const part = items.slice(i, i + 25);
        const res = await apiFetch('/api/ai/substitutes', { method: 'POST', body: JSON.stringify({ catalog, items: part.map((r) => ({ name: r.p.name, category: data.categories[r.p.category_id]?.name })) }) });
        res.items.forEach((x, n) => {
          const r = part[n];
          if (!r) return;
          const have = new Set(r.subs.map((s) => s.substitute_id));
          next[r.p.id] = x.subs.map((s) => ({ product: byName.get(s.name.toLowerCase()), ratio: s.ratio, note: s.note })).filter((s) => s.product && !have.has(s.product.id));
        });
        setAi({ ...next });
        setAiBusy({ done: Math.min(i + 25, items.length), total: items.length });
      }
      const found = items.reduce((t, r) => t + (next[r.p.id]?.length || 0), 0);
      showToast(found ? `${found} sostituti proposti: tocca ✓ per aggiungerli` : 'Nessun sostituto nuovo dal catalogo');
    } catch (e) {
      showToast(`AI non disponibile: ${e.message}`);
    } finally {
      setAiBusy(null);
    }
  }
  async function acceptAllAi() {
    const ops = [];
    for (const [pid, list] of Object.entries(ai)) for (const s of list) ops.push({ table: 'substitutions', row: { product_id: pid, substitute_id: s.product.id, ratio: s.ratio || 1, note: s.note || null } });
    if (!ops.length) return;
    await save(ops, `Sostituti AI (${ops.length})`);
    setAi({});
    showToast(`Aggiunti ${ops.length} sostituti`, { label: 'Annulla', run: () => undo() });
  }
  const aiCount = Object.values(ai).reduce((t, l) => t + l.length, 0);

  return (
    <div className="space-y-3">
      <p className="text-sm text-text-secondary">Tutti gli ingredienti delle tue ricette: collegali alla dispensa, dai loro dei sostituti, segna quelli sempre in casa o mai necessari.</p>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca ingrediente…" className="w-full rounded-md bg-bg-surface border border-bg-border pl-9 pr-3 py-2.5 focus:outline-none focus:border-brand" />
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k)} className={`rounded-full border px-3 py-1 text-sm ${status === k ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
            {l} <span className="opacity-70">{counts[k]}</span>
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {FLAG_FILTERS.map(([k, l]) => (
          <button key={k} type="button" aria-pressed={flags.has(k)} onClick={() => toggleFlag(k)} className={`rounded-full border px-3 py-1 text-xs ${flags.has(k) ? 'border-brand text-brand bg-brand/10' : 'border-bg-border text-text-secondary'}`}>
            {l}
          </button>
        ))}
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordina" className="!w-auto ml-auto !py-1 text-sm">
          <option value="count">Più usati</option>
          <option value="nosubs">Senza sostituti prima</option>
          <option value="az">A–Z</option>
        </Select>
      </div>

      {status === 'unlinked' && counts.unlinked > 0 && (
        <Link to="/ricette/collega" className="block text-sm text-brand font-semibold">Collegali tutti insieme con l'AI →</Link>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button type="button" className="text-brand font-semibold" onClick={() => setSel(new Set(list.map((r) => r.key)))}>Seleziona tutti ({list.length})</button>
        {sel.size > 0 && <button type="button" className="text-text-muted" onClick={() => setSel(new Set())}>Nessuno</button>}
        {aiCount > 0 && (
          <Button className="ml-auto" onClick={acceptAllAi}><Check size={16} /> Accetta tutti i sostituti AI ({aiCount})</Button>
        )}
      </div>
      {sel.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-lg border border-brand/50 bg-bg-surface shadow-card px-3 py-2">
          <span className="text-sm font-semibold mr-auto">{sel.size} selezionati</span>
          <Button variant="ghost" onClick={() => setAlwaysOptional(selRows, true)}>Non necessari</Button>
          <Button variant="ghost" onClick={() => setAlwaysHave(selRows, true)}>Sempre in casa</Button>
          <Button variant="ghost" onClick={() => askAi(selRows)} disabled={!!aiBusy}>
            {aiBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {aiBusy ? `AI… ${aiBusy.done}/${aiBusy.total}` : 'Sostituti con AI'}
          </Button>
        </div>
      )}

      {list.length === 0 ? (
        <Empty>Nessun ingrediente con questi filtri.</Empty>
      ) : (
        <ul className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
          {list.map((r) => {
            const st = STATUS[r.status];
            const isOpen = open === r.key;
            const easy = isOpen && r.p ? easySubs(r, data) : [];
            const aiList = r.p ? ai[r.p.id] || [] : [];
            return (
              <li key={r.key}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <input type="checkbox" aria-label={`Seleziona ${r.name}`} className="h-4 w-4 accent-brand shrink-0" checked={sel.has(r.key)} onChange={() => toggleSel(r.key)} />
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setOpen(isOpen ? null : r.key)}>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-medium truncate">{r.name}</span>
                      <span className={`shrink-0 rounded-full border px-1.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="text-xs text-text-muted truncate">
                      {r.count} ricett{r.count === 1 ? 'a' : 'e'}
                      {r.p && r.status !== 'always' ? ` · ${r.subs.length ? `sostituti: ${r.subs.map((x) => data.products[x.substitute_id].name).join(', ')}` : 'nessun sostituto'}` : ''}
                      {r.p?.always_optional ? ' · sempre non necessario' : r.optional ? ` · superfluo in ${r.optional}` : ''}
                      {r.status === 'unlinked' && r.prop?.kind === 'link' ? ` · forse: ${r.prop.product.name}` : ''}
                      {r.status === 'stock' ? ` · ${fmtQty(Math.round(r.have * 100) / 100)} ${r.p.default_unit}` : ''}
                    </div>
                  </button>
                  {aiList.length > 0 && <span className="shrink-0 rounded-full bg-brand/15 text-brand text-[10px] font-bold px-1.5">AI {aiList.length}</span>}
                  <ChevronDown size={18} className={`shrink-0 text-text-muted transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </div>
                {isOpen && (
                  <div className="bg-bg-base/50 px-3 pb-3 pt-1 space-y-3 text-sm">
                    {(r.kind === 'text' || r.kind === 'free') && (
                      <div className="flex flex-wrap gap-2">
                        {r.prop?.kind === 'link' && (
                          <Button onClick={() => linkRow(r, r.prop.product)}>Collega a {r.prop.product.name}</Button>
                        )}
                        <Button variant="ghost" onClick={() => setLinking(r)}>{r.kind === 'free' ? 'Collega a un prodotto…' : 'Collega…'}</Button>
                        <Button variant="ghost" onClick={() => setAlwaysHave([r], true)}>Sempre in casa</Button>
                        {r.kind === 'text' && <Button variant="ghost" onClick={() => skipRow(r)}>Non serve</Button>}
                      </div>
                    )}
                    {r.p && (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <ToggleChip on={!!r.p.always_have} onClick={() => setAlwaysHave([r], !r.p.always_have)} label="Sempre in casa" hint="verde, mai scalato, mai in lista" />
                          <ToggleChip on={!!r.p.always_optional} onClick={() => setAlwaysOptional([r], !r.p.always_optional)} label="Sempre non necessario" hint="superfluo in tutte le ricette" />
                          <Button variant="text" onClick={() => setLinking(r)}>Cambia prodotto…</Button>
                        </div>
                        {!r.p.always_have && (
                          <div className="space-y-1.5">
                            <div className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Sostituti</div>
                            {r.subs.length === 0 && <p className="text-text-muted text-xs">Nessuno: se manca, la ricetta non è fattibile.</p>}
                            {r.subs.map((x) => (
                              <SubRow key={x.id} sub={x} data={data} />
                            ))}
                            {aiList.map((x) => (
                              <div key={x.product.id} className="flex items-center gap-2 rounded-md border border-brand/40 bg-brand/5 px-2 py-1">
                                <Sparkles size={14} className="text-brand shrink-0" />
                                <span className="flex-1 min-w-0 truncate">{x.product.name}{x.ratio !== 1 ? ` ×${fmtQty(x.ratio)}` : ''}{x.note ? <span className="text-text-muted"> · {x.note}</span> : null}</span>
                                <IconButton label={`Aggiungi ${x.product.name}`} onClick={async () => { await addSub(r, x.product, x.ratio, x.note); setAi((a) => ({ ...a, [r.p.id]: (a[r.p.id] || []).filter((y) => y.product.id !== x.product.id) })); }}><Check size={16} /></IconButton>
                                <IconButton label="Scarta" onClick={() => setAi((a) => ({ ...a, [r.p.id]: (a[r.p.id] || []).filter((y) => y.product.id !== x.product.id) }))}><X size={16} /></IconButton>
                              </div>
                            ))}
                            {easy.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-xs text-text-muted">Stessa categoria, in dispensa:</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {easy.map((x) => (
                                    <button key={x.id} type="button" onClick={() => addSub(r, x)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand text-brand px-2.5 py-0.5 text-xs">
                                      <Plus size={12} /> {x.name}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            <OtherSub r={r} data={data} onPick={(p) => addSub(r, p)} />
                            <Button variant="text" onClick={() => askAi([r])} disabled={!!aiBusy}><Sparkles size={14} /> Proponi con AI</Button>
                          </div>
                        )}
                      </>
                    )}
                    <div className="space-y-0.5">
                      <div className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Ricette</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {[...r.recipes.entries()].slice(0, 30).map(([id, title]) => (
                          <Link key={id} to={`/ricette/${id}`} className="text-brand text-xs">{title}</Link>
                        ))}
                      </div>
                      {Object.keys(r.texts).length > 1 && <div className="text-xs text-text-muted">Scritto come: {Object.keys(r.texts).join(' · ')}</div>}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {linking && (
        <LinkModal
          ing={{ text: linking.name }}
          data={data}
          onPick={(p) => linkRow(linking, p)}
          onCreate={(name) => setCreating({ row: linking, name })}
          onSkip={linking.kind !== 'free' ? () => skipRow(linking) : undefined}
          onClose={() => setLinking(null)}
        />
      )}
      {creating && (
        <ProductForm
          data={data}
          initialName={creating.name}
          area="cibo"
          onClose={() => setCreating(null)}
          onSaved={(p) => {
            linkRow(creating.row, p);
            setCreating(null);
          }}
        />
      )}
    </div>
  );
}

function ToggleChip({ on, onClick, label, hint }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} title={hint} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${on ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated text-text-secondary'}`}>
      {on ? <Check size={14} /> : null} {label}
    </button>
  );
}

function SubRow({ sub, data }) {
  const [ratio, setRatio] = useState(String(sub.ratio ?? 1).replace('.', ','));
  const sp = data.products[sub.substitute_id];
  const have = (data.stock[sp.id] || 0) > 0;
  async function saveRatio() {
    const v = Number(String(ratio).replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && v !== Number(sub.ratio)) await put('substitutions', { id: sub.id, ratio: v }, `Rapporto ${sp.name} ×${v}`);
  }
  return (
    <div className="flex items-center gap-2 rounded-md border border-bg-border bg-bg-surface px-2 py-1">
      <span className={`w-2 h-2 rounded-full shrink-0 ${have ? 'bg-positive' : 'bg-negative'}`} title={have ? 'in dispensa' : 'non in dispensa'} />
      <span className="flex-1 min-w-0 truncate">{sp.name}{sub.note ? <span className="text-text-muted"> · {sub.note}</span> : null}</span>
      <span className="text-xs text-text-muted">×</span>
      <input inputMode="decimal" aria-label={`Rapporto ${sp.name}`} value={ratio} onChange={(e) => setRatio(e.target.value)} onBlur={saveRatio} className="w-14 rounded-md bg-bg-elevated border border-bg-border px-2 py-0.5 text-right tabular-nums text-xs focus:outline-none focus:border-brand" />
      <IconButton label={`Togli ${sp.name}`} onClick={async () => { await remove('substitutions', sub.id, `Tolto sostituto ${sp.name}`); showToast('Sostituto tolto', { label: 'Annulla', run: () => undo() }); }}><Trash2 size={14} /></IconButton>
    </div>
  );
}

function OtherSub({ r, data, onPick }) {
  const [open, setOpen] = useState(false);
  if (!open) return <Button variant="text" onClick={() => setOpen(true)}><Plus size={14} /> Altro sostituto…</Button>;
  return <ProductPicker products={data.products} area="cibo" prefer={r.p.category_id} autoFocus placeholder="Cerca sostituto…" onPick={(p) => { if (p.id !== r.p.id) onPick(p); setOpen(false); }} />;
}
