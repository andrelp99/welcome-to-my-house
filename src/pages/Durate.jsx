import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Sparkles, Loader2, CheckCheck, Timer } from 'lucide-react';
import { useData, showToast } from '../hooks/useData.js';
import { Button, IconButton, Tabs, Empty } from '../components/ui/kit.jsx';
import { apiFetch } from '../api/client.js';
import { getMeta, setMeta } from '../db/db.js';
import { save, undo } from '../db/repo.js';
import { allowedLocation } from '../db/logic.js';

// Durate di conservazione per tanti prodotti insieme: l'AI propone, Andrea corregge e conferma.
const AI_META = 'dur_ai'; // { product_id: { pantry_days, fridge_days, freezer_months, open_days, uses_per_pack } }
const FIELDS = [
  { k: 'pantry_days', ai: 'pantry_days', label: 'Disp. gg' },
  { k: 'fridge_days', ai: 'fridge_days', label: 'Frigo gg' },
  { k: 'freezer_max_months', ai: 'freezer_months', label: 'Freez. mesi' },
  { k: 'open_shelf_days', ai: 'open_days', label: 'Aperto gg' },
];
const has = (v) => v != null && v !== '';
const empty = (p) => !has(p.pantry_days) && !has(p.fridge_days);
const num = (v) => (v === '' || v == null ? null : Math.max(0, Math.round(Number(String(v).replace(',', '.')))) || null);

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

  const products = useMemo(
    () => (data ? Object.values(data.products).filter((p) => p.area === 'cibo' && p.category_id !== 'cat-avanzi').sort((a, b) => a.name.localeCompare(b.name, 'it')) : []),
    [data]
  );
  if (!data || !ai) return null;

  // valore mostrato: modifica > proposta AI (se il campo e' vuoto) > attuale
  const value = (p, f) => {
    const e = edit[p.id];
    if (e && f.k in e) return e[f.k];
    if (!has(p[f.k]) && ai[p.id] && has(ai[p.id][f.ai])) return ai[p.id][f.ai];
    return p[f.k] ?? '';
  };
  const usesVal = (p) => (edit[p.id] && 'uses_per_pack' in edit[p.id] ? edit[p.id].uses_per_pack : !has(p.uses_per_pack) && has(ai[p.id]?.uses_per_pack) ? ai[p.id].uses_per_pack : p.uses_per_pack ?? '');
  const proposed = (p, f) => !has(p[f.k]) && has(ai[p.id]?.[f.ai]) && !(edit[p.id] && f.k in edit[p.id]);

  const todo = products.filter(empty);
  const list = tab === 'todo' ? todo : products;
  const toAsk = todo.filter((p) => !ai[p.id]);
  const withProposal = products.filter((p) => ai[p.id] && empty(p));

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

  async function confirm() {
    const ops = [];
    for (const p of products) {
      if (!sel.has(p.id)) continue;
      const row = { id: p.id };
      for (const f of FIELDS) row[f.k] = num(value(p, f));
      if (p.default_unit === 'conf') row.uses_per_pack = num(usesVal(p));
      if (!allowedLocation({ ...p, ...row }, p.default_location_id)) row.default_location_id = ['loc-dispensa', 'loc-frigo', 'loc-freezer'].find((l) => allowedLocation({ ...p, ...row }, l)) || 'loc-altro';
      ops.push({ table: 'products', row });
    }
    if (!ops.length) return;
    await save(ops, `Durate di ${ops.length} prodotti`);
    setSel(new Set());
    setEdit({});
    showToast(`Salvate le durate di ${ops.length} prodotti`, { label: 'Annulla', run: () => undo() });
  }

  const inputCls = (hl) => `w-full rounded-md bg-bg-elevated border px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:border-brand ${hl ? 'border-brand/60 text-brand' : 'border-bg-border'}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconButton label="Indietro" onClick={() => nav('/catalogo')}>
          <ArrowLeft size={18} />
        </IconButton>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Durate prodotti</h1>
          <p className="text-text-secondary text-sm">{todo.length} prodotti cibo senza durate (dispensa o frigo).</p>
        </div>
      </div>

      <div className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <p className="text-sm text-text-secondary">
          Giorni da quando entra in casa (confezione chiusa), mesi in freezer, giorni da aperto. Vuoto = lì non ci va. Le proposte AI sono in <span className="text-brand">giallo</span>: correggi e conferma.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={askAi} disabled={!!busy || !toAsk.length}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? `AI… ${busy.done}/${busy.total}` : `Proponi con AI (${toAsk.length})`}
          </Button>
          <Button onClick={confirm} disabled={!sel.size}>
            <CheckCheck size={16} /> Conferma selezionati ({sel.size})
          </Button>
        </div>
        {err && <p className="text-sm text-negative">{err}</p>}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'todo', label: 'Senza durate', count: todo.length }, { value: 'all', label: 'Tutti', count: products.length }]} />
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
              <div className={`grid gap-2 ${p.default_unit === 'conf' ? 'grid-cols-5' : 'grid-cols-4'}`}>
                {FIELDS.map((f) => (
                  <label key={f.k} className="text-[11px] text-text-muted space-y-0.5">
                    <span className="block truncate">{f.label}</span>
                    <input inputMode="numeric" className={inputCls(proposed(p, f))} value={value(p, f)} placeholder="—" onChange={(e) => setField(p, f.k, e.target.value)} />
                  </label>
                ))}
                {p.default_unit === 'conf' && (
                  <label className="text-[11px] text-text-muted space-y-0.5">
                    <span className="block truncate">Usi/conf</span>
                    <input inputMode="decimal" className={inputCls(!has(p.uses_per_pack) && has(ai[p.id]?.uses_per_pack) && !(edit[p.id] && 'uses_per_pack' in edit[p.id]))} value={usesVal(p)} placeholder="—" onChange={(e) => setField(p, 'uses_per_pack', e.target.value)} />
                  </label>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
