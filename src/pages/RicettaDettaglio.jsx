import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Pencil, Star, Clock, Flame, Hourglass, Gauge, ChefHat, UtensilsCrossed, ShoppingCart, Share2, FileDown, Trash2, Timer, ExternalLink, Plus } from 'lucide-react';
import { useData, useRecipes, showToast } from '../hooks/useData.js';
import { Button, IconButton, Stepper, Empty } from '../components/ui/kit.jsx';
import { Photo, IngredientList, CookedModal, LinkModal, Stars, freqText } from '../components/recipes.jsx';
import { recipeHistory } from '../db/meals.js';
import { PLACES, daysBetween } from '../db/variety.js';
import { todayISO } from '../db/logic.js';
import { ProductForm } from '../components/forms.jsx';
import { recipeStatus, addMissingToList, recipeToText, parseList, joinList, suggestDiet, NO_PRODUCT } from '../db/recipes.js';
import { fmtQty } from '../db/logic.js';
import { put, save, undo } from '../db/repo.js';
import { StatusChip } from './Ricette.jsx';
import { autoTags, cleanTags, featuresOf, foodLabel, FEATURE_LABEL } from '../db/tags.js';
import { expiringSet, urgentOf, recipeCost, nutritionOf, NUTRI_LABELS } from '../db/insights.js';
import { euro } from '../db/logic.js';

export default function RicettaDettaglio() {
  const { id } = useParams();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const data = useData();
  const rec = useRecipes();
  const recipe = rec?.byId[id];
  const [showHist, setShowHist] = useState(false);
  const [servings, setServings] = useState(null);
  const [cooked, setCooked] = useState(false);
  const [linking, setLinking] = useState(null);
  const [creating, setCreating] = useState(null);
  const planId = params.get('piano');

  useEffect(() => {
    if (recipe && servings == null) setServings(Number(params.get('porzioni')) || 1);
  }, [recipe, servings, params]);
  useEffect(() => {
    if (params.get('cucinato') && recipe) {
      setCooked(true);
      params.delete('cucinato');
      setParams(params, { replace: true });
    }
  }, [params, recipe, setParams]);

  const ings = rec?.ings[id] || [];
  const steps = rec?.steps[id] || [];
  const scale = recipe ? (servings || 1) / (recipe.servings || 1) : 1;
  const status = useMemo(() => (data && rec ? recipeStatus(ings, scale, data, rec.subs) : null), [data, rec, ings, scale]);

  if (!data || !rec) return null;
  if (!recipe) return <Empty icon={ChefHat}>Ricetta non trovata. <Link to="/ricette" className="text-brand">Torna al ricettario</Link></Empty>;

  const diet = parseList(recipe.diet_tags);
  const tags = cleanTags(recipe.tags, recipe.title);
  const auto = autoTags(recipe, ings, steps);
  const urgent = urgentOf(ings, expiringSet(data), data);
  const hist = recipeHistory(rec, id);
  const lastAgo = hist.length ? daysBetween(hist[0].date, todayISO()) : null;
  const cost = recipeCost(ings, scale, data);
  const nutri = nutritionOf(recipe);
  const feats = featuresOf(recipe, { kcal: nutri?.kcal ?? null, cost: recipeCost(ings, 1 / (recipe.servings || 1), data) });
  const portions = servings || 1;
  const suggested = suggestDiet(recipe, ings, data).filter((t) => !diet.includes(t));
  const toBuy = status.rows.filter(({ ing, st }) => !ing.optional && !st.sub && (st.level === 'missing' || st.level === 'low')).length;

  async function addMissing() {
    const n = await addMissingToList(recipe, status, data);
    showToast(n ? `${n} in lista spesa` : 'Già tutto in lista', n ? { label: 'Annulla', run: () => undo() } : undefined);
  }
  async function share() {
    const text = recipeToText(recipe, ings, steps, scale);
    try {
      if (navigator.share) await navigator.share({ title: recipe.title, text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Ricetta copiata negli appunti');
      }
    } catch {
      /* condivisione annullata */
    }
  }
  function exportPdf() {
    const old = document.title;
    document.title = recipe.title;
    window.print();
    setTimeout(() => (document.title = old), 500);
  }
  async function del() {
    const ops = [{ table: 'recipes', row: { id, deleted: 1 } }, ...ings.map((i) => ({ table: 'recipe_ingredients', row: { id: i.id, deleted: 1 } })), ...steps.map((s) => ({ table: 'recipe_steps', row: { id: s.id, deleted: 1 } }))];
    await save(ops, `Eliminata ricetta ${recipe.title}`);
    showToast(`Eliminata ${recipe.title}`, { label: 'Annulla', run: () => undo() });
    nav('/ricette');
  }
  async function link(ing, p) {
    await put('recipe_ingredients', { id: ing.id, product_id: p.id }, `${ing.text} → ${p.name}`);
    setLinking(null);
  }

  return (
    <div className="space-y-5 recipe-print">
      <div className="flex items-center gap-2 print:hidden">
        <IconButton label="Indietro" onClick={() => nav('/ricette')}>
          <ArrowLeft size={18} />
        </IconButton>
        <div className="flex-1" />
        <IconButton label={recipe.favorite ? 'Togli dalle preferite' : 'Preferita'} onClick={() => put('recipes', { id, favorite: recipe.favorite ? 0 : 1 })}>
          <Star size={18} className={recipe.favorite ? 'fill-brand text-brand' : ''} />
        </IconButton>
        <IconButton label="Condividi testo" onClick={share}>
          <Share2 size={18} />
        </IconButton>
        <IconButton label="Esporta PDF" onClick={exportPdf}>
          <FileDown size={18} />
        </IconButton>
        <IconButton label="Modifica" onClick={() => nav(`/ricette/${id}/modifica`)}>
          <Pencil size={18} />
        </IconButton>
        <IconButton label="Elimina" onClick={del}>
          <Trash2 size={18} />
        </IconButton>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start">
        {recipe.photo_key ? <Photo id={recipe.photo_key} alt={recipe.title} className="w-full aspect-[4/3] rounded-lg" icon={false} /> : null}
        <div className={`space-y-3 ${recipe.photo_key ? '' : 'md:col-span-2'}`}>
          <h1 className="text-2xl md:text-3xl font-bold leading-tight">{recipe.title}</h1>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-text-secondary">
            {recipe.prep_min ? <Meta icon={Clock}>prep {recipe.prep_min}′</Meta> : null}
            {recipe.cook_min ? <Meta icon={Flame}>cottura {recipe.cook_min}′</Meta> : null}
            {recipe.rest_min ? <Meta icon={Hourglass}>riposo {recipe.rest_min}′</Meta> : null}
            {recipe.cooked_count ? <Meta icon={ChefHat}>cucinata {recipe.cooked_count}× · ultima {new Date(recipe.last_cooked_at).toLocaleDateString('it-IT')}</Meta> : null}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="print:hidden"><StatusChip st={status} /></span>
            {auto.course && <AutoTag label="portata" auto={auto.course.auto}>{auto.course.value}</AutoTag>}
            {auto.main && <AutoTag label="alimento principale">{foodLabel(auto.main.value)}</AutoTag>}
            {auto.second && <AutoTag label="alimento secondario">+ {foodLabel(auto.second.value)}</AutoTag>}
            {auto.time && <AutoTag label="tempo totale (con riposo)" icon={Clock}>{auto.time}</AutoTag>}
            {auto.difficulty && <AutoTag label="difficoltà" icon={Gauge} auto={auto.difficulty.auto}>{auto.difficulty.label}</AutoTag>}
            {[...feats].map((f) => (
              <span key={f} className="rounded-full border border-bg-border px-2 py-0.5 text-xs text-text-secondary">{FEATURE_LABEL[f]}</span>
            ))}
            {diet.map((t) => (
              <span key={t} className="rounded-full border border-brand/50 text-brand px-2 py-0.5 text-xs">{t}</span>
            ))}
            {tags.map((t) => (
              <span key={t} className="rounded-full border border-bg-border px-2 py-0.5 text-xs text-text-secondary">#{t}</span>
            ))}
            {suggested.map((t) => (
              <button key={t} type="button" onClick={() => put('recipes', { id, diet_tags: joinList([...diet, t]) }, `Tag ${t}`)} className="print:hidden inline-flex items-center gap-0.5 rounded-full border border-dashed border-text-muted px-2 py-0.5 text-xs text-text-muted">
                <Plus size={12} /> {t}?
              </button>
            ))}
          </div>
          <div className="grid gap-1 rounded-md border border-bg-border bg-bg-surface px-3 py-2 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-text-secondary">Quanto mi piace</span>
              <Stars value={recipe.rating || null} label="Gradimento" onChange={(v) => put('recipes', { id, rating: v }, `${recipe.title}: ${v ? `★${v}` : 'senza voto'}`)} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-text-secondary">Quanto spesso <span className="text-text-muted text-xs">· {freqText(recipe.want_freq)}</span></span>
              <Stars kind="freq" value={recipe.want_freq ?? null} label="Frequenza desiderata" onChange={(v) => put('recipes', { id, want_freq: v }, `${recipe.title}: frequenza ${freqText(v)}`)} />
            </div>
            <div className="text-xs text-text-muted">
              {hist.length ? `Fatta ${hist.length} ${hist.length === 1 ? 'volta' : 'volte'} · ultima ${lastAgo === 0 ? 'oggi' : lastAgo === 1 ? 'ieri' : `${lastAgo} giorni fa`}` : 'Mai fatta (secondo il diario)'}
              {hist.length > 0 && (
                <button type="button" className="ml-2 text-brand font-semibold" onClick={() => setShowHist((v) => !v)}>{showHist ? 'nascondi' : 'storico'}</button>
              )}
            </div>
            {showHist && (
              <ul className="text-xs text-text-secondary divide-y divide-bg-border">
                {hist.slice(0, 12).map((h) => (
                  <li key={h.id} className="flex justify-between py-1">
                    <span>{new Date(`${h.date}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' })} · {h.meal}{h.leftover_of ? ' · avanzo' : ''}</span>
                    <span>{PLACES.find((p) => p.id === h.place)?.label}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1 print:hidden">
            <Button onClick={() => nav(`/ricette/${id}/cucina?porzioni=${servings}${planId ? `&piano=${planId}` : ''}`)} disabled={!steps.length}>
              <UtensilsCrossed size={16} /> Cucina
            </Button>
            <Button variant="ghost" onClick={() => setCooked(true)}>
              <ChefHat size={16} /> Ho cucinato
            </Button>
            {toBuy > 0 && (
              <Button variant="ghost" onClick={addMissing}>
                <ShoppingCart size={16} /> Mancanti in lista ({toBuy})
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start">
        <section className="rounded-lg border border-bg-border bg-bg-surface p-4 shadow-card">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h2 className="font-bold">Ingredienti</h2>
            <div className="print:hidden">
              <Stepper value={servings || 1} unit="porz." min={1} onChange={(v) => setServings(Math.max(1, v))} />
            </div>
            <span className="hidden print:inline text-sm">{fmtQty(servings || 1)} porzioni</span>
          </div>
          {urgent.length > 0 && (
            <p className="mb-2 rounded-md bg-warning/10 border border-warning/40 px-3 py-2 text-sm text-warning">Usa prima: {urgent.join(', ')} (in scadenza).</p>
          )}
          {ings.length ? <IngredientList rows={status.rows} scale={scale} onLink={setLinking} onOptional={(ing) => put('recipe_ingredients', { id: ing.id, optional: ing.optional ? 0 : 1 }, `${ing.text}: ${ing.optional ? 'conta di nuovo' : 'superfluo'}`)} /> : <p className="text-sm text-text-muted">Nessun ingrediente.</p>}
          {(cost.known > 0 || cost.unknown.length > 0) && (
            <div className="mt-3 pt-3 border-t border-bg-border text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-text-secondary">Costo stimato</span>
                <span className="font-semibold tabular-nums">
                  {cost.known ? `${euro(cost.total / portions)} / porz.` : '—'}
                  {portions > 1 && cost.known ? <span className="text-text-muted font-normal"> · {euro(cost.total)} tot.</span> : null}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Dall'ultimo prezzo pagato{cost.unknown.length ? `; senza prezzo: ${cost.unknown.join(', ')}` : ''}. Esclusi i “q.b.”.
              </p>
            </div>
          )}
          {nutri && (
            <div className="mt-3 pt-3 border-t border-bg-border">
              <div className="flex justify-between text-sm mb-1">
                <span className="font-semibold">Valori nutrizionali</span>
                <span className="text-text-muted text-xs">per porzione{portions > 1 ? ` · ×${fmtQty(portions)}` : ''}</span>
              </div>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 text-sm">
                {NUTRI_LABELS.filter(([k]) => nutri[k] != null).map(([k, label, u]) => (
                  <div key={k} className={`flex justify-between py-0.5 ${label.startsWith('di cui') ? 'text-text-muted text-xs pl-2' : ''}`}>
                    <dt>{label}</dt>
                    <dd className="tabular-nums">
                      {fmtQty(Math.round(nutri[k] * (k === 'kcal' ? 1 : 10)) / (k === 'kcal' ? 1 : 10))} {u}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-bg-border bg-bg-surface p-4 shadow-card">
          <h2 className="font-bold mb-2">Preparazione</h2>
          {steps.length ? (
            <ol className="space-y-4">
              {steps.map((s, n) => (
                <li key={s.id} className="flex gap-3">
                  <span className="shrink-0 w-7 h-7 rounded-full bg-brand text-brand-on font-bold text-sm flex items-center justify-center">{n + 1}</span>
                  <div className="flex-1 min-w-0 space-y-2">
                    <p className="whitespace-pre-line leading-relaxed">{s.text}</p>
                    {s.timer_min ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
                        <Timer size={14} /> {fmtQty(s.timer_min)} min
                      </span>
                    ) : null}
                    {s.photo_key ? <Photo id={s.photo_key} className="w-full max-w-sm aspect-video rounded-md" icon={false} /> : null}
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-text-muted">Nessun passaggio.</p>
          )}
        </section>
      </div>

      {(recipe.notes || recipe.source_url) && (
        <section className="rounded-lg border border-bg-border bg-bg-surface p-4 shadow-card space-y-2">
          {recipe.notes && <p className="whitespace-pre-line text-sm">{recipe.notes}</p>}
          {recipe.source_url && (
            <a href={recipe.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand text-sm break-all">
              <ExternalLink size={14} /> {recipe.source_url}
            </a>
          )}
        </section>
      )}

      {cooked && <CookedModal recipe={recipe} status={status} servings={servings || 1} data={data} rec={rec} planId={planId} urgent={urgent.length} onClose={() => setCooked(false)} />}
      {linking && (
        <LinkModal
          ing={linking}
          data={data}
          onClose={() => setLinking(null)}
          onPick={(p) => link(linking, p)}
          onSkip={() => link(linking, { id: NO_PRODUCT, name: 'non serve' })}
          onCreate={(name) => setCreating({ ing: linking, name })}
        />
      )}
      {creating && (
        <ProductForm
          data={data}
          initialName={creating.name}
          area="cibo"
          onClose={() => setCreating(null)}
          onSaved={(p) => link(creating.ing, p)}
        />
      )}
    </div>
  );
}

function Meta({ icon: Icon, children }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Icon size={14} /> {children}
    </span>
  );
}

// Tag automatico (portata, tempo, difficolta'): "~" se dedotto e non scelto a mano.
function AutoTag({ children, icon: Icon, auto, label }) {
  return (
    <span title={auto ? `${label} (automatica: cambiala in Modifica)` : label} className="inline-flex items-center gap-1 rounded-full bg-bg-elevated border border-bg-border px-2 py-0.5 text-xs font-medium">
      {Icon ? <Icon size={12} /> : null}
      {children}
      {auto ? <span className="text-text-muted">~</span> : null}
    </span>
  );
}
