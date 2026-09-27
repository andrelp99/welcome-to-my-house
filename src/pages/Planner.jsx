import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { addDays, isSameDay } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, ShoppingCart, Trash2, Check, StickyNote, Search, Leaf, ChefHat } from 'lucide-react';
import { useData, useRecipes, showToast } from '../hooks/useData.js';
import { Button, IconButton, Modal, Stepper, Tabs, Input, Empty } from '../components/ui/kit.jsx';
import { Photo } from '../components/recipes.jsx';
import { StatusChip } from './Ricette.jsx';
import { MEALS, iso, weekStart, weekDays, planNeeds, addNeedsToList, dayLabel } from '../db/planner.js';
import { recipeStatus } from '../db/recipes.js';
import { recipeSeason } from '../db/season.js';
import { fmtQty } from '../db/logic.js';
import { put, remove, undo } from '../db/repo.js';
import { fmtAmount } from '../db/recipes.js';

export default function Planner() {
  const data = useData();
  const rec = useRecipes();
  const nav = useNavigate();
  const [start, setStart] = useState(() => weekStart());
  const [adding, setAdding] = useState(null); // { date, meal }
  const [review, setReview] = useState(null);
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
      if (r) out[e.id] = recipeStatus(rec.ings[r.id] || [], (Number(e.servings) || r.servings) / (r.servings || 1), data, rec.subs);
    }
    return out;
  }, [entries, data, rec]);

  if (!data || !rec) return null;
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
          <p className="text-text-secondary text-sm">Pasti della settimana → lista con solo ciò che manca.</p>
        </div>
        <Button aria-label="Genera lista" onClick={openList} disabled={!upcoming.length}>
          <ShoppingCart size={18} /> <span className="hidden sm:inline">Genera lista</span>
        </Button>
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

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {days.map((d) => {
          const di = iso(d);
          const isToday = isSameDay(d, new Date());
          const past = di < today;
          return (
            <section key={di} ref={isToday ? todayRef : null} className={`min-w-0 rounded-lg border bg-bg-surface p-3 space-y-2 ${isToday ? 'border-brand' : 'border-bg-border'} ${past ? 'opacity-70' : ''}`}>
              <h2 className="font-bold capitalize flex items-center gap-2">
                {dayLabel(d, { weekday: 'long', day: 'numeric' })}
                {isToday && <span className="rounded-full bg-brand text-brand-on px-2 py-0.5 text-[10px] uppercase">oggi</span>}
              </h2>
              {MEALS.map((m) => {
                const list = entries.filter((e) => e.date === di && e.meal === m.id);
                return (
                  <div key={m.id}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs uppercase tracking-wider font-semibold text-text-muted">{m.label}</span>
                      <IconButton label={`Aggiungi ${m.label.toLowerCase()} ${dayLabel(d)}`} onClick={() => setAdding({ date: di, meal: m.id })}>
                        <Plus size={16} />
                      </IconButton>
                    </div>
                    {list.map((e) => {
                      const r = e.recipe_id && rec.byId[e.recipe_id];
                      return (
                        <div key={e.id} className="flex items-center gap-2 py-1">
                          {r ? <Photo id={r.photo_key} className="w-10 h-10 rounded-md shrink-0" /> : <StickyNote size={18} className="text-text-muted shrink-0 mx-2.5" />}
                          <div className="flex-1 min-w-0">
                            {r ? (
                              <Link to={`/ricette/${r.id}?porzioni=${e.servings}&piano=${e.id}`} className={`block truncate font-medium ${e.done ? 'line-through text-text-muted' : ''}`}>
                                {r.title}
                              </Link>
                            ) : (
                              <span className={`block truncate ${e.done ? 'line-through text-text-muted' : ''}`}>{e.note || 'Nota'}</span>
                            )}
                            {r && (
                              <div className="flex items-center gap-2 text-xs text-text-muted">
                                {fmtQty(e.servings)} porz.
                                {!e.done && status[e.id] && <StatusChip st={status[e.id]} />}
                              </div>
                            )}
                          </div>
                          <IconButton label={e.done ? 'Da fare' : 'Fatto'} onClick={() => put('meal_plan', { id: e.id, done: e.done ? 0 : 1 })}>
                            <Check size={16} className={e.done ? 'text-positive' : ''} />
                          </IconButton>
                          <IconButton
                            label="Togli"
                            onClick={async () => {
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

      {adding && <AddMeal slot={adding} data={data} rec={rec} onClose={() => setAdding(null)} />}
      {review && <NeedsReview needs={review} data={data} onClose={() => setReview(null)} onDone={() => nav('/spesa')} />}
    </div>
  );
}

function AddMeal({ slot, data, rec, onClose }) {
  const [tab, setTab] = useState('ok');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [servings, setServings] = useState(1);
  const [note, setNote] = useState('');
  const month = Number(slot.date.slice(5, 7));
  const rows = useMemo(
    () =>
      rec.list.map((r) => ({
        r,
        st: recipeStatus(rec.ings[r.id] || [], 1, data, rec.subs),
        season: recipeSeason(rec.ings[r.id] || [], month).seasonal,
      })),
    [rec, data, month]
  );
  const s = q.trim().toLowerCase();
  const list = rows
    .filter(({ r, st, season }) => (tab === 'ok' ? st.feasible : tab === 'season' ? season : tab === 'fav' ? r.favorite : true))
    .filter(({ r }) => !s || r.title.toLowerCase().includes(s))
    .sort((a, b) => (a.r.last_cooked_at || '').localeCompare(b.r.last_cooked_at || ''));

  async function add(recipe) {
    await put('meal_plan', { date: slot.date, meal: slot.meal, recipe_id: recipe?.id || null, servings: recipe ? servings : 1, note: recipe ? null : note.trim(), done: 0 }, `Planner: ${recipe?.title || note}`);
    onClose();
  }

  return (
    <Modal title={`${slot.meal === 'pranzo' ? 'Pranzo' : 'Cena'} · ${dayLabel(slot.date, { weekday: 'long', day: 'numeric' })}`} onClose={onClose}>
      {pick ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Photo id={pick.photo_key} className="w-16 h-16 rounded-md" />
            <div className="font-semibold">{pick.title}</div>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Porzioni</span>
            <Stepper value={servings} unit="porz." min={1} onChange={(v) => setServings(Math.max(1, v))} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPick(null)}>Indietro</Button>
            <Button onClick={() => add(pick)}>Aggiungi</Button>
          </div>
        </div>
      ) : (
        <>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'ok', label: 'Fattibili' },
              { value: 'season', label: 'Di stagione' },
              { value: 'fav', label: '★' },
              { value: 'all', label: 'Tutte' },
              { value: 'note', label: 'Nota' },
            ]}
          />
          {tab === 'note' ? (
            <div className="space-y-3">
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Es. fuori a cena, pizza, avanzi" autoFocus />
              <div className="flex justify-end">
                <Button disabled={!note.trim()} onClick={() => add(null)}>Aggiungi</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca ricetta…" className="w-full rounded-md bg-bg-elevated border border-bg-border pl-9 pr-3 py-2.5 placeholder:text-text-muted focus:outline-none focus:border-brand" />
              </div>
              {list.length === 0 ? (
                <Empty icon={tab === 'season' ? Leaf : ChefHat}>{tab === 'ok' ? 'Nessuna ricetta fattibile ora: prova “Tutte”.' : 'Nessuna ricetta.'}</Empty>
              ) : (
                <ul className="divide-y divide-bg-border max-h-[50vh] overflow-y-auto">
                  {list.map(({ r, st, season }) => (
                    <li key={r.id}>
                      <button type="button" className="w-full flex items-center gap-3 py-2 text-left" onClick={() => { setPick(r); setServings(r.servings || 1); }}>
                        <Photo id={r.photo_key} className="w-12 h-12 rounded-md shrink-0" />
                        <span className="flex-1 min-w-0">
                          <span className="block truncate font-medium">{r.title}</span>
                          <span className="flex items-center gap-2">
                            <StatusChip st={st} />
                            {season && <Leaf size={14} className="text-positive" aria-label="di stagione" />}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </>
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
