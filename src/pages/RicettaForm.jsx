import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowUp, ArrowDown, Trash2, Link2, ClipboardPaste, Plus, Timer, Sparkles } from 'lucide-react';
import { useData, useRecipes, showToast } from '../hooks/useData.js';
import { Button, IconButton, Field, Input, Select, Modal, Toggle } from '../components/ui/kit.jsx';
import { PhotoPicker, LinkModal, Stars } from '../components/recipes.jsx';
import { ProductForm } from '../components/forms.jsx';
import { autoTags, cleanTags, courseOf, COURSES, DIFF_LABEL } from '../db/tags.js';
import { FoodSelect, FeaturePicker } from './TagAI.jsx';
import { parseIngredientLine, autoLink, learnedLinks, NO_PRODUCT, RECIPE_UNITS, DIET_TAGS, DIFFICULTY, parseList, joinList, detectTimer, suggestDiet } from '../db/recipes.js';
import { save } from '../db/repo.js';
import { uuid } from '../db/db.js';

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const txtArea = 'w-full rounded-md bg-bg-elevated border border-bg-border px-3 py-2.5 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand';

const EMPTY = { title: '', servings: 1, prep_min: '', cook_min: '', rest_min: '', difficulty: '', course: '', main_food: '', second_food: '', features: '', tags: '', diet_tags: '', photo_key: null, source_url: '', notes: '', rating: null };

export default function RicettaForm() {
  const { id } = useParams();
  const nav = useNavigate();
  const location = useLocation();
  const draft = !id ? location.state?.draft : null;
  const data = useData();
  const rec = useRecipes();
  const [f, setF] = useState(null);
  const [ings, setIngs] = useState([]);
  const [steps, setSteps] = useState([]);
  const [newIng, setNewIng] = useState('');
  const [paste, setPaste] = useState(null); // 'ing' | 'steps'
  const [pasteText, setPasteText] = useState('');
  const [linking, setLinking] = useState(null);
  const [creating, setCreating] = useState(null);

  useEffect(() => {
    if (f || !rec) return;
    if (id) {
      const r = rec.byId[id];
      if (!r) return;
      setF({ ...EMPTY, ...r, prep_min: r.prep_min ?? '', cook_min: r.cook_min ?? '', rest_min: r.rest_min ?? '', course: courseOf(r)?.value || '', tags: cleanTags(r.tags, r.title).join(', ') });
      setIngs((rec.ings[id] || []).map((i) => ({ ...i })));
      setSteps((rec.steps[id] || []).map((s) => ({ ...s })));
    } else if (draft && data) {
      setF({ ...EMPTY, ...draft, prep_min: draft.prep_min ?? '', cook_min: draft.cook_min ?? '', rest_min: draft.rest_min ?? '', tags: draft.tags || '', notes: draft.notes || '', source_url: draft.source_url || '' });
      setIngs((draft.ingredients || []).map((i) => ({ id: uuid(), text: i.text, qty: i.qty ?? null, unit: i.unit || '', product_id: autoLink(i.text, data.products, rec && learnedLinks(rec.ings, data.products)), optional: i.optional ? 1 : 0, grp: i.grp || null })));
      setSteps((draft.steps || []).map((s) => ({ id: uuid(), text: s.text, timer_min: s.timer_min ?? null, photo_key: s.photo_key || null })));
    } else if (!draft) setF({ ...EMPTY });
  }, [id, rec, f, draft, data]);

  if (!data || !rec || !f) return null;
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const diet = parseList(f.diet_tags);
  const autoT = autoTags({ ...f, course: '', difficulty: '', prep_min: num(f.prep_min), cook_min: num(f.cook_min), rest_min: num(f.rest_min) }, ings, steps);

  function makeIng(parsed) {
    return { id: uuid(), text: parsed.text, qty: parsed.qty, unit: parsed.unit || '', product_id: autoLink(parsed.text, data.products, learnedLinks(rec.ings, data.products)), optional: 0, grp: null, _new: true };
  }
  function addLine() {
    const parsed = parseIngredientLine(newIng);
    if (parsed) setIngs((a) => [...a, makeIng(parsed)]);
    setNewIng('');
  }
  function applyPaste() {
    if (paste === 'ing') {
      let grp = null;
      const out = [];
      for (const raw of pasteText.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        // "Per la salsa:" = gruppo
        if (/:$/.test(line) && line.length < 40) {
          grp = line.replace(/:$/, '');
          continue;
        }
        const parsed = parseIngredientLine(line);
        if (parsed) out.push({ ...makeIng(parsed), grp });
      }
      setIngs((a) => [...a, ...out]);
    } else {
      const blocks = pasteText.includes('\n\n') ? pasteText.split(/\n\s*\n/) : pasteText.split('\n');
      const out = blocks
        .map((b) => b.replace(/^\s*\d+[.)]\s*/, '').trim())
        .filter(Boolean)
        .map((text) => ({ id: uuid(), text, timer_min: detectTimer(text), photo_key: null, _new: true }));
      setSteps((a) => [...a, ...out]);
    }
    setPaste(null);
    setPasteText('');
  }
  const upd = (setter, i, patch) => setter((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const move = (setter, i, d) =>
    setter((a) => {
      const b = [...a];
      const j = i + d;
      if (j < 0 || j >= b.length) return a;
      [b[i], b[j]] = [b[j], b[i]];
      return b;
    });

  async function submit() {
    if (!f.title.trim()) return;
    const rid = id || uuid();
    const row = {
      id: rid,
      title: f.title.trim(),
      servings: num(f.servings) || 1,
      prep_min: num(f.prep_min),
      cook_min: num(f.cook_min),
      rest_min: num(f.rest_min),
      difficulty: f.difficulty || null,
      course: f.course || null,
      main_food: f.main_food || null,
      second_food: f.second_food && f.second_food !== f.main_food ? f.second_food : null,
      features: joinList(parseList(f.features)) || null,
      tags: joinList(parseList(f.tags)) || null,
      diet_tags: joinList(diet) || null,
      photo_key: f.photo_key || null,
      source_url: f.source_url.trim() || null,
      notes: f.notes.trim() || null,
      rating: Number(f.rating) || null,
      deleted: 0,
    };
    const ops = [{ table: 'recipes', row }];
    const keepI = new Set();
    ings.forEach((i, n) => {
      if (!i.text.trim()) return;
      keepI.add(i.id);
      ops.push({ table: 'recipe_ingredients', row: { id: i.id, recipe_id: rid, product_id: i.product_id || null, text: i.text.trim(), qty: num(i.qty), unit: i.unit || null, optional: i.optional ? 1 : 0, grp: i.grp?.trim() || null, sort: n, deleted: 0 } });
    });
    const keepS = new Set();
    steps.forEach((s, n) => {
      if (!s.text.trim()) return;
      keepS.add(s.id);
      ops.push({ table: 'recipe_steps', row: { id: s.id, recipe_id: rid, text: s.text.trim(), timer_min: num(s.timer_min), photo_key: s.photo_key || null, sort: n, deleted: 0 } });
    });
    if (id) {
      for (const i of rec.ings[id] || []) if (!keepI.has(i.id)) ops.push({ table: 'recipe_ingredients', row: { id: i.id, deleted: 1 } });
      for (const s of rec.steps[id] || []) if (!keepS.has(s.id)) ops.push({ table: 'recipe_steps', row: { id: s.id, deleted: 1 } });
    }
    await save(ops, id ? `Modificata ricetta ${row.title}` : `Nuova ricetta ${row.title}`);
    showToast('Ricetta salvata');
    nav(`/ricette/${rid}`, { replace: true });
  }

  const suggested = suggestDiet({ prep_min: num(f.prep_min), cook_min: num(f.cook_min) }, ings.filter((i) => i.text.trim()), data).filter((t) => !diet.includes(t));

  return (
    <div className="space-y-5 pb-20">
      <div className="flex items-center gap-2">
        <IconButton label="Indietro" onClick={() => nav(id ? `/ricette/${id}` : '/ricette')}>
          <ArrowLeft size={18} />
        </IconButton>
        <h1 className="flex-1 text-xl md:text-2xl font-bold">{id ? 'Modifica ricetta' : 'Nuova ricetta'}</h1>
        <Button onClick={submit} disabled={!f.title.trim()}>Salva</Button>
      </div>

      {draft && (
        <div className="flex items-start gap-2 rounded-md border border-brand/40 bg-brand-dim/40 px-4 py-3 text-sm">
          <Sparkles size={16} className="mt-0.5 shrink-0 text-brand" />
          <span>
            Importata ({location.state?.via || 'import'}): controlla titolo, dosi e collegamenti al catalogo, poi Salva.
            {ings.filter((i) => !i.product_id).length ? ` ${ings.filter((i) => !i.product_id).length} ingredienti da collegare.` : ''}
          </span>
        </div>
      )}
      <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-4">
        <Field label="Titolo">
          <Input value={f.title} onChange={(e) => set('title')(e.target.value)} placeholder="Es. Spaghetti aglio, olio e peperoncino" autoFocus={!id} />
        </Field>
        <Field label="Foto">
          <PhotoPicker value={f.photo_key} onChange={set('photo_key')} />
        </Field>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Dosi per (porz.)">
            <Input inputMode="decimal" value={f.servings} onChange={(e) => set('servings')(e.target.value)} />
          </Field>
          <Field label="Prep. (min)">
            <Input inputMode="numeric" value={f.prep_min} onChange={(e) => set('prep_min')(e.target.value)} />
          </Field>
          <Field label="Cottura (min)">
            <Input inputMode="numeric" value={f.cook_min} onChange={(e) => set('cook_min')(e.target.value)} />
          </Field>
          <Field label="Riposo (min)">
            <Input inputMode="numeric" value={f.rest_min} onChange={(e) => set('rest_min')(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Portata">
            <Select value={f.course || ''} onChange={(e) => set('course')(e.target.value)}>
              <option value="">auto{autoT.course ? ` (${autoT.course.value})` : ''}</option>
              {COURSES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Difficoltà">
            <Select value={f.difficulty || ''} onChange={(e) => set('difficulty')(e.target.value)}>
              <option value="">auto{autoT.difficulty ? ` (${autoT.difficulty.label})` : ''}</option>
              {DIFFICULTY.map((d) => (
                <option key={d} value={d}>{DIFF_LABEL[d]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Alimento principale">
            <FoodSelect value={f.main_food} onChange={(v) => set('main_food')(v || '')} />
          </Field>
          <Field label="Secondario (facoltativo)">
            <FoodSelect value={f.second_food} onChange={(v) => set('second_food')(v || '')} />
          </Field>
        </div>
        <Field label="Caratteristiche" hint="Leggero, economico e richiede riposo si calcolano da soli (su 1 porzione).">
          <FeaturePicker value={parseList(f.features)} onChange={(v) => set('features')(joinList(v))} />
        </Field>
        <div>
          <Field label="Altri tag" hint="separati da virgola · il tempo è automatico">
            <Input value={f.tags || ''} onChange={(e) => set('tags')(e.target.value)} placeholder="primo, pasta" />
          </Field>
        </div>
        <Field label="Dieta">
          <div className="flex flex-wrap gap-2">
            {DIET_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set('diet_tags')(joinList(diet.includes(t) ? diet.filter((x) => x !== t) : [...diet, t]))}
                className={`rounded-full px-3 py-1 text-xs font-medium border ${diet.includes(t) ? 'bg-brand text-brand-on border-brand' : suggested.includes(t) ? 'border-dashed border-brand text-brand' : 'border-bg-border text-text-secondary'}`}
              >
                {t}
                {suggested.includes(t) ? ' ?' : ''}
              </button>
            ))}
          </div>
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-text-secondary">Quanto mi piace <span className="text-text-muted text-xs">· ★★★★★ = preferita</span></span>
          <Stars value={Number(f.rating) || null} label="Gradimento" onChange={(v) => set('rating')(v)} />
        </div>
      </section>

      <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">Ingredienti</h2>
          <Button variant="ghost" onClick={() => setPaste('ing')}>
            <ClipboardPaste size={16} /> Incolla lista
          </Button>
        </div>
        <div className="flex gap-2">
          <Input value={newIng} onChange={(e) => setNewIng(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addLine())} placeholder="Es. 200 g spaghetti · 2 spicchi d'aglio · sale q.b." />
          <IconButton label="Aggiungi ingrediente" onClick={addLine} disabled={!newIng.trim()}>
            <Plus size={18} />
          </IconButton>
        </div>
        <ul className="space-y-3">
          {ings.map((i, n) => {
            const p = i.product_id && data.products[i.product_id];
            return (
              <li key={i.id} className="rounded-md border border-bg-border p-3 space-y-2">
                <div className="flex gap-2">
                  <Input value={i.text} onChange={(e) => upd(setIngs, n, { text: e.target.value })} placeholder="Ingrediente" />
                  <IconButton label="Su" onClick={() => move(setIngs, n, -1)} disabled={n === 0}>
                    <ArrowUp size={16} />
                  </IconButton>
                  <IconButton label="Giù" onClick={() => move(setIngs, n, 1)} disabled={n === ings.length - 1}>
                    <ArrowDown size={16} />
                  </IconButton>
                  <IconButton label="Togli" onClick={() => setIngs((a) => a.filter((_, j) => j !== n))}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
                <div className="grid grid-cols-[5rem_7rem_1fr] gap-2 items-center">
                  <Input inputMode="decimal" value={i.qty ?? ''} onChange={(e) => upd(setIngs, n, { qty: e.target.value })} placeholder="qtà" />
                  <Select value={i.unit || ''} onChange={(e) => upd(setIngs, n, { unit: e.target.value })}>
                    {[...new Set([...RECIPE_UNITS, i.unit || ''])].map((u) => (
                      <option key={u} value={u}>{u || '—'}</option>
                    ))}
                  </Select>
                  <button type="button" onClick={() => setLinking({ ing: i, n })} className={`inline-flex items-center gap-1 text-sm truncate ${p ? 'text-positive' : 'text-text-muted'}`}>
                    <Link2 size={14} className="shrink-0" /> <span className="truncate">{p ? p.name : i.product_id === NO_PRODUCT ? 'non serve' : 'collega'}</span>
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Toggle checked={!!i.optional} onChange={(v) => upd(setIngs, n, { optional: v ? 1 : 0 })} label="superfluo" />
                  <input value={i.grp || ''} onChange={(e) => upd(setIngs, n, { grp: e.target.value })} placeholder="gruppo (es. per la salsa)" className="flex-1 min-w-[10rem] bg-transparent border-b border-bg-border text-sm py-1 focus:outline-none focus:border-brand" />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">Passaggi</h2>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setPaste('steps')}>
              <ClipboardPaste size={16} /> Incolla
            </Button>
            <IconButton label="Nuovo passaggio" onClick={() => setSteps((a) => [...a, { id: uuid(), text: '', timer_min: null, photo_key: null, _new: true }])}>
              <Plus size={18} />
            </IconButton>
          </div>
        </div>
        <ol className="space-y-3">
          {steps.map((s, n) => (
            <li key={s.id} className="rounded-md border border-bg-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-brand text-brand-on font-bold text-sm flex items-center justify-center shrink-0">{n + 1}</span>
                <div className="flex-1" />
                <IconButton label="Su" onClick={() => move(setSteps, n, -1)} disabled={n === 0}>
                  <ArrowUp size={16} />
                </IconButton>
                <IconButton label="Giù" onClick={() => move(setSteps, n, 1)} disabled={n === steps.length - 1}>
                  <ArrowDown size={16} />
                </IconButton>
                <IconButton label="Togli" onClick={() => setSteps((a) => a.filter((_, j) => j !== n))}>
                  <Trash2 size={16} />
                </IconButton>
              </div>
              <textarea
                rows={3}
                className={txtArea}
                value={s.text}
                onChange={(e) => upd(setSteps, n, { text: e.target.value })}
                onBlur={() => s.timer_min == null && detectTimer(s.text) && upd(setSteps, n, { timer_min: detectTimer(s.text) })}
                placeholder="Descrivi il passaggio…"
              />
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-text-secondary">
                  <Timer size={16} /> timer
                  <input inputMode="decimal" value={s.timer_min ?? ''} onChange={(e) => upd(setSteps, n, { timer_min: e.target.value })} className="w-16 rounded-md bg-bg-elevated border border-bg-border px-2 py-1.5 text-text-primary" />
                  min
                </label>
                <PhotoPicker compact value={s.photo_key} onChange={(v) => upd(setSteps, n, { photo_key: v })} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-4">
        <Field label="Fonte (link)">
          <Input type="url" value={f.source_url || ''} onChange={(e) => set('source_url')(e.target.value)} placeholder="https://…" />
        </Field>
        <Field label="Note">
          <textarea rows={3} className={txtArea} value={f.notes || ''} onChange={(e) => set('notes')(e.target.value)} placeholder="Consigli, conservazione, varianti…" />
        </Field>
      </section>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={!f.title.trim()}>Salva ricetta</Button>
      </div>

      {paste && (
        <Modal
          title={paste === 'ing' ? 'Incolla ingredienti' : 'Incolla passaggi'}
          onClose={() => setPaste(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPaste(null)}>Annulla</Button>
              <Button onClick={applyPaste} disabled={!pasteText.trim()}>Aggiungi</Button>
            </>
          }
        >
          <p className="text-sm text-text-secondary">
            {paste === 'ing'
              ? 'Un ingrediente per riga. Righe che finiscono con “:” diventano gruppi (es. “Per la salsa:”).'
              : 'Un passaggio per paragrafo (riga vuota tra uno e l’altro) o per riga. I minuti nel testo diventano timer.'}
          </p>
          <textarea rows={10} autoFocus className={txtArea} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={paste === 'ing' ? '320 g spaghetti\n2 spicchi d’aglio\nOlio extravergine 4 cucchiai\nPeperoncino q.b.' : '1. Porta a bollore l’acqua…\n\n2. Cuoci la pasta 10 minuti…'} />
        </Modal>
      )}
      {linking && (
        <LinkModal
          ing={linking.ing}
          data={data}
          onClose={() => setLinking(null)}
          onPick={(p) => {
            upd(setIngs, linking.n, { product_id: p.id });
            setLinking(null);
          }}
          onSkip={() => {
            upd(setIngs, linking.n, { product_id: NO_PRODUCT });
            setLinking(null);
          }}
          onCreate={(name) => setCreating({ ...linking, name })}
        />
      )}
      {creating && (
        <ProductForm
          data={data}
          initialName={creating.name}
          area="cibo"
          onClose={() => setCreating(null)}
          onSaved={(p) => {
            upd(setIngs, creating.n, { product_id: p.id });
            setLinking(null);
          }}
        />
      )}
    </div>
  );
}
