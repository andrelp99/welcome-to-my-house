import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Sparkles, Loader2, CheckCheck, Timer } from 'lucide-react';
import { useData, showToast } from '../hooks/useData.js';
import { Button, IconButton, Tabs, Empty } from '../components/ui/kit.jsx';
import { apiFetch } from '../api/client.js';
import { getMeta, setMeta } from '../db/db.js';
import { save, undo } from '../db/repo.js';
import { allowedLocation, usesShown, usesFromShown, byUse } from '../db/logic.js';

// Durate di conservazione per tanti prodotti insieme: l'AI propone, Andrea corregge e conferma.
const AI_META = 'dur_ai'; // { product_id: { pantry_days, fridge_days, freezer_months, open_days, uses_per_pack } }
const FIELDS = [
  { k: 'pantry_days', ai: 'pantry_days', label: 'Disp. gg' },
  { k: 'fridge_days', ai: 'fridge_days', label: 'Frigo gg' },
  { k: 'freezer_max_months', ai: 'freezer_months', label: 'Freez. mesi' },
  { k: 'open_shelf_days', ai: 'open_days', label: 'Aperto gg' },
];
const has = (v) => v != null && v !== '';
// Almeno uno tra dispensa, frigo, freezer e' obbligatorio; vuoto = li' non si conserva; 0 = da consumare subito.
const noDur = (p) => !has(p.pantry_days) && !has(p.fridge_days) && !has(p.freezer_max_months);
const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
};
const STORE_KEYS = ['pantry_days', 'fridge_days', 'freezer_max_months'];

export default function Durate() {
  const data = useData();
  const nav = useNavigate();
  const [ai, setAi] = useState(null);
  const [edit, setEdit] = useState({}); // { pid: { campo: valore } } modifiche a mano / proposte accettate
  const [sel, setSel] = useState(new Set());
  const [tab, setTab] = useState('todo');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getMeta(AI_META, {}).then((v) => setAi(v || {}));
  }, []);

  const [cats, setCats] = useState(null); // { id: by_use } modifiche in attesa di salvataggio
  const [catBusy, setCatBusy] = useState(false);
  const products = useMemo(
    () => (data ? Object.values(data.products).filter((p) => p.area === 'cibo' && p.category_id !== 'cat-avanzi' && !p.always_have).sort((a, b) => a.name.localeCompare(b.name, 'it')) : []),
    [data]
  );
  if (!data || !ai) return null;

  // valore mostrato: modifica > proposta AI (se il campo e' vuoto) > attuale
  const value = (p, f) => {
    const e = edit[p.id];
    if (e && f.k in e) return e[f.k];
    if (noDur(p) && ai[p.id] && has(ai[p.id][f.ai])) return ai[p.id][f.ai];
    return p[f.k] ?? '';
  };
  const catByUse = (id) => (cats && id in cats ? cats[id] : !!data.categories[id]?.by_use);
  const needsUses = (p) => catByUse(p.category_id) && !has(p.uses_per_pack);
  const empty = (p) => noDur(p) || needsUses(p);
  // usi mostrati per 100 g/ml o per unita' (vedi logic.js)
  const usesVal = (p) => (edit[p.id] && 'uses_per_pack' in edit[p.id] ? edit[p.id].uses_per_pack : !has(p.uses_per_pack) && (noDur(p) || needsUses(p)) && has(ai[p.id]?.uses_per_pack) ? ai[p.id].uses_per_pack : usesShown(p) ?? '');
  const usesLabel = (p) => `Usi/${p.default_unit === 'g' || p.default_unit === 'ml' ? `100${p.default_unit}` : p.default_unit}`;
  const foodCats = data.categoryList.filter((c) => c.area === 'cibo' && c.id !== 'cat-avanzi');
  const catsDirty = cats && Object.entries(cats).some(([id, v]) => v !== !!data.categories[id]?.by_use);

  async function askCats() {
    setCatBusy(true);
    setErr(null);
    try {
      const items = foodCats.map((c) => ({ id: c.id, name: c.name, examples: products.filter((p) => p.category_id === c.id).slice(0, 8).map((p) => p.name) }));
      const res = await apiFetch('/api/ai/categories', { method: 'POST', body: JSON.stringify({ items }) });
      setCats(Object.fromEntries(res.items.map((x) => [x.id, x.by_use])));
    } catch (e) {
      setErr(`AI non disponibile: ${e.message}`);
    } finally {
      setCatBusy(false);
    }
  }
  async function saveCats() {
    const ops = Object.entries(cats)
      .filter(([id, v]) => v !== !!data.categories[id]?.by_use)
      .map(([id, v]) => ({ table: 'categories', row: { id, by_use: v ? 1 : 0 } }));
    if (ops.length) await save(ops, `Categorie a utilizzo (${ops.length})`);
    setCats(null);
    showToast('Categorie salvate', { label: 'Annulla', run: () => undo() });
  }
  const proposed = (p, f) => noDur(p) && has(ai[p.id]?.[f.ai]) && !(edit[p.id] && f.k in edit[p.id]);
  // riga valida: almeno uno tra dispensa / frigo / freezer (+ usi se categoria a utilizzo)
  const rowMissing = (p) => {
    const st = STORE_KEYS.some((k) => num(value(p, FIELDS.find((f) => f.k === k))) != null);
    const uses = !catByUse(p.category_id) || has(usesVal(p));
    return !st ? 'Serve almeno uno tra dispensa, frigo e freezer' : !uses ? 'Servono gli usi (categoria a utilizzo)' : null;
  };

  const todo = products.filter(empty);
  const list = tab === 'todo' ? todo : products;
  const withProposal = products.filter((p) => ai[p.id] && empty(p));
  const toAskAll = products.filter((p) => empty(p) && !(ai[p.id] && (!needsUses(p) || has(ai[p.id].uses_per_pack))));

  function setField(p, k, v) {
    setEdit((e) => ({ ...e, [p.id]: { ...e[p.id], [k]: v } }));
    setSel((s) => new Set(s).add(p.id));
  }
  function toggle(id) {
    const n = new Set(sel);
    n.has(id) ? n.delete(id) : n.add(id);
    setSel(n);
  }

  async function askAi() {
    setErr(null);
    const next = { ...ai };
    try {
      const toAsk = toAskAll;
      for (let i = 0; i < toAsk.length; i += 30) {
        setBusy({ done: i, total: toAsk.length });
        const part = toAsk.slice(i, i + 30);
        const res = await apiFetch('/api/ai/durations', {
          method: 'POST',
          body: JSON.stringify({ items: part.map((p) => ({ name: p.name, category: data.categories[p.category_id]?.name, unit: p.default_unit })) }),
        });
        res.items.forEach((r, n) => part[n] && (next[part[n].id] = r));
        await setMeta(AI_META, next);
        setAi({ ...next });
      }
      setSel((s) => new Set([...s, ...toAsk.map((p) => p.id)]));
      showToast('Durate proposte: controlla e conferma');
    } catch (e) {
      setErr(`AI non disponibile: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  const selBad = products.filter((p) => sel.has(p.id) && rowMissing(p));
  async function confirm() {
    const ops = [];
    for (const p of products) {
      if (!sel.has(p.id) || rowMissing(p)) continue;
      const row = { id: p.id };
      for (const f of FIELDS) row[f.k] = num(value(p, f));
      row.uses_per_pack = usesFromShown(usesVal(p), p.default_unit);
      if (!allowedLocation({ ...p, ...row }, p.default_location_id)) row.default_location_id = ['loc-dispensa', 'loc-frigo', 'loc-freezer'].find((l) => allowedLocation({ ...p, ...row }, l)) || 'loc-altro';
      ops.push({ table: 'products', row });
    }
    if (!ops.length) return showToast(selBad.length ? 'Completa le righe in rosso' : 'Niente da salvare');
    await save(ops, `Durate di ${ops.length} prodotti`);
    const saved = new Set(ops.map((o) => o.row.id));
    // restano selezionate (e modificate) solo le righe incomplete
    setSel(new Set([...sel].filter((id) => !saved.has(id))));
    setEdit((e) => Object.fromEntries(Object.entries(e).filter(([id]) => !saved.has(id))));
    showToast(`Salvate le durate di ${ops.length} prodotti${selBad.length ? ` · ${selBad.length} da completare` : ''}`, { label: 'Annulla', run: () => undo() });
  }

  const inputCls = (hl) => `w-full rounded-md bg-bg-elevated border px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:border-brand ${hl ? 'border-brand/60 text-brand' : 'border-bg-border'}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconButton label="Indietro" onClick={() => nav('/catalogo')}>
          <ArrowLeft size={18} />
        </IconButton>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Durate e porzioni</h1>
          <p className="text-text-secondary text-sm">{todo.length} prodotti da completare (durate, o usi per le categorie a utilizzo).</p>
        </div>
      </div>

      <div className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">Categorie a utilizzo</h2>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={askCats} disabled={catBusy}>
              {catBusy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} AI
            </Button>
            {catsDirty && <Button onClick={saveCats}>Salva</Button>}
          </div>
        </div>
        <p className="text-sm text-text-secondary">Si consumano a usi (spezie, salse…): i loro prodotti devono avere gli usi; “q.b.” nelle ricette = 1 uso.</p>
        <div className="flex flex-wrap gap-2">
          {foodCats.map((c) => {
            const on = catByUse(c.id);
            const changed = cats && c.id in cats && cats[c.id] !== !!c.by_use;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setCats((x) => ({ ...(x || {}), [c.id]: !on }))}
                className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'} ${changed ? 'ring-2 ring-warning' : ''}`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <p className="text-sm text-text-secondary">
          Giorni da quando entra in casa (confezione chiusa), mesi in freezer, giorni da aperto. <b>Vuoto</b> = lì non si conserva · <b>0</b> = da consumare subito. Almeno uno tra dispensa, frigo e freezer; “aperto” è facoltativo. Le proposte AI sono in <span className="text-brand">giallo</span>: correggi e conferma.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={askAi} disabled={!!busy || !toAskAll.length}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? `AI… ${busy.done}/${busy.total}` : `Proponi con AI (${toAskAll.length})`}
          </Button>
          <Button onClick={confirm} disabled={!sel.size || selBad.length === sel.size}>
            <CheckCheck size={16} /> Conferma selezionati ({sel.size - selBad.length})
          </Button>
        </div>
        {err && <p className="text-sm text-negative">{err}</p>}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'todo', label: 'Da completare', count: todo.length }, { value: 'all', label: 'Tutti', count: products.length }]} />
        {withProposal.length > 0 && (
          <div className="flex gap-3 text-sm">
            <button type="button" className="text-brand font-semibold" onClick={() => setSel(new Set([...sel, ...withProposal.map((p) => p.id)]))}>Seleziona proposte</button>
            <button type="button" className="text-text-muted" onClick={() => setSel(new Set())}>Nessuno</button>
          </div>
        )}
      </div>

      {list.length === 0 ? (
        <Empty icon={Timer}>Tutti i prodotti hanno le durate.</Empty>
      ) : (
        <ul className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
          {list.map((p) => (
            <li key={p.id} className="px-3 py-3 space-y-2" data-testid="dur-row">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="font-semibold flex-1 truncate">{p.name}</span>
                <span className="text-xs text-text-muted shrink-0">{data.categories[p.category_id]?.name} · {p.default_unit}</span>
              </label>
              <div className="grid gap-2 grid-cols-5">
                {FIELDS.map((f) => (
                  <label key={f.k} className="text-[11px] text-text-muted space-y-0.5">
                    <span className="block truncate">{f.label}</span>
                    <input inputMode="numeric" className={inputCls(proposed(p, f))} value={value(p, f)} placeholder="—" onChange={(e) => setField(p, f.k, e.target.value)} />
                  </label>
                ))}
                <label className={`text-[11px] space-y-0.5 ${needsUses(p) && !has(usesVal(p)) ? 'text-negative' : 'text-text-muted'}`}>
                  <span className="block truncate">{usesLabel(p)}</span>
                  <input inputMode="decimal" className={`${inputCls(!has(p.uses_per_pack) && has(ai[p.id]?.uses_per_pack) && !(edit[p.id] && 'uses_per_pack' in edit[p.id]))} ${needsUses(p) && !has(usesVal(p)) ? '!border-negative' : ''}`} value={usesVal(p)} placeholder="—" onChange={(e) => setField(p, 'uses_per_pack', e.target.value)} />
                </label>
              </div>
              {sel.has(p.id) && rowMissing(p) && <p className="text-xs text-negative">{rowMissing(p)}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
