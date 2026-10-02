import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { addDays, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, ShoppingCart, Trash2, Check, PenLine, ChefHat, Sparkles, MapPin, BarChart3, Apple } from 'lucide-react';
import { useData, useRecipes, showToast } from '../hooks/useData.js';
import { Button, IconButton, Modal, Field, Toggle, Select, Empty } from '../components/ui/kit.jsx';
import { AddDishModal, MealModal, VarietyDashboard, Analyses } from '../components/diary.jsx';
import { CookModal, RestoreModal, AddUsedModal } from '../components/cook.jsx';
import { needsCook, scalesAt } from '../db/cook.js';
import { dayCost } from '../db/consumi.js';
import { MEALS_ALL, PLACES, mealId, itemKindOfCourse } from '../db/variety.js';
import { getSetting, saveSetting, proposeFor, saveProposals, removeProposals } from '../db/meals.js';
import { foodLabel } from '../db/tags.js';
import { Photo } from '../components/recipes.jsx';
import { StatusChip } from './Ricette.jsx';
import { iso, weekStart, weekDays, planNeeds, addNeedsToList, dayLabel } from '../db/planner.js';
import { recipeStatus } from '../db/recipes.js';
import { euro } from '../db/logic.js';
import { put, remove, undo } from '../db/repo.js';
import { fmtAmount } from '../db/recipes.js';

export default function Planner() {
  const data = useData();
  const rec = useRecipes();
  const nav = useNavigate();
  const [start, setStart] = useState(() => weekStart());
  const [adding, setAdding] = useState(null); // { date, meal, done }
  const [mealEdit, setMealEdit] = useState(null); // { date, meal }
  const [fill, setFill] = useState(false);
  const [review, setReview] = useState(null);
  const [showAn, setShowAn] = useState(false);
  const [cooking, setCooking] = useState(null); // piatto da segnare mangiato con ingredienti
  const [restoring, setRestoring] = useState(null); // { entry, remove }
  const [addingUsed, setAddingUsed] = useState(null); // piatto gia' mangiato a cui aggiungere ingredienti
  const todayRef = useRef(null);
  const scrolled = useRef(false);
  useEffect(() => {
    // sul telefono i giorni sono in colonna: porta in vista oggi
    if (!scrolled.current && todayRef.current && window.innerWidth < 768) {
      scrolled.current = true;
      todayRef.current.scrollIntoView({ block: 'start' });
    }
  });

  const days = weekDays(start);
  const from = iso(days[0]);
  const to = iso(days[6]);
  const today = iso(new Date());
  const entries = useMemo(() => (rec ? rec.plan.filter((e) => e.date >= from && e.date <= to) : []), [rec, from, to]);
  const status = useMemo(() => {
    if (!data || !rec) return {};
    const out = {};
    for (const e of entries) {
      const r = e.recipe_id && rec.byId[e.recipe_id];
      if (r && !e.done) out[e.id] = recipeStatus(rec.ings[r.id] || [], (Number(e.servings) || 1) / (r.servings || 1), data, rec.subs);
    }
    return out;
  }, [entries, data, rec]);

  if (!data || !rec) return null;
  const extra = !!getSetting(rec, 'planner', {})?.extraMeals;
  const meals = MEALS_ALL.filter((m) => extra || !m.extra);
  const upcoming = entries.filter((e) => e.date >= today && !e.done);

  function openList() {
    const needs = planNeeds(upcoming, rec, data);
    if (!needs.length) return showToast(upcoming.length ? 'Hai già tutto per i pasti in programma 👍' : 'Nessun pasto da qui a fine settimana');
    setReview(needs);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Planner</h1>
          <p className="text-text-secondary text-sm">Pasti in programma e diario di cosa hai mangiato.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" aria-label="Riempi con proposte" onClick={() => setFill(true)}>
            <Sparkles size={18} /> <span className="hidden sm:inline">Riempi</span>
          </Button>
          <Button aria-label="Genera lista" onClick={openList} disabled={!upcoming.length}>
            <ShoppingCart size={18} /> <span className="hidden sm:inline">Lista</span>
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-lg border border-bg-border bg-bg-surface px-2 py-1.5">
        <IconButton label="Settimana precedente" onClick={() => setStart((d) => addDays(d, -7))}>
          <ChevronLeft size={18} />
        </IconButton>
        <button type="button" className="text-sm font-semibold" onClick={() => setStart(weekStart())}>
          {dayLabel(days[0], { day: 'numeric', month: 'short' })} – {dayLabel(days[6], { day: 'numeric', month: 'short' })}
          {iso(weekStart()) !== from && <span className="block text-xs text-brand font-normal">torna a oggi</span>}
        </button>
        <IconButton label="Settimana successiva" onClick={() => setStart((d) => addDays(d, 7))}>
          <ChevronRight size={18} />
        </IconButton>
      </div>

      <VarietyDashboard rec={rec} data={data} weekFrom={from} onGoal={(g) => nav(`/ricette?obiettivo=${g.id}`)} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="text-sm font-semibold text-brand" onClick={() => setShowAn((v) => !v)}>
          <BarChart3 size={16} className="inline -mt-0.5 mr-1" /> Analisi {showAn ? '▴' : '▾'}
        </button>
        <Toggle checked={extra} onChange={(v) => saveSetting('planner', { ...(getSetting(rec, 'planner', {}) || {}), extraMeals: v }, v ? 'Colazione e merenda: sì' : 'Colazione e merenda: no')} label="Colazione e merenda" />
      </div>
      {showAn && <Analyses rec={rec} data={data} />}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {days.map((d) => {
          const di = iso(d);
          const isToday = isSameDay(d, new Date());
          const past = di < today;
          return (
            <section key={di} ref={isToday ? todayRef : null} className={`min-w-0 rounded-lg border bg-bg-surface p-3 space-y-2 ${isToday ? 'border-brand' : 'border-bg-border'}`}>
              <h2 className="font-bold capitalize flex items-center gap-2">
                {dayLabel(d, { weekday: 'long', day: 'numeric' })}
                {isToday && <span className="rounded-full bg-brand text-brand-on px-2 py-0.5 text-[10px] uppercase">oggi</span>}
                {(() => {
                  const c = di <= today ? dayCost(rec, data, di) : 0;
                  return c > 0 ? (
                    <Link to={`/dispensa?vista=consumi&giorno=${di}`} className="ml-auto text-xs font-semibold normal-case text-text-secondary tabular-nums hover:text-brand" title="Ingredienti dei pasti di questo giorno">
                      {euro(c)}
                    </Link>
                  ) : null;
                })()}
              </h2>
              {meals.map((m) => {
                const list = entries.filter((e) => e.date === di && e.meal === m.id);
                const ml = rec.meals[mealId(di, m.id)];
                const place = ml?.place && list.length && ml.place !== 'casa' ? ml.place : null;
                return (
                  <div key={m.id}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs uppercase tracking-wider font-semibold text-text-muted flex items-center gap-2 min-w-0">
                        {m.label}
                        {place && (
                          <button type="button" onClick={() => setMealEdit({ date: di, meal: m.id })} className={`normal-case tracking-normal rounded-full border px-2 py-0.5 text-[11px] ${place === 'casa' ? 'border-bg-border text-text-muted' : 'border-warning/60 text-warning'}`}>
                            <MapPin size={11} className="inline -mt-0.5" /> {PLACES.find((p) => p.id === place)?.label}{ml?.cost ? ` · ${euro(ml.cost)}` : ''}
                          </button>
                        )}
                      </span>
                      <span className="flex gap-1.5 shrink-0">
                        {list.length > 0 && !place && (
                          <IconButton label={`Luogo ${m.label.toLowerCase()} ${dayLabel(d)}`} onClick={() => setMealEdit({ date: di, meal: m.id })}>
                            <MapPin size={15} />
                          </IconButton>
                        )}
                        <IconButton label={`Aggiungi ${m.label.toLowerCase()} ${dayLabel(d)}`} onClick={() => setAdding({ date: di, meal: m.id, done: di <= today })}>
                          <Plus size={16} />
                        </IconButton>
                      </span>
                    </div>
                    {list.map((e) => {
                      const r = (e.recipe_id && rec.byId[e.recipe_id]) || (e.leftover_of && rec.byId[e.leftover_of]);
                      const isItem = !r && String(e.dish_features || '').split(',').includes('alimento');
                      const title = r ? `${e.leftover_of ? 'Avanzo: ' : ''}${r.title}` : `${e.note || 'Piatto'}${isItem && Number(e.servings) > 1 ? ` ×${e.servings}` : ''}`;
                      return (
                        <div key={e.id} className="flex items-center gap-2 py-1">
                          {r ? <Photo id={r.photo_key} className="w-10 h-10 rounded-md shrink-0" /> : isItem ? <Apple size={18} className="text-text-muted shrink-0 mx-2.5" /> : <PenLine size={18} className="text-text-muted shrink-0 mx-2.5" />}
                          <div className="flex-1 min-w-0">
                            {e.recipe_id && r ? (
                              <Link to={`/ricette/${r.id}?porzioni=${e.servings}&piano=${e.id}`} className={`block truncate font-medium ${e.done ? '' : past ? 'text-text-muted' : ''}`}>
                                {title}
                              </Link>
                            ) : (
                              <span className="block truncate">{title}</span>
                            )}
                            <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                              {e.done ? <span className="text-positive">mangiato</span> : past ? <span>non segnato</span> : null}
                              {e.auto && !e.done ? <span className="text-brand">proposta</span> : null}
                              {isItem ? <span className="rounded-full border border-bg-border px-1.5">{itemKindOfCourse(e.dish_course).label}</span> : null}
                              {!e.recipe_id && !e.leftover_of && e.dish_main ? <span>{isItem ? 'conta: ' : ''}{foodLabel(e.dish_main)}</span> : null}
                              {!e.done && status[e.id] && <StatusChip st={status[e.id]} />}
                              {e.done && !isItem && scalesAt(rec.meals[mealId(e.date, e.meal)]?.place) ? (
                                <button type="button" className="text-brand font-semibold" onClick={() => setAddingUsed(e)}>+ ingredienti</button>
                              ) : null}
                            </div>
                          </div>
                          <IconButton
                            label={e.done ? 'Non mangiato' : 'Mangiato'}
                            onClick={() => {
                              const pl = rec.meals[mealId(e.date, e.meal)]?.place || 'casa';
                              if (e.done && e.scaled) return setRestoring({ entry: e, remove: false });
                              if (!e.done && needsCook(e, pl)) return setCooking(e);
                              put('meal_plan', { id: e.id, done: e.done ? 0 : 1, done_at: e.done ? null : today });
                            }}
                          >
                            <Check size={16} className={e.done ? 'text-positive' : ''} />
                          </IconButton>
                          <IconButton
                            label="Togli"
                            onClick={async () => {
                              if (e.scaled) return setRestoring({ entry: e, remove: true });
                              await remove('meal_plan', e.id, 'Tolto dal planner');
                              showToast('Tolto dal planner', { label: 'Annulla', run: () => undo() });
                            }}
                          >
                            <Trash2 size={16} />
                          </IconButton>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>

      {cooking && <CookModal rec={rec} data={data} recipe={(cooking.recipe_id && rec.byId[cooking.recipe_id]) || null} entry={cooking} servings={cooking.servings} onClose={() => setCooking(null)} />}
      {addingUsed && <AddUsedModal rec={rec} data={data} entry={addingUsed} onClose={() => setAddingUsed(null)} />}
      {restoring && <RestoreModal rec={rec} data={data} entry={restoring.entry} remove={restoring.remove} onClose={() => setRestoring(null)} />}
      {adding && <AddDishModal rec={rec} data={data} date={adding.date} meal={adding.meal} done={adding.done} onClose={() => setAdding(null)} />}
      {mealEdit && <MealModal rec={rec} date={mealEdit.date} meal={mealEdit.meal} onClose={() => setMealEdit(null)} />}
      {fill && <FillModal rec={rec} data={data} days={days.map(iso)} meals={meals} onClose={() => setFill(false)} />}
      {review && <NeedsReview needs={review} data={data} onClose={() => setReview(null)} onDone={() => nav('/spesa')} />}
    </div>
  );
}

// Riempi con proposte: giorni e pasti scelti, varieta' rispettata anche tra le proposte.
function FillModal({ rec, data, days, meals, onClose }) {
  const today = iso(new Date());
  const [selDays, setSelDays] = useState(() => new Set(days.filter((d) => d >= today)));
  const [selMeals, setSelMeals] = useState(() => new Set(['pranzo', 'cena']));
  const [onlyEmpty, setOnlyEmpty] = useState(true);
  const [props, setProps] = useState(null);
  const [busy, setBusy] = useState(false);
  const toggle = (set, setter, v) => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    setter(n);
  };
  const slots = days
    .filter((d) => selDays.has(d))
    .flatMap((d) => meals.filter((m) => selMeals.has(m.id)).map((m) => ({ date: d, meal: m.id })))
    .filter((s) => !onlyEmpty || !rec.plan.some((e) => e.date === s.date && e.meal === s.meal));
  const autoCount = rec.plan.filter((e) => e.auto && !e.done && selDays.has(e.date)).length;

  function generate() {
    setBusy(true);
    setTimeout(() => {
      setProps(proposeFor(rec, data, slots));
      setBusy(false);
    }, 10);
  }
  async function confirm() {
    await saveProposals(rec, props);
    showToast(`${props.length} proposte nel planner`, { label: 'Annulla', run: () => undo() });
    onClose();
  }
  async function clearAuto() {
    const n = await removeProposals(rec, [...selDays]);
    showToast(n ? `Tolte ${n} proposte` : 'Nessuna proposta da togliere', n ? { label: 'Annulla', run: () => undo() } : undefined);
  }

  return (
    <Modal
      title="Riempi con proposte"
      onClose={onClose}
      footer={
        props ? (
          <>
            <Button variant="ghost" className="mr-auto" onClick={() => setProps(null)}>Indietro</Button>
            <Button disabled={!props.length} onClick={confirm}>Aggiungi {props.length}</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" className="mr-auto" disabled={!autoCount} onClick={clearAuto}>Togli proposte ({autoCount})</Button>
            <Button disabled={!slots.length || busy} onClick={generate}>{busy ? 'Calcolo…' : `Proponi (${slots.length})`}</Button>
          </>
        )
      }
    >
      {!props ? (
        <div className="space-y-4">
          <Field label="Giorni">
            <div className="flex flex-wrap gap-1.5">
              {days.map((d) => (
                <button key={d} type="button" onClick={() => toggle(selDays, setSelDays, d)} className={`rounded-full border px-3 py-1 text-sm capitalize ${selDays.has(d) ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
                  {dayLabel(d, { weekday: 'short', day: 'numeric' })}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Pasti">
            <div className="flex flex-wrap gap-1.5">
              {meals.map((m) => (
                <button key={m.id} type="button" onClick={() => toggle(selMeals, setSelMeals, m.id)} className={`rounded-full border px-3 py-1 text-sm ${selMeals.has(m.id) ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
                  {m.label}
                </button>
              ))}
            </div>
          </Field>
          <Toggle checked={onlyEmpty} onChange={setOnlyEmpty} label="Solo pasti ancora vuoti" />
          <p className="text-xs text-text-muted">Le proposte seguono l'ordinamento Consigliate (varietà, gradimento, ritardo, scadenze, fattibile) e non si ripetono tra loro. “Togli proposte” elimina quelle non ancora mangiate nei giorni scelti.</p>
        </div>
      ) : props.length === 0 ? (
        <Empty icon={ChefHat}>Nessuna proposta: controlla le ricette escluse (“non propormela”) o le frequenze.</Empty>
      ) : (
        <ul className="divide-y divide-bg-border">
          {props.map((p, i) => (
            <li key={`${p.date}-${p.meal}`} className="py-2 space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
                <span className="capitalize">{dayLabel(p.date, { weekday: 'short', day: 'numeric' })} · {p.meal}</span>
                <IconButton label="Togli questa proposta" className="w-8 h-8" onClick={() => setProps((x) => x.filter((_, j) => j !== i))}><Trash2 size={14} /></IconButton>
              </div>
              <Select
                value={p.r.id}
                aria-label="Cambia ricetta"
                onChange={(e) => {
                  const alt = p.alternatives.find((x) => x.r.id === e.target.value);
                  if (alt) setProps((x) => x.map((y, j) => (j === i ? { ...y, r: alt.r, total: alt.total, reasons: alt.reasons, alternatives: [{ r: p.r, total: p.total, reasons: p.reasons }, ...p.alternatives.filter((a) => a.r.id !== alt.r.id)] } : y)));
                }}
              >
                <option value={p.r.id}>{p.r.title} · {p.total}</option>
                {p.alternatives.map((x) => <option key={x.r.id} value={x.r.id}>{x.r.title} · {x.total}</option>)}
              </Select>
              <div className="text-[11px] text-text-muted truncate">{p.reasons.slice(0, 3).join(' · ')}</div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function NeedsReview({ needs, data, onClose, onDone }) {
  const [sel, setSel] = useState(() => new Set(needs.map((n) => n.product.id)));
  async function confirm() {
    const n = await addNeedsToList(needs.filter((x) => sel.has(x.product.id)), data, 'Lista dal planner');
    showToast(n ? `${n} in lista spesa` : 'Già tutto in lista', n ? { label: 'Annulla', run: () => undo() } : undefined);
    onClose();
    if (n) onDone();
  }
  return (
    <Modal
      title="Manca per la settimana"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button disabled={!sel.size} onClick={confirm}>In lista ({sel.size})</Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">Somma dei pasti da oggi a fine settimana, tolto quello che hai già (e i sostituti disponibili).</p>
      <ul className="divide-y divide-bg-border">
        {needs.map((n) => (
          <li key={n.product.id}>
            <label className="flex items-center gap-3 py-2 text-sm">
              <input
                type="checkbox"
                className="w-5 h-5 accent-[rgb(var(--brand-primary))]"
                checked={sel.has(n.product.id)}
                onChange={(e) =>
                  setSel((s) => {
                    const x = new Set(s);
                    e.target.checked ? x.add(n.product.id) : x.delete(n.product.id);
                    return x;
                  })
                }
              />
              <span className="flex-1 min-w-0">
                <span className="block font-medium">{n.product.name}</span>
                <span className="block text-xs text-text-muted truncate">{n.recipes.join(', ')}</span>
              </span>
              <span className="font-semibold tabular-nums shrink-0">{n.missing ? fmtAmount(n.missing, n.product.default_unit) : '1'}</span>
            </label>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
