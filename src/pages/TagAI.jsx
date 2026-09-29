import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Sparkles, Loader2, CheckCheck, Tags, ChevronDown } from 'lucide-react';
import { useData, useRecipes, showToast } from '../hooks/useData.js';
import { Button, IconButton, Tabs, Empty, Select } from '../components/ui/kit.jsx';
import { apiFetch } from '../api/client.js';
import { getMeta, setMeta } from '../db/db.js';
import { save, undo } from '../db/repo.js';
import { joinList, parseList } from '../db/recipes.js';
import { courseOf, totalMin, COURSES, DIFF_LABEL, BASES, foodLabel, FEATURE_GROUPS, FEATURE_LABEL, FEATURE_IDS } from '../db/tags.js';

// Classificazione ricette con AI: portata, difficolta', alimento principale (+ secondario), caratteristiche, dieta.
// L'AI propone solo dove manca; tutto modificabile; si salva solo cio' che confermi.
const AI_META = 'cls_ai'; // { recipe_id: { course, difficulty, main, second, features: [], diet: [] } }

export function FoodSelect({ value, onChange, placeholder = '—', ...props }) {
  return (
    <Select value={value || ''} onChange={(e) => onChange(e.target.value || null)} {...props}>
      <option value="">{placeholder}</option>
      {BASES.map((b) => (
        <optgroup key={b.id} label={b.id}>
          <option value={b.id}>{b.id}</option>
          {b.subs.map((s) => (
            <option key={s} value={`${b.id}|${s}`}>{`${b.id} · ${s}`}</option>
          ))}
        </optgroup>
      ))}
    </Select>
  );
}

// Chip delle caratteristiche raggruppate (scelta multipla).
export function FeaturePicker({ value, onChange }) {
  const set = new Set(value);
  const toggle = (id) => {
    const n = new Set(set);
    n.has(id) ? n.delete(id) : n.add(id);
    onChange(FEATURE_IDS.filter((x) => n.has(x)));
  };
  return (
    <div className="space-y-2">
      {FEATURE_GROUPS.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wider text-text-muted w-full">{g.label}</span>
          {g.items.map(([id, label]) => (
            <button key={id} type="button" onClick={() => toggle(id)} className={`rounded-full border px-2.5 py-0.5 text-xs ${set.has(id) ? 'bg-brand text-brand-on border-brand' : 'border-bg-border text-text-secondary'}`}>
              {label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function TagAI() {
  const data = useData();
  const rec = useRecipes();
  const nav = useNavigate();
  const [ai, setAi] = useState(null);
  const [edit, setEdit] = useState({}); // { rid: { campo: valore } }
  const [open, setOpen] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [tab, setTab] = useState('todo');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getMeta(AI_META, {}).then((v) => setAi(v || {}));
  }, []);

  // valore mostrato per campo: modifica > attuale (se c'e') > proposta AI
  const rows = useMemo(() => {
    if (!rec || !ai) return [];
    return rec.list.map((r) => {
      const p = ai[r.id];
      const cur = {
        course: r.course || courseOf(r)?.value || null,
        difficulty: r.difficulty || null,
        main_food: r.main_food || null,
        second_food: r.second_food || null,
        features: parseList(r.features),
        diet_tags: parseList(r.diet_tags),
      };
      const prop = p
        ? {
            course: cur.course || p.course,
            difficulty: cur.difficulty || p.difficulty,
            main_food: cur.main_food || p.main,
            second_food: cur.main_food ? cur.second_food : p.second,
            features: cur.features.length ? cur.features : p.features || [],
            diet_tags: [...new Set([...cur.diet_tags, ...(p.diet || [])])],
          }
        : cur;
      const val = { ...prop, ...(edit[r.id] || {}) };
      const done = !!r.main_food && cur.features.length > 0;
      return { r, p, cur, val, done };
    });
  }, [rec, ai, edit]);

  if (!data || !rec || !ai) return null;
  const todo = rows.filter((x) => !x.done);
  const toAsk = todo.filter((x) => !x.p);
  const shown = tab === 'todo' ? todo : rows;
  const proposedCount = todo.filter((x) => x.p).length;

  const setField = (rid, k, v) => {
    setEdit((e) => ({ ...e, [rid]: { ...e[rid], [k]: v } }));
    setSel((s) => new Set(s).add(rid));
  };
  function toggle(rid) {
    const n = new Set(sel);
    n.has(rid) ? n.delete(rid) : n.add(rid);
    setSel(n);
  }

  async function askAi() {
    setErr(null);
    const next = { ...ai };
    try {
      for (let i = 0; i < toAsk.length; i += 12) {
        setBusy({ done: i, total: toAsk.length });
        const part = toAsk.slice(i, i + 12);
        const items = part.map(({ r, cur }) => ({
          title: r.title,
          course: cur.course || '',
          minutes: totalMin(r) || null,
          rest: Number(r.rest_min) || 0,
          steps: (rec.steps[r.id] || []).length,
          ingredients: (rec.ings[r.id] || []).filter((x) => !x.optional).map((x) => data.products[x.product_id]?.name || x.text).slice(0, 18),
        }));
        const res = await apiFetch('/api/ai/classify', { method: 'POST', body: JSON.stringify({ items }) });
        res.items.forEach((x, n) => part[n] && (next[part[n].r.id] = x));
        await setMeta(AI_META, next);
        setAi({ ...next });
        setSel((s) => new Set([...s, ...part.map((x) => x.r.id)]));
      }
      showToast('Classificazione proposta: controlla e conferma');
    } catch (e) {
      setErr(`AI non disponibile: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    const ops = [];
    for (const x of rows) {
      if (!sel.has(x.r.id)) continue;
      const v = x.val;
      const row = { id: x.r.id };
      if ((v.course || null) !== (x.r.course || null)) row.course = v.course || null;
      if ((v.difficulty || null) !== (x.r.difficulty || null)) row.difficulty = v.difficulty || null;
      if ((v.main_food || null) !== (x.r.main_food || null)) row.main_food = v.main_food || null;
      if ((v.second_food || null) !== (x.r.second_food || null)) row.second_food = v.second_food && v.second_food !== v.main_food ? v.second_food : null;
      const feats = joinList(v.features) || null;
      if (feats !== (x.r.features || null)) row.features = feats;
      const diet = joinList(v.diet_tags) || null;
      if (diet !== (x.r.diet_tags || null)) row.diet_tags = diet;
      if (Object.keys(row).length > 1) ops.push({ table: 'recipes', row });
    }
    if (ops.length) await save(ops, `Classificate ${ops.length} ricette`);
    setSel(new Set());
    setEdit({});
    showToast(`Salvate ${ops.length} ricette`, ops.length ? { label: 'Annulla', run: () => undo() } : undefined);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconButton label="Indietro" onClick={() => nav('/ricette')}>
          <ArrowLeft size={18} />
        </IconButton>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Classifica ricette</h1>
          <p className="text-text-secondary text-sm">{todo.length} da classificare · {proposedCount} con proposta AI</p>
        </div>
      </div>

      <div className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <p className="text-sm text-text-secondary">
          Portata, difficoltà, alimento principale (+ secondario), caratteristiche e dieta. Il tempo e le etichette leggero, economico e richiede riposo si calcolano da soli (su 1 porzione). Tocca ▾ per correggere.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={askAi} disabled={!!busy || !toAsk.length}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy ? `AI… ${busy.done}/${busy.total}` : `Proponi con AI (${toAsk.length})`}
          </Button>
          <Button onClick={confirm} disabled={!sel.size}>
            <CheckCheck size={16} /> Conferma selezionate ({sel.size})
          </Button>
        </div>
        {err && <p className="text-sm text-negative">{err}</p>}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'todo', label: 'Da classificare', count: todo.length }, { value: 'all', label: 'Tutte', count: rows.length }]} />
        <div className="flex gap-3 text-sm">
          <button type="button" className="text-brand font-semibold" onClick={() => setSel(new Set(todo.filter((x) => x.p).map((x) => x.r.id)))}>Seleziona proposte</button>
          <button type="button" className="text-text-muted" onClick={() => setSel(new Set())}>Nessuna</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty icon={Tags}>Tutte le ricette sono classificate.</Empty>
      ) : (
        <ul className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
          {shown.map((x) => {
            const v = x.val;
            const summary = [v.course, foodLabel(v.main_food), v.second_food ? `+ ${foodLabel(v.second_food)}` : null, v.difficulty ? DIFF_LABEL[v.difficulty] : null].filter(Boolean).join(' · ');
            return (
              <li key={x.r.id} className="px-3 py-3 space-y-2" data-testid="cls-row">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-brand shrink-0" checked={sel.has(x.r.id)} onChange={() => toggle(x.r.id)} aria-label={`Seleziona ${x.r.title}`} />
                  <span className="font-semibold flex-1 min-w-0 truncate">{x.r.title}</span>
                  <IconButton label="Modifica classificazione" className="w-8 h-8" onClick={() => setOpen(open === x.r.id ? null : x.r.id)}>
                    <ChevronDown size={16} className={open === x.r.id ? 'rotate-180' : ''} />
                  </IconButton>
                </div>
                <div className={`text-sm ${x.p && !x.done ? 'text-brand' : 'text-text-secondary'}`}>{summary || 'non classificata'}</div>
                {v.features.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {v.features.map((f) => (
                      <span key={f} className="rounded-full border border-bg-border px-2 py-0.5 text-xs text-text-secondary">{FEATURE_LABEL[f]}</span>
                    ))}
                    {v.diet_tags.map((d) => (
                      <span key={d} className="rounded-full border border-brand/50 text-brand px-2 py-0.5 text-xs">{d}</span>
                    ))}
                  </div>
                )}
                {open === x.r.id && (
                  <div className="space-y-3 rounded-md bg-bg-base/50 p-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Select value={v.course || ''} onChange={(e) => setField(x.r.id, 'course', e.target.value || null)} aria-label="Portata">
                        <option value="">Portata —</option>
                        {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
                      </Select>
                      <Select value={v.difficulty || ''} onChange={(e) => setField(x.r.id, 'difficulty', e.target.value || null)} aria-label="Difficoltà">
                        <option value="">Difficoltà —</option>
                        {Object.entries(DIFF_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </Select>
                      <FoodSelect value={v.main_food} onChange={(val) => setField(x.r.id, 'main_food', val)} placeholder="Principale —" aria-label="Alimento principale" />
                      <FoodSelect value={v.second_food} onChange={(val) => setField(x.r.id, 'second_food', val)} placeholder="Secondario —" aria-label="Alimento secondario" />
                    </div>
                    <FeaturePicker value={v.features} onChange={(val) => setField(x.r.id, 'features', val)} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
