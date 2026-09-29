import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Sparkles, Check, Pencil, PlusCircle, Loader2, CheckCheck, Link2 } from 'lucide-react';
import { useData, useRecipes, showToast } from '../hooks/useData.js';
import { Button, IconButton, Tabs, Empty } from '../components/ui/kit.jsx';
import { LinkModal } from '../components/recipes.jsx';
import { ProductForm } from '../components/forms.jsx';
import { unlinkedGroups, aiProposals, applyLinks } from '../db/linker.js';
import { getMeta, setMeta } from '../db/db.js';
import { undo } from '../db/repo.js';

const AI_META = 'link_ai'; // proposte AI salvate sul dispositivo: { key: {kind, product_id?, draft?} }

const SOURCE = {
  memoria: { label: 'già usato', cls: 'border-positive/50 text-positive' },
  regole: { label: 'regole', cls: 'border-positive/50 text-positive' },
  simile: { label: 'simile?', cls: 'border-warning/50 text-warning' },
  AI: { label: 'AI', cls: 'border-brand/60 text-brand' },
};

function PropLine({ prop, data }) {
  if (!prop) return <span className="text-text-muted">nessuna proposta</span>;
  const src = SOURCE[prop.source] || SOURCE.AI;
  const badge = <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${src.cls}`}>{src.label}</span>;
  if (prop.kind === 'skip')
    return (
      <span className="flex items-center gap-2 min-w-0">
        {badge} <span className="text-text-secondary">non serve in dispensa</span>
      </span>
    );
  if (prop.kind === 'new')
    return (
      <span className="flex items-center gap-2 min-w-0">
        {badge}
        <span className="truncate">
          <PlusCircle size={13} className="inline -mt-0.5 text-brand" /> nuovo <b>{prop.draft.name}</b>
          <span className="text-text-muted"> · {data.categories[prop.draft.category_id]?.name || '—'} · {prop.draft.default_unit}</span>
        </span>
      </span>
    );
  return (
    <span className="flex items-center gap-2 min-w-0">
      {badge} <span className="truncate">→ <b>{prop.product.name}</b></span>
    </span>
  );
}

export default function Collega() {
  const data = useData();
  const rec = useRecipes();
  const nav = useNavigate();
  const [aiRaw, setAiRaw] = useState(null);
  const [tab, setTab] = useState('prop');
  const [sel, setSel] = useState(null); // Set di chiavi selezionate (null = default: proposte sicure)
  const [busy, setBusy] = useState(null); // { done, total } durante l'AI
  const [err, setErr] = useState(null);
  const [linking, setLinking] = useState(null); // gruppo
  const [creating, setCreating] = useState(null); // { group, name?, draft? }

  useEffect(() => {
    getMeta(AI_META, {}).then((v) => setAiRaw(v || {}));
  }, []);

  // proposte AI salvate -> oggetti con prodotti vivi
  const ai = useMemo(() => {
    if (!data || !aiRaw) return {};
    const out = {};
    for (const [k, v] of Object.entries(aiRaw)) {
      if (v.kind === 'link') {
        const p = data.products[v.product_id];
        if (p) out[k] = { kind: 'link', product: p, source: 'AI', sure: false };
      } else if (v.kind === 'new') out[k] = { kind: 'new', draft: v.draft, source: 'AI', sure: false };
      else if (v.kind === 'skip') out[k] = { kind: 'skip', source: 'AI' };
    }
    return out;
  }, [data, aiRaw]);

  const groups = useMemo(() => (data && rec && aiRaw ? unlinkedGroups(rec, data, ai) : null), [data, rec, ai, aiRaw]);

  if (!groups) return null;
  const selected = sel ?? new Set(groups.filter((g) => g.prop?.sure).map((g) => g.key));
  const withProp = groups.filter((g) => g.prop);
  const noProp = groups.filter((g) => !g.prop);
  const toAsk = groups.filter((g) => !g.prop?.sure && !ai[g.key]);
  const totalIngs = groups.reduce((s, g) => s + g.count, 0);
  const shown = tab === 'prop' ? withProp : tab === 'none' ? noProp : groups;
  const selGroups = groups.filter((g) => selected.has(g.key) && g.prop);
  const selIngs = selGroups.reduce((s, g) => s + g.count, 0);

  function toggle(key) {
    const n = new Set(selected);
    n.has(key) ? n.delete(key) : n.add(key);
    setSel(n);
  }

  async function apply(choices, label) {
    const res = await applyLinks(choices, label);
    setSel((s) => {
      if (!s) return s;
      const n = new Set(s);
      choices.forEach((c) => n.delete(c.group.key));
      return n;
    });
    showToast(`${res.ingredients} ingredienti collegati${res.products ? ` · ${res.products} prodotti nuovi` : ''}`, { label: 'Annulla', run: () => undo() });
  }

  async function askAi() {
    setErr(null);
    setBusy({ done: 0, total: toAsk.length });
    try {
      const res = await aiProposals(toAsk, data, { onProgress: (done, total) => setBusy({ done, total }) });
      const raw = { ...aiRaw };
      for (const [k, v] of Object.entries(res)) raw[k] = v.kind === 'link' ? { kind: 'link', product_id: v.product.id } : v.kind === 'new' ? { kind: 'new', draft: v.draft } : { kind: 'skip' };
      await setMeta(AI_META, raw);
      setAiRaw(raw);
      setTab('prop');
      showToast(`AI: ${Object.keys(res).length} proposte da rivedere`);
    } catch (e) {
      setErr(`AI non disponibile: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconButton label="Indietro" onClick={() => nav('/ricette')}>
          <ArrowLeft size={18} />
        </IconButton>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Collega ingredienti</h1>
          <p className="text-text-secondary text-sm">
            {groups.length ? `${totalIngs} ingredienti (${groups.length} diversi) senza prodotto della dispensa.` : 'Tutto collegato.'}
          </p>
        </div>
      </div>

      {groups.length === 0 ? (
        <Empty icon={Link2}>Tutti gli ingredienti delle ricette sono collegati alla dispensa.</Empty>
      ) : (
        <>
          <div className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
            <p className="text-sm text-text-secondary">
              Proposte da memoria e regole già pronte. Per il resto chiedi all'AI: collega a un prodotto esistente o propone un prodotto nuovo. Niente si salva finché non confermi.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={askAi} disabled={!!busy || toAsk.length === 0}>
                {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                {busy ? `AI… ${busy.done}/${busy.total}` : `Proponi con AI (${toAsk.length})`}
              </Button>
              <Button onClick={() => apply(selGroups.map((g) => ({ group: g, prop: g.prop })), `Collegati ${selIngs} ingredienti`)} disabled={!selGroups.length}>
                <CheckCheck size={16} /> Conferma selezionati ({selGroups.length})
              </Button>
            </div>
            {err && <p className="text-sm text-negative">{err}</p>}
          </div>

          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Tabs
              value={tab}
              onChange={setTab}
              tabs={[
                { value: 'prop', label: 'Con proposta', count: withProp.length },
                { value: 'none', label: 'Senza proposta', count: noProp.length },
                { value: 'all', label: 'Tutti', count: groups.length },
              ]}
            />
            {tab !== 'none' && withProp.length > 0 && (
              <div className="flex gap-3 text-sm">
                <button type="button" className="text-brand font-semibold" onClick={() => setSel(new Set(withProp.map((g) => g.key)))}>Seleziona tutte</button>
                <button type="button" className="text-text-muted" onClick={() => setSel(new Set())}>Nessuna</button>
              </div>
            )}
          </div>

          {shown.length === 0 ? (
            <Empty icon={Sparkles}>{tab === 'prop' ? 'Nessuna proposta: usa “Proponi con AI”.' : 'Niente qui.'}</Empty>
          ) : (
            <ul className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
              {shown.map((g) => {
                const titles = [...g.recipes.entries()];
                return (
                  <li key={g.key} className="flex items-start gap-3 px-3 py-3" data-testid="link-row">
                    <input
                      type="checkbox"
                      className="mt-1.5 h-4 w-4 accent-brand shrink-0"
                      checked={selected.has(g.key) && !!g.prop}
                      disabled={!g.prop}
                      onChange={() => toggle(g.key)}
                      aria-label={`Seleziona ${g.text}`}
                    />
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="font-semibold">
                        {g.text}
                        {g.count > 1 && <span className="text-text-muted font-normal"> ×{g.count}</span>}
                      </div>
                      <div className="text-xs text-text-muted truncate">
                        {titles.slice(0, 2).map(([id, t], n) => (
                          <span key={id}>
                            {n ? ', ' : ''}
                            <Link to={`/ricette/${id}`} className="hover:text-brand">{t}</Link>
                          </span>
                        ))}
                        {titles.length > 2 ? ` +${titles.length - 2}` : ''}
                      </div>
                      <div className="text-sm">
                        {g.prop?.kind === 'new' ? (
                          <button type="button" className="text-left max-w-full" title="Rivedi prima di creare" onClick={() => setCreating({ group: g, draft: g.prop.draft })}>
                            <PropLine prop={g.prop} data={data} />
                          </button>
                        ) : (
                          <PropLine prop={g.prop} data={data} />
                        )}
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {g.prop && (
                        <IconButton label="Conferma" className="text-positive" onClick={() => apply([{ group: g, prop: g.prop }], `${g.text} collegato`)}>
                          <Check size={18} />
                        </IconButton>
                      )}
                      <IconButton label="Scegli" onClick={() => setLinking(g)}>
                        <Pencil size={16} />
                      </IconButton>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {linking && (
        <LinkModal
          ing={{ text: linking.text }}
          data={data}
          onClose={() => setLinking(null)}
          onPick={(p) => {
            apply([{ group: linking, prop: { kind: 'link', product: p } }], `${linking.text} → ${p.name}`);
            setLinking(null);
          }}
          onSkip={() => {
            apply([{ group: linking, prop: { kind: 'skip' } }], `${linking.text}: non serve`);
            setLinking(null);
          }}
          onCreate={(name) => {
            setCreating({ group: linking, name, draft: linking.prop?.kind === 'new' ? { ...linking.prop.draft, name } : null });
            setLinking(null);
          }}
        />
      )}
      {creating && (
        <ProductForm
          data={data}
          initialName={creating.name || creating.draft?.name || ''}
          draft={creating.draft}
          area="cibo"
          onClose={() => setCreating(null)}
          onSaved={(p) => apply([{ group: creating.group, prop: { kind: 'link', product: p } }], `${creating.group.text} → ${p.name}`)}
        />
      )}
    </div>
  );
}
