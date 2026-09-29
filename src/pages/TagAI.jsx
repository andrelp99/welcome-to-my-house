import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Sparkles, Loader2, CheckCheck, Tags } from 'lucide-react';
import { useData, useRecipes, showToast } from '../hooks/useData.js';
import { Button, IconButton, Tabs, Empty } from '../components/ui/kit.jsx';
import { apiFetch } from '../api/client.js';
import { getMeta, setMeta } from '../db/db.js';
import { save, undo } from '../db/repo.js';
import { joinList } from '../db/recipes.js';
import { cleanTags, courseOf, totalMin } from '../db/tags.js';

// Tag delle ricette proposti dall'AI (ingrediente principale, cottura, occasione, carattere, cucina).
// Proposte salvate sul dispositivo; si salvano solo i tag confermati.
const AI_META = 'tag_ai'; // { recipe_id: { tags: [], course } }

export default function TagAI() {
  const data = useData();
  const rec = useRecipes();
  const nav = useNavigate();
  const [ai, setAi] = useState(null);
  const [off, setOff] = useState({}); // { rid: Set(tag scartati) }
  const [sel, setSel] = useState(new Set());
  const [tab, setTab] = useState('todo');
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    getMeta(AI_META, {}).then((v) => setAi(v || {}));
  }, []);

  const rows = useMemo(() => {
    if (!rec || !ai) return [];
    return rec.list.map((r) => {
      const have = cleanTags(r.tags, r.title);
      const prop = ai[r.id];
      const fresh = prop ? prop.tags.filter((t) => !have.includes(t)) : [];
      return { r, have, prop, fresh, course: courseOf(r) };
    });
  }, [rec, ai]);

  if (!data || !rec || !ai) return null;
  const todo = rows.filter((x) => !x.prop || x.fresh.length);
  const toAsk = rows.filter((x) => !x.prop);
  const shown = tab === 'todo' ? todo : rows;
  const chosen = (x) => x.fresh.filter((t) => !off[x.r.id]?.has(t));

  function toggleTag(rid, t) {
    setOff((o) => {
      const s = new Set(o[rid] || []);
      s.has(t) ? s.delete(t) : s.add(t);
      return { ...o, [rid]: s };
    });
    setSel((s) => new Set(s).add(rid));
  }
  function toggle(rid) {
    const n = new Set(sel);
    n.has(rid) ? n.delete(rid) : n.add(rid);
    setSel(n);
  }

  async function askAi() {
    setErr(null);
    const next = { ...ai };
    try {
      for (let i = 0; i < toAsk.length; i += 15) {
        setBusy({ done: i, total: toAsk.length });
        const part = toAsk.slice(i, i + 15);
        const items = part.map(({ r, course }) => ({
          title: r.title,
          course: course?.value || '',
          minutes: totalMin(r) || null,
          ingredients: (rec.ings[r.id] || []).filter((x) => !x.optional).map((x) => data.products[x.product_id]?.name || x.text).slice(0, 15),
        }));
        const res = await apiFetch('/api/ai/tags', { method: 'POST', body: JSON.stringify({ items }) });
        res.items.forEach((x, n) => part[n] && (next[part[n].r.id] = { tags: x.tags, course: x.course }));
        await setMeta(AI_META, next);
        setAi({ ...next });
        setSel((s) => new Set([...s, ...part.map((x) => x.r.id)]));
      }
      showToast('Tag proposti: controlla e conferma');
    } catch (e) {
      setErr(`AI non disponibile: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    const ops = [];
    for (const x of rows) {
      if (!sel.has(x.r.id) || !x.prop) continue;
      const add = chosen(x);
      const row = { id: x.r.id };
      if (add.length) row.tags = joinList([...x.have, ...add]);
      else if (x.r.tags !== joinList(x.have)) row.tags = joinList(x.have) || null; // toglie i tag "spazzatura"
      if (!x.r.course && x.prop.course) row.course = x.prop.course;
      if (Object.keys(row).length > 1) ops.push({ table: 'recipes', row });
    }
    // proposte confermate o scartate: non riproporle come "da rivedere"
    const next = { ...ai };
    for (const x of rows) if (sel.has(x.r.id) && next[x.r.id]) next[x.r.id] = { ...next[x.r.id], tags: [] };
    if (ops.length) await save(ops, `Tag AI su ${ops.length} ricette`);
    await setMeta(AI_META, next);
    setAi(next);
    setSel(new Set());
    setOff({});
    showToast(`Tag salvati su ${ops.length} ricette`, ops.length ? { label: 'Annulla', run: () => undo() } : undefined);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconButton label="Indietro" onClick={() => nav('/ricette')}>
          <ArrowLeft size={18} />
        </IconButton>
        <div>
          <h1 className="text-2xl font-bold leading-tight">Tag ricette</h1>
          <p className="text-text-secondary text-sm">{toAsk.length} ricette senza proposta · {todo.length - toAsk.length} da rivedere</p>
        </div>
      </div>

      <div className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <p className="text-sm text-text-secondary">
          L'AI propone tag su ingrediente principale, cottura, occasione, carattere e cucina (e la portata se manca). Tocca un tag per scartarlo. Portata, tempo e difficoltà restano automatici.
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
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'todo', label: 'Da fare', count: todo.length }, { value: 'all', label: 'Tutte', count: rows.length }]} />
        <div className="flex gap-3 text-sm">
          <button type="button" className="text-brand font-semibold" onClick={() => setSel(new Set(rows.filter((x) => x.fresh.length).map((x) => x.r.id)))}>Seleziona proposte</button>
          <button type="button" className="text-text-muted" onClick={() => setSel(new Set())}>Nessuna</button>
        </div>
      </div>

      {shown.length === 0 ? (
        <Empty icon={Tags}>Tutte le ricette hanno i tag.</Empty>
      ) : (
        <ul className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
          {shown.map((x) => (
            <li key={x.r.id} className="px-3 py-3 space-y-2" data-testid="tag-row">
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={sel.has(x.r.id)} disabled={!x.prop} onChange={() => toggle(x.r.id)} />
                <span className="font-semibold flex-1 min-w-0 truncate">{x.r.title}</span>
                <span className="text-xs text-text-muted shrink-0">{x.course?.value || x.prop?.course || ''}</span>
              </label>
              <div className="flex flex-wrap gap-1.5">
                {x.have.map((t) => (
                  <span key={t} className="rounded-full border border-bg-border px-2 py-0.5 text-xs text-text-secondary">#{t}</span>
                ))}
                {x.fresh.map((t) => {
                  const on = !off[x.r.id]?.has(t);
                  return (
                    <button key={t} type="button" onClick={() => toggleTag(x.r.id, t)} className={`rounded-full border px-2 py-0.5 text-xs ${on ? 'border-brand/60 bg-brand/15 text-brand' : 'border-dashed border-bg-border text-text-muted line-through'}`}>
                      + {t}
                    </button>
                  );
                })}
                {!x.prop && <span className="text-xs text-text-muted">nessuna proposta</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
