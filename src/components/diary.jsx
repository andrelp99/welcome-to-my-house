import { useMemo, useState } from 'react';
import { Search, Sparkles, Loader2, X, Target, Settings2, Package, Plus } from 'lucide-react';
import { Button, IconButton, Modal, Field, Input, Select, Stepper, Tabs, Toggle, ProductPicker, Empty } from './ui/kit.jsx';
import { Photo } from './recipes.jsx';
import { FoodSelect } from '../pages/TagAI.jsx';
import { apiFetch } from '../api/client.js';
import { showToast } from '../hooks/useData.js';
import { undo, save } from '../db/repo.js';
import { setTotalQty, euro, fmtQty, todayISO, usesOf } from '../db/logic.js';
import { COURSES } from '../db/tags.js';
import { recipeCost } from '../db/insights.js';
import { ITEM_KINDS, ITEM_BY_ID, itemKindOf, MEALS_ALL, PLACES, OUT_PLACES, GOAL_DEFS, ruleLabel, mealId, addDaysIso, weekStartIso, periodContext, evaluate, daysBetween, isoDay } from '../db/variety.js';
import { addDish, addItem, rankRecipes, mealOps, getSetting, saveSetting, goalsOf, weekEval, monthEval, doneDishes } from '../db/meals.js';

// Colori per base (stessi nei due temi, leggibili su scuro e chiaro)
export const BASE_COLOR = { Carboidrati: '#d9a441', Carne: '#e0605a', Pesce: '#4aa3d8', Uova: '#e2c84f', Verdure: '#5fbf7a', Frutta: '#f08bb4', Latticini: '#b9a4f0', Proteine: '#b07a4a' };
export const baseKey = (v) => {
  if (!v) return null;
  if (v === 'Verdure|frutta') return 'Frutta';
  return String(v).split('|')[0];
};
const mealLabel = (id) => MEALS_ALL.find((m) => m.id === id)?.label || id;
const dateLabel = (d, o = { weekday: 'long', day: 'numeric', month: 'short' }) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', o);

// Base dedotta dagli ingredienti principali (prima dell'AI)
function guessBase(products) {
  const out = [];
  for (const p of products) {
    const n = p.name.toLowerCase();
    let v = null;
    if (/fagiol|ceci|lenticch|pisell|fave|legum|lupin|soia/.test(n)) v = 'Proteine|legumi';
    else if (/tofu|seitan|tempeh/.test(n)) v = 'Proteine|tofu e seitan';
    else if (p.category_id === 'cat-pesce') v = /gamber|scamp|astic|aragost|granchi/.test(n) ? 'Pesce|crostacei' : /cozz|vongol|calamar|seppi|polp|totan/.test(n) ? 'Pesce|molluschi' : 'Pesce|pesce';
    else if (p.category_id === 'cat-salumi') v = 'Carne|salumi';
    else if (p.category_id === 'cat-carne') v = /pollo|tacchin|conigli/.test(n) ? 'Carne|bianca' : /maial|salsicc|costin|arista|lonza/.test(n) ? 'Carne|maiale' : 'Carne|rossa';
    else if (p.category_id === 'cat-uova') v = 'Uova';
    else if (p.category_id === 'cat-formaggi' || p.category_id === 'cat-latte') v = /ricott/.test(n) ? 'Latticini|ricotta' : /yogurt/.test(n) ? 'Latticini|yogurt' : 'Latticini|formaggi';
    else if (p.category_id === 'cat-pasta') v = /riso/.test(n) ? 'Carboidrati|riso' : /farro|orzo|cous|quinoa|bulgur/.test(n) ? 'Carboidrati|cereali' : /gnocch/.test(n) ? 'Carboidrati|patate' : 'Carboidrati|pasta';
    else if (p.category_id === 'cat-pane') v = 'Carboidrati|pane e impasti';
    else if (p.category_id === 'cat-verdura') v = /patat/.test(n) ? 'Carboidrati|patate' : /fungh|porcin|champ/.test(n) ? 'Verdure|funghi' : 'Verdure|ortaggi';
    else if (p.category_id === 'cat-frutta') v = 'Verdure|frutta';
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

// Luogo + costo di un pasto
function PlaceCost({ place, cost, onPlace, onCost }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {PLACES.map((p) => (
          <button key={p.id} type="button" onClick={() => onPlace(p.id)} className={`rounded-full border px-3 py-1 text-sm ${place === p.id ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
            {p.label}
          </button>
        ))}
      </div>
      {place !== 'casa' && (
        <Field label="Costo del pasto (facoltativo)" hint="Finisce in Finanze come spesa extra “ristoranti”.">
          <Input inputMode="decimal" value={cost ?? ''} onChange={(e) => onCost(e.target.value)} placeholder="€" />
        </Field>
      )}
    </div>
  );
}
const numOrNull = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')) || null);

// ── Aggiungi piatto (planner e "Cosa ho mangiato?") ──
export function AddDishModal({ rec, data, date, meal: meal0, done, onClose }) {
  const extra = !!getSetting(rec, 'planner', {})?.extraMeals;
  const [meal, setMeal] = useState(meal0);
  const cur = rec.meals[mealId(date, meal)];
  const [place, setPlace] = useState(cur?.place || 'casa');
  const [cost, setCost] = useState(cur?.cost ?? '');
  const [tab, setTab] = useState(meal0 === 'colazione' || meal0 === 'merenda' ? 'alimento' : 'ricette');
  const [item, setItem] = useState({ kind: 'frutta', product: null, name: '', main: undefined, n: 1, scala: true, qty: '' });
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [servings, setServings] = useState(1);
  const [hand, setHand] = useState({ note: '', dish_course: '', ings: [], main: null, second: null, fritto: false });
  const [busy, setBusy] = useState(false);
  const ranked = useMemo(() => rankRecipes(rec, data, { today: date }), [rec, data, date]);
  const s = q.trim().toLowerCase();
  const list = ranked.filter((x) => !s || x.r.title.toLowerCase().includes(s)).slice(0, s ? 30 : 15);
  const leftovers = data.lots.filter((l) => l.is_leftover && data.products[l.product_id]).map((l) => ({ lot: l, p: data.products[l.product_id], rid: l.product_id.replace(/^p-avanzo-/, '') }));
  const handSugg = hand.note.trim().length >= 3 ? ranked.filter((x) => x.r.title.toLowerCase().includes(hand.note.trim().toLowerCase())).slice(0, 4) : [];
  const setH = (k) => (v) => setHand((h) => ({ ...h, [k]: v }));

  async function commit(dish, keepOpen) {
    setBusy(true);
    const c = place !== 'casa' ? numOrNull(cost) : null;
    await addDish({ rec, date, meal, dish, servings, done, place, cost: place !== 'casa' || cur?.cost ? c : undefined });
    showToast(`${mealLabel(meal)}: aggiunto`, { label: 'Annulla', run: () => undo() });
    setBusy(false);
    if (keepOpen) {
      setPick(null);
      setHand({ note: '', dish_course: '', ings: [], main: null, second: null, fritto: false });
    } else onClose();
  }
  // quantita' da scalare per n porzioni, nell'unita' del prodotto
  const itemQty = (p, n) => {
    if (!p) return 0;
    const u = usesOf(p);
    const per = u ? 1 / u : ['g', 'ml'].includes(p.default_unit) ? (p.default_unit === 'g' ? 100 : 125) : ['kg', 'l'].includes(p.default_unit) ? 0.1 : 1;
    return Math.round(per * n * 1000) / 1000;
  };
  const itemStock = item.product ? data.stock[item.product.id] || 0 : 0;
  async function commitItem(keepOpen) {
    setBusy(true);
    const c = place !== 'casa' ? numOrNull(cost) : null;
    const used = item.product && item.scala && itemStock > 0 ? Math.min(itemStock, numOrNull(item.qty) ?? itemQty(item.product, item.n)) : 0;
    await addItem({ rec, data, date, meal, kind: item.kind, name: item.name.trim(), product: item.product, main: item.main, usedQty: used, n: item.n, done, place, cost: place !== 'casa' || cur?.cost ? c : undefined });
    showToast(`${mealLabel(meal)}: ${item.name.trim()}${used ? ' (scalato dalla dispensa)' : ''}`, { label: 'Annulla', run: () => undo() });
    setBusy(false);
    if (keepOpen) setItem((it) => ({ ...it, product: null, name: '', main: undefined, n: 1, qty: '' }));
    else onClose();
  }
  const pickItem = (p) => setItem((it) => ({ ...it, product: p, name: p.name, kind: itemKindOf(p), main: undefined, qty: '' }));
  const itemKind = ITEM_BY_ID[item.kind];
  const itemMain = item.main !== undefined ? item.main : item.kind === 'altro' || item.kind === 'verdura' || item.kind === 'latticini' ? (item.product ? guessBase([item.product])[0] : null) ?? itemKind.main : itemKind.main;

  async function eatLeftover(x, keepOpen) {
    await setTotalQty(x.p, Math.max(0, (data.stock[x.p.id] || 0) - 1), data);
    await commit({ leftover_of: rec.byId[x.rid] ? x.rid : null, note: rec.byId[x.rid] ? null : x.p.name }, keepOpen);
  }
  async function aiBase() {
    setBusy(true);
    try {
      const res = await apiFetch('/api/ai/classify', { method: 'POST', body: JSON.stringify({ items: [{ title: hand.note.trim(), course: hand.dish_course, ingredients: hand.ings.map((p) => p.name) }] }) });
      const x = res.items[0] || {};
      setHand((h) => ({ ...h, main: x.main || h.main, second: x.second || h.second, dish_course: h.dish_course || x.course || '', fritto: h.fritto || (x.features || []).includes('fritto') }));
    } catch (e) {
      showToast(`AI non disponibile: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }
  function handDish() {
    const guess = guessBase(hand.ings);
    const main = hand.main || guess[0] || null;
    const second = hand.second || guess.find((g) => g !== main) || null;
    return { note: hand.note.trim(), dish_course: hand.dish_course || null, dish_main: main, dish_second: second, dish_features: hand.fritto ? 'fritto' : null, dish_ings: hand.ings.map((p) => p.id).join(',') || null };
  }
  const guess = guessBase(hand.ings);

  return (
    <Modal title={`${done ? 'Cosa ho mangiato' : 'Aggiungi piatto'} · ${dateLabel(date, { weekday: 'short', day: 'numeric', month: 'short' })}`} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pasto">
          <Select value={meal} onChange={(e) => setMeal(e.target.value)}>
            {MEALS_ALL.filter((m) => extra || !m.extra || m.id === meal).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
        {tab !== 'alimento' && (
          <Field label="Porzioni">
            <Stepper value={servings} unit="porz." min={1} onChange={(v) => setServings(Math.max(1, v))} />
          </Field>
        )}
      </div>
      <PlaceCost place={place} cost={cost} onPlace={setPlace} onCost={setCost} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'ricette', label: 'Ricettario' },
          { value: 'alimento', label: 'Alimento' },
          { value: 'mano', label: 'Scritto a mano' },
          { value: 'avanzi', label: 'Avanzi', count: leftovers.length || undefined },
        ]}
      />
      {tab === 'ricette' &&
        (pick ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Photo id={pick.photo_key} className="w-14 h-14 rounded-md" />
              <div className="font-semibold flex-1">{pick.title}</div>
              <Button variant="text" onClick={() => setPick(null)}>cambia</Button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => commit({ recipe_id: pick.id }, true)}><Plus size={16} /> Aggiungi e continua</Button>
              <Button disabled={busy} onClick={() => commit({ recipe_id: pick.id })}>Aggiungi</Button>
            </div>
          </div>
        ) : (
          <>
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca ricetta (in ordine: consigliate)…" className="w-full rounded-md bg-bg-elevated border border-bg-border pl-9 pr-3 py-2.5 placeholder:text-text-muted focus:outline-none focus:border-brand" />
            </div>
            <ul className="divide-y divide-bg-border max-h-[40vh] overflow-y-auto">
              {list.map((x) => (
                <li key={x.r.id}>
                  <button type="button" className="w-full flex items-center gap-3 py-2 text-left" onClick={() => setPick(x.r)}>
                    <Photo id={x.r.photo_key} className="w-11 h-11 rounded-md shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{x.r.title}</span>
                      <span className="block truncate text-xs text-text-muted">{x.total >= 0 ? `${x.total} · ${x.reasons.slice(0, 2).join(' · ')}` : `esclusa: ${x.excluded}`}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ))}
      {tab === 'alimento' && (
        <div className="space-y-3">
          <p className="text-xs text-text-muted">Frutta, verdura, dolci, snack… come parte del pasto. Conta negli obiettivi della sua categoria.</p>
          <div className="flex flex-wrap gap-1.5">
            {ITEM_KINDS.map((k) => (
              <button key={k.id} type="button" onClick={() => setItem((it) => ({ ...it, kind: k.id, main: undefined }))} className={`rounded-full border px-3 py-1 text-sm ${item.kind === k.id ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
                {k.label}
              </button>
            ))}
          </div>
          {item.name ? (
            <div className="flex items-center gap-2 rounded-md border border-bg-border bg-bg-elevated px-3 py-2">
              <span className="flex-1 min-w-0 truncate font-semibold">{item.name}</span>
              <span className="text-xs text-text-muted">{item.product ? `in dispensa: ${fmtQty(itemStock)} ${item.product.default_unit}` : 'non in dispensa'}</span>
              <Button variant="text" onClick={() => setItem((it) => ({ ...it, product: null, name: '', main: undefined }))}>cambia</Button>
            </div>
          ) : (
            <ProductPicker products={data.products} area="cibo" prefer={itemKind.cat || undefined} onPick={pickItem} onCreate={(name) => setItem((it) => ({ ...it, product: null, name }))} placeholder="Cerca o scrivi (es. mela, yogurt, cioccolato)…" />
          )}
          {item.name && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Quanti">
                  <Stepper value={item.n} unit="porz." min={1} onChange={(v) => setItem((it) => ({ ...it, n: Math.max(1, v), qty: '' }))} />
                </Field>
                <Field label="Conta come">
                  <FoodSelect value={itemMain} onChange={(v) => setItem((it) => ({ ...it, main: v }))} placeholder="nessun obiettivo" aria-label="Conta come" />
                </Field>
              </div>
              {item.product && itemStock > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <Toggle checked={item.scala} onChange={(v) => setItem((it) => ({ ...it, scala: v }))} label="Scala dalla dispensa" />
                  {item.scala && (
                    <span className="inline-flex items-center gap-1 text-sm">
                      <input className="w-20 rounded-md bg-bg-elevated border border-bg-border px-2 py-1.5 focus:outline-none focus:border-brand" inputMode="decimal" value={item.qty} placeholder={String(itemQty(item.product, item.n))} onChange={(e) => setItem((it) => ({ ...it, qty: e.target.value }))} aria-label="Quantità da scalare" />
                      {item.product.default_unit}
                    </span>
                  )}
                </div>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => commitItem(true)}><Plus size={16} /> Aggiungi e continua</Button>
                <Button disabled={busy} onClick={() => commitItem()}>Aggiungi</Button>
              </div>
            </>
          )}
        </div>
      )}
      {tab === 'avanzi' &&
        (leftovers.length === 0 ? (
          <Empty icon={Package}>Nessun avanzo in dispensa.</Empty>
        ) : (
          <ul className="divide-y divide-bg-border">
            {leftovers.map((x) => (
              <li key={x.lot.id} className="flex items-center gap-3 py-2">
                <span className="flex-1 min-w-0 truncate">{x.p.name.replace(/^Avanzo: /, '')} <span className="text-xs text-text-muted">· {fmtQty(x.lot.qty)} porz.</span></span>
                <Button variant="ghost" disabled={busy} onClick={() => eatLeftover(x)}>Mangiato 1</Button>
              </li>
            ))}
          </ul>
        ))}
      {tab === 'mano' && (
        <div className="space-y-3">
          <Field label="Cosa hai mangiato">
            <Input value={hand.note} onChange={(e) => setH('note')(e.target.value)} placeholder="es. carbonara, sushi, piadina" autoFocus />
          </Field>
          {handSugg.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs text-text-muted">Dal tuo ricettario:</div>
              <div className="flex flex-wrap gap-1.5">
                {handSugg.map((x) => (
                  <button key={x.r.id} type="button" className="rounded-full border border-brand/60 text-brand px-3 py-1 text-sm" onClick={() => { setTab('ricette'); setPick(x.r); }}>
                    {x.r.title}
                  </button>
                ))}
              </div>
            </div>
          )}
          <Field label="Portata">
            <Select value={hand.dish_course} onChange={(e) => setH('dish_course')(e.target.value)}>
              <option value="">—</option>
              {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label={`Ingredienti principali (${hand.ings.length}/3)`}>
            <div className="flex flex-wrap gap-1.5">
              {hand.ings.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-brand/15 border border-brand/50 px-3 py-1 text-sm">
                  {p.name}
                  <button type="button" aria-label={`Togli ${p.name}`} onClick={() => setH('ings')(hand.ings.filter((x) => x.id !== p.id))}><X size={14} /></button>
                </span>
              ))}
            </div>
            {hand.ings.length < 3 && <ProductPicker products={data.products} area="cibo" onPick={(p) => !hand.ings.some((x) => x.id === p.id) && setH('ings')([...hand.ings, p])} placeholder="Cerca in dispensa…" />}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <FoodSelect value={hand.main || guess[0] || null} onChange={setH('main')} placeholder="Base —" aria-label="Base principale" />
            <FoodSelect value={hand.second || guess.find((g) => g !== (hand.main || guess[0])) || null} onChange={setH('second')} placeholder="Secondaria —" aria-label="Base secondaria" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Toggle checked={hand.fritto} onChange={setH('fritto')} label="fritto" />
            <Button variant="ghost" disabled={busy || !hand.note.trim()} onClick={aiBase}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Base con AI
            </Button>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" disabled={busy || !hand.note.trim()} onClick={() => commit(handDish(), true)}><Plus size={16} /> Aggiungi e continua</Button>
            <Button disabled={busy || !hand.note.trim()} onClick={() => commit(handDish())}>Aggiungi</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// Luogo e costo di un pasto gia' registrato
export function MealModal({ rec, date, meal, onClose }) {
  const cur = rec.meals[mealId(date, meal)];
  const [place, setPlace] = useState(cur?.place || 'casa');
  const [cost, setCost] = useState(cur?.cost ?? '');
  async function ok() {
    await save(mealOps(date, meal, { place, cost: place !== 'casa' ? numOrNull(cost) : null }, rec), `${mealLabel(meal)} ${dateLabel(date, { day: 'numeric', month: 'short' })}: ${PLACES.find((p) => p.id === place)?.label}`);
    onClose();
  }
  return (
    <Modal title={`${mealLabel(meal)} · ${dateLabel(date)}`} onClose={onClose} footer={<><Button variant="ghost" onClick={onClose}>Annulla</Button><Button onClick={ok}>Salva</Button></>}>
      <PlaceCost place={place} cost={cost} onPlace={setPlace} onCost={setCost} />
    </Modal>
  );
}

// ── Obiettivi: modifica ──
export function GoalsEditor({ rec, onClose }) {
  const [cfg, setCfg] = useState(() => Object.fromEntries(goalsOf(rec).map((g) => [g.id, { on: g.on, min: g.min ?? '', max: g.max ?? '' }])));
  const set = (id, k, v) => setCfg((c) => ({ ...c, [id]: { ...c[id], [k]: v } }));
  async function ok() {
    await saveSetting('goals', cfg, 'Obiettivi di varietà');
    showToast('Obiettivi salvati', { label: 'Annulla', run: () => undo() });
    onClose();
  }
  const groups = [...new Set(GOAL_DEFS.map((g) => `${g.period === 'week' ? 'Settimana' : 'Mese'} · ${g.group}`))];
  return (
    <Modal
      title="Obiettivi di varietà"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => setCfg(Object.fromEntries(GOAL_DEFS.map((g) => [g.id, { on: true, min: g.min ?? '', max: g.max ?? '' }])))}>Ripristina</Button>
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button onClick={ok}>Salva</Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">Minimo e/o massimo per settimana (o mese). Vuoto = nessun limite da quel lato.</p>
      {groups.map((gr) => (
        <div key={gr} className="space-y-1.5">
          <div className="text-xs uppercase tracking-wider font-semibold text-text-muted">{gr}</div>
          {GOAL_DEFS.filter((g) => `${g.period === 'week' ? 'Settimana' : 'Mese'} · ${g.group}` === gr).map((g) => (
            <div key={g.id} className={`grid grid-cols-[1fr_4rem_4rem] items-center gap-2 ${cfg[g.id].on ? '' : 'opacity-50'}`}>
              <Toggle checked={!!cfg[g.id].on} onChange={(v) => set(g.id, 'on', v)} label={`${g.label}${g.unit ? ` (${g.unit})` : ''}`} />
              <Input inputMode="numeric" aria-label={`${g.label} minimo`} placeholder="min" value={cfg[g.id].min} onChange={(e) => set(g.id, 'min', e.target.value)} />
              <Input inputMode="numeric" aria-label={`${g.label} massimo`} placeholder="max" value={cfg[g.id].max} onChange={(e) => set(g.id, 'max', e.target.value)} />
            </div>
          ))}
        </div>
      ))}
    </Modal>
  );
}

// ── Mini dashboard (settimana / mese) ──
function Ring({ pct }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const col = pct >= 70 ? 'rgb(var(--color-positive))' : pct >= 45 ? 'rgb(var(--color-warning))' : 'rgb(var(--color-negative))';
  return (
    <svg viewBox="0 0 64 64" className="w-16 h-16 shrink-0" role="img" aria-label={`Varietà ${pct} su 100`}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="rgb(var(--bg-elevated))" strokeWidth="7" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(c * pct) / 100} ${c}`} transform="rotate(-90 32 32)" />
      <text x="32" y="38" textAnchor="middle" fontSize="17" fontWeight="700" fill="rgb(var(--text-primary))">{pct}</text>
    </svg>
  );
}
const PILL = { ok: 'bg-positive/15 text-positive', todo: 'bg-warning/15 text-warning', over: 'bg-negative/15 text-negative', limit: 'bg-negative/15 text-negative' };
function GoalBar({ g, onClick }) {
  const lim = g.max ?? g.min ?? 1;
  const top = Math.max(lim * 1.4, g.have, 1);
  const col = g.status === 'ok' ? 'bg-positive' : g.status === 'todo' ? 'bg-warning' : 'bg-negative';
  const label = g.status === 'todo' ? `mancano ${g.missing}` : g.status === 'over' ? 'oltre' : g.status === 'limit' ? 'limite' : 'ok';
  return (
    <button type="button" onClick={onClick} className="block w-full text-left space-y-1" disabled={!onClick}>
      <div className="flex justify-between gap-2 text-sm">
        <span className="font-medium truncate">{g.label}</span>
        <span className="shrink-0 tabular-nums">
          {g.have} <span className="text-text-muted text-xs">{ruleLabel(g)}</span>{' '}
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${PILL[g.status]}`}>{label}</span>
        </span>
      </div>
      <div className="relative h-2 rounded-full bg-bg-elevated overflow-hidden">
        <div className={`absolute inset-y-0 left-0 rounded-full ${col}`} style={{ width: `${(g.have / top) * 100}%` }} />
        {[g.min, g.max].filter((x) => x != null).map((x, i) => (
          <div key={i} className="absolute -top-0.5 -bottom-0.5 w-0.5 bg-text-primary/60" style={{ left: `calc(${(x / top) * 100}% - 1px)` }} />
        ))}
      </div>
    </button>
  );
}

// Striscia: 8 caselle al giorno (colazione, pranzo ×3, merenda, cena ×3)
function DayStrip({ rec, from, today, dishes }) {
  const days = Array.from({ length: 7 }, (_, i) => addDaysIso(from, i));
  const cell = (d, k) => {
    if (!d) return <div key={k} className="h-2.5 rounded-sm bg-bg-elevated" />;
    const b = baseKey(d.main) || baseKey(d.second);
    const out = OUT_PLACES.includes(rec.meals[mealId(d.date, d.meal)]?.place);
    return <div key={k} title={`${d.title} · ${d.meal}`} className="h-2.5 rounded-sm" style={{ background: b ? BASE_COLOR[b] : 'rgb(var(--text-muted))', outline: out ? '1.5px dashed rgb(var(--text-primary))' : 'none', outlineOffset: -2 }} />;
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-7 gap-1">
        {days.map((day) => {
          const ds = dishes.filter((d) => d.date === day);
          const by = (m, n) => {
            const arr = ds.filter((d) => d.meal === m);
            return Array.from({ length: n }, (_, i) => arr[i] || null);
          };
          const col = by('colazione', 1).concat([null], by('pranzo', 3), [null], by('merenda', 1), [null], by('cena', 3));
          return (
            <div key={day} className="grid gap-0.5 justify-items-stretch">
              <b className={`text-center text-[11px] ${day === today ? 'text-brand' : 'text-text-muted'}`}>{dateLabel(day, { weekday: 'narrow' })}</b>
              {col.map((d, i) => ([1, 5, 7].includes(i) ? <div key={i} className="h-0.5" /> : cell(d, i)))}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
        {Object.entries(BASE_COLOR).map(([k, c]) => (
          <span key={k} className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{k.toLowerCase()}</span>
        ))}
        <span className="inline-flex items-center gap-1"><i className="inline-block w-2.5 h-2.5 rounded-sm" style={{ outline: '1.5px dashed rgb(var(--text-primary))', outlineOffset: -2 }} />fuori</span>
      </div>
    </div>
  );
}

export function VarietyDashboard({ rec, data, weekFrom, onGoal }) {
  const [view, setView] = useState('week');
  const [edit, setEdit] = useState(false);
  const today = todayISO();
  const dishes = useMemo(() => doneDishes(rec), [rec]);
  const ref = weekFrom <= today && today <= addDaysIso(weekFrom, 6) ? today : addDaysIso(weekFrom, 6);
  const wk = useMemo(() => weekEval(rec, ref, dishes), [rec, ref, dishes]);
  const mo = useMemo(() => monthEval(rec, ref, dishes), [rec, ref, dishes]);
  const monthWeeks = useMemo(() => {
    // settimane del mese: ogni obiettivo settimanale rispettato o no
    const first = weekStartIso(mo.ctx.from);
    const out = [];
    for (let w = first; w <= mo.ctx.to; w = addDaysIso(w, 7)) {
      const ctx = periodContext({ all: dishes, mealsById: rec.meals, events: rec.events, recipesById: rec.byId, from: w, to: addDaysIso(w, 6) });
      const ev = evaluate(goalsOf(rec).filter((g) => g.period === 'week'), ctx, addDaysIso(w, 6) < today ? addDaysIso(w, 6) : today);
      out.push({ w, future: w > today, running: w <= today && today <= addDaysIso(w, 6), rows: Object.fromEntries(ev.rows.map((r) => [r.id, r.status])) });
    }
    return out;
  }, [mo, dishes, rec, today]);
  const ev = view === 'week' ? wk : mo;
  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="font-bold flex items-center gap-2"><Target size={18} className="text-brand" /> Varietà</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full bg-bg-elevated p-0.5" role="group" aria-label="Periodo">
            {[['week', 'Settimana'], ['month', 'Mese']].map(([v, l]) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`rounded-full px-3 py-1 text-sm font-semibold ${view === v ? 'bg-brand text-brand-on' : 'text-text-secondary'}`}>{l}</button>
            ))}
          </div>
          <IconButton label="Modifica obiettivi" onClick={() => setEdit(true)}><Settings2 size={16} /></IconButton>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Ring pct={ev.score} />
        <div>
          <div className="font-bold">Varietà {ev.score}/100</div>
          <div className="text-xs text-text-muted">
            {ev.okCount} obiettivi ok su {ev.rows.length}
            {view === 'week' && ref === today ? ` · ${daysBetween(today, addDaysIso(weekFrom, 6))} giorni alla fine` : ''}
          </div>
        </div>
      </div>
      {view === 'week' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {wk.rows.map((g) => <GoalBar key={g.id} g={g} onClick={g.status === 'todo' && g.match && onGoal ? () => onGoal(g) : null} />)}
          </div>
          <DayStrip rec={rec} from={weekFrom} today={today} dishes={dishes.filter((d) => d.date >= weekFrom && d.date <= addDaysIso(weekFrom, 6))} />
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">{mo.rows.map((g) => <GoalBar key={g.id} g={g} />)}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-text-muted text-xs">
                  <th className="text-left font-semibold py-1">{new Date(`${mo.ctx.from}T12:00:00`).toLocaleDateString('it-IT', { month: 'long' })}</th>
                  {monthWeeks.map((w) => <th key={w.w} className="font-semibold">{dateLabel(w.w, { day: 'numeric', month: 'numeric' })}</th>)}
                </tr>
              </thead>
              <tbody>
                {wk.rows.map((g) => (
                  <tr key={g.id} className="border-t border-bg-border">
                    <td className="py-1 pr-2 truncate">{g.label} <span className="text-text-muted text-xs">{ruleLabel(g)}</span></td>
                    {monthWeeks.map((w) => {
                      const s = w.rows[g.id];
                      return (
                        <td key={w.w} className="text-center">
                          <span className={`inline-block w-3 h-3 rounded-full ${w.future || !s ? 'border border-dashed border-bg-border' : s === 'ok' || s === 'limit' ? 'bg-positive' : w.running && s === 'todo' ? 'bg-warning' : 'bg-negative'}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {edit && <GoalsEditor rec={rec} onClose={() => setEdit(false)} />}
    </section>
  );
}

// ── Analisi (sotto la dashboard) ──
const W = 300;
function LineMini({ points, max, target, color = 'rgb(var(--brand-primary))', fmt = (v) => v }) {
  const h = 110, px = 28, py = 10, iw = W - px - 8, ih = h - py - 20;
  const vals = points.map((p) => p.v);
  const top = max ?? Math.max(1, ...vals.filter((v) => v != null)) * 1.15;
  const x = (i) => px + (points.length > 1 ? (iw * i) / (points.length - 1) : iw / 2);
  const y = (v) => py + ih - (ih * v) / top;
  const pts = points.map((p, i) => (p.v == null ? null : [x(i), y(p.v)])).filter(Boolean);
  if (!pts.length) return <p className="text-sm text-text-muted">Pochi dati per ora.</p>;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full h-auto" role="img">
      {[0, top / 2, top].map((g, i) => (
        <g key={i}>
          <line x1={px} x2={W - 8} y1={y(g)} y2={y(g)} stroke="rgb(var(--bg-border))" />
          <text x={px - 4} y={y(g) + 3} textAnchor="end" fontSize="9" fill="rgb(var(--text-muted))">{fmt(Math.round(g * 10) / 10)}</text>
        </g>
      ))}
      {target != null && <line x1={px} x2={W - 8} y1={y(target)} y2={y(target)} stroke="rgb(var(--color-positive))" strokeDasharray="4 3" />}
      <path d={`${path} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`} fill={color} fillOpacity="0.14" />
      <path d={path} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="3.5" fill={color} />
      {points.map((p, i) => (i % 2 === points.length % 2 || i === points.length - 1 ? <text key={i} x={x(i)} y={h - 4} textAnchor="middle" fontSize="9" fill="rgb(var(--text-muted))">{p.label}</text> : null))}
    </svg>
  );
}
function StackMini({ cols, series }) {
  const h = 120, px = 6, iw = W - 12, ih = 82, n = cols.length, bw = iw / n - 8;
  const max = Math.max(1, ...cols.map((_, i) => series.reduce((s, x) => s + x.values[i], 0)));
  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full h-auto" role="img">
      {cols.map((c, i) => {
        let acc = 0;
        return (
          <g key={i}>
            {series.map((s, k) => {
              const hh = (ih * s.values[i]) / max;
              acc += hh;
              return hh ? <rect key={k} x={px + i * (iw / n) + 4} y={6 + ih - acc} width={bw} height={hh} rx="2" fill={s.color} /> : null;
            })}
            <text x={px + i * (iw / n) + 4 + bw / 2} y={h - 22} textAnchor="middle" fontSize="9" fill="rgb(var(--text-muted))">{c}</text>
          </g>
        );
      })}
      {series.map((s, k) => (
        <g key={k}>
          <rect x={px + k * 80} y={h - 11} width="9" height="9" rx="2" fill={s.color} />
          <text x={px + k * 80 + 13} y={h - 3} fontSize="9" fill="rgb(var(--text-muted))">{s.name}</text>
        </g>
      ))}
    </svg>
  );
}
function Donut({ parts }) {
  const tot = parts.reduce((s, p) => s + p.v, 0);
  if (!tot) return <p className="text-sm text-text-muted">Nessun piatto registrato nel mese.</p>;
  let a = -Math.PI / 2;
  const r = 40, cx = 55, cy = 55;
  return (
    <svg viewBox={`0 0 ${W} 115`} className="w-full h-auto" role="img">
      {parts.map((p) => {
        const b = a + (2 * Math.PI * p.v) / tot;
        const large = b - a > Math.PI ? 1 : 0;
        const d = p.v === tot ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r}` : `M ${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(b)} ${cy + r * Math.sin(b)}`;
        a = b;
        return <path key={p.k} d={d} fill="none" stroke={p.c} strokeWidth="16" />;
      })}
      <text x={cx} y={cy + 1} textAnchor="middle" fontSize="15" fontWeight="700" fill="rgb(var(--text-primary))">{tot}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize="9" fill="rgb(var(--text-muted))">piatti</text>
      {parts.map((p, i) => (
        <g key={p.k}>
          <rect x="122" y={8 + i * 14} width="9" height="9" rx="2" fill={p.c} />
          <text x="136" y={16 + i * 14} fontSize="10" fill="rgb(var(--text-secondary))">{p.k} {Math.round((p.v / tot) * 100)}%</text>
        </g>
      ))}
    </svg>
  );
}
function Box({ n, title, sub, children }) {
  return (
    <article className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-2 min-w-0">
      <h3 className="font-bold text-sm"><span className="text-brand tabular-nums mr-1.5">{String(n).padStart(2, '0')}</span>{title}</h3>
      {sub && <p className="text-xs text-text-muted">{sub}</p>}
      {children}
    </article>
  );
}

export function Analyses({ rec, data }) {
  const today = todayISO();
  const dishes = useMemo(() => doneDishes(rec), [rec]);
  const a = useMemo(() => {
    const thisWeek = weekStartIso(today);
    const weeks = Array.from({ length: 8 }, (_, i) => addDaysIso(thisWeek, -7 * (7 - i)));
    const wlabel = (w) => dateLabel(w, { day: 'numeric', month: 'numeric' });
    const goals = goalsOf(rec).filter((g) => g.period === 'week');
    const inW = (w) => dishes.filter((d) => d.date >= w && d.date <= addDaysIso(w, 6));
    const trend = weeks.map((w) => {
      const ds = inW(w);
      if (!ds.length) return { label: wlabel(w), v: null };
      const ctx = periodContext({ all: dishes, mealsById: rec.meals, events: rec.events, recipesById: rec.byId, from: w, to: addDaysIso(w, 6) });
      return { label: wlabel(w), v: evaluate(goals, ctx, w === thisWeek ? today : addDaysIso(w, 6)).score };
    });
    // basi del mese
    const m0 = `${today.slice(0, 7)}-01`;
    const md = dishes.filter((d) => d.date >= m0 && d.date <= today);
    const cnt = {};
    for (const d of md) for (const v of [d.main, d.second]) if (baseKey(v)) cnt[baseKey(v)] = (cnt[baseKey(v)] || 0) + 1;
    const basi = Object.entries(cnt).sort((x, y) => y[1] - x[1]).map(([k, v]) => ({ k, v, c: BASE_COLOR[k] }));
    // calendario del mese: pranzo e cena
    const monthDays = [];
    const last = isoDay(new Date(new Date(`${m0}T12:00:00`).getFullYear(), new Date(`${m0}T12:00:00`).getMonth() + 1, 0));
    for (let x = m0; x <= last; x = addDaysIso(x, 1)) monthDays.push(x);
    // casa / fuori / delivery (ultime 6 settimane)
    const w6 = weeks.slice(2);
    const placeOf = (d) => rec.meals[mealId(d.date, d.meal)]?.place || 'casa';
    const mealsIn = (w) => {
      const seen = new Map();
      for (const d of inW(w)) seen.set(`${d.date}|${d.meal}`, placeOf(d));
      return [...seen.values()];
    };
    const places = { cols: w6.map(wlabel), series: [
      { name: 'casa', color: 'rgb(var(--color-positive))', values: w6.map((w) => mealsIn(w).filter((p) => p === 'casa' || p === 'lavoro').length) },
      { name: 'fuori', color: 'rgb(var(--color-warning))', values: w6.map((w) => mealsIn(w).filter((p) => p === 'ristorante' || p === 'amici').length) },
      { name: 'delivery', color: 'rgb(var(--color-negative))', values: w6.map((w) => mealsIn(w).filter((p) => p === 'delivery').length) },
    ] };
    // costo: casa per porzione (ricette), fuori per pasto
    const homeCost = weeks.map((w) => {
      const cs = inW(w).filter((d) => d.recipe_id && !d.leftover && placeOf(d) === 'casa').map((d) => recipeCost(rec.ings[d.recipe_id] || [], 1 / (rec.byId[d.recipe_id]?.servings || 1), data)).filter((c) => c.known);
      return { label: wlabel(w), v: cs.length ? cs.reduce((s, c) => s + c.total, 0) / cs.length : null };
    });
    const outMeals = Object.values(rec.meals).filter((m) => OUT_PLACES.includes(m.place) && m.cost > 0 && m.date >= addDaysIso(today, -90));
    const outAvg = outMeals.length ? outMeals.reduce((s, m) => s + m.cost, 0) / outMeals.length : null;
    const homeVals = homeCost.filter((x) => x.v != null);
    // gradimento
    const grad = weeks.map((w) => {
      const rs = inW(w).filter((d) => d.rating);
      return { label: wlabel(w), v: rs.length ? rs.reduce((s, d) => s + d.rating, 0) / rs.length : null };
    });
    // tempo in cucina
    const tbucket = (r) => {
      const t = (Number(r.prep_min) || 0) + (Number(r.cook_min) || 0) + (Number(r.rest_min) || 0);
      return t <= 30 ? 0 : t <= 60 ? 1 : 2;
    };
    const cookMin = (w, b) => inW(w).filter((d) => d.recipe_id && !d.leftover && placeOf(d) === 'casa' && rec.byId[d.recipe_id] && tbucket(rec.byId[d.recipe_id]) === b).reduce((s, d) => s + (Number(rec.byId[d.recipe_id].prep_min) || 0) + (Number(rec.byId[d.recipe_id].cook_min) || 0), 0);
    const tempo = { cols: w6.map(wlabel), series: [
      { name: 'breve', color: 'rgb(var(--color-positive))', values: w6.map((w) => cookMin(w, 0)) },
      { name: 'medio', color: 'rgb(var(--color-warning))', values: w6.map((w) => cookMin(w, 1)) },
      { name: 'lungo', color: 'rgb(var(--color-negative))', values: w6.map((w) => cookMin(w, 2)) },
    ] };
    // serie
    const dayHas = (day, f) => dishes.some((d) => d.date === day && f(d));
    const isVegD = (d) => ['Verdure|ortaggi', 'Verdure|funghi', 'Verdure'].some((k) => d.main === k || d.second === k) || d.course === 'Contorno';
    const streak = (f) => {
      let n = 0;
      let x = dayHas(today, f) ? today : addDaysIso(today, -1);
      while (dayHas(x, f)) {
        n++;
        x = addDaysIso(x, -1);
      }
      return n;
    };
    const record = (f) => {
      const days = [...new Set(dishes.filter(f).map((d) => d.date))].sort();
      let best = 0, cur = 0, prev = null;
      for (const d of days) {
        cur = prev && addDaysIso(prev, 1) === d ? cur + 1 : 1;
        best = Math.max(best, cur);
        prev = d;
      }
      return best;
    };
    const fish = goals.find((g) => g.id === 'pesce');
    let fishWeeks = 0;
    for (let w = addDaysIso(thisWeek, -7); fish; w = addDaysIso(w, -7)) {
      if (inW(w).filter(fish.match).length >= (fish.min || 1)) fishWeeks++;
      else break;
      if (fishWeeks > 52) break;
    }
    // anti-spreco (mese)
    const ev = rec.events.filter((e) => e.date >= m0);
    const spreco = [
      { k: 'Ricette con cose in scadenza', v: md.filter((d) => d.usedExpiring > 0).length, c: 'rgb(var(--color-positive))' },
      { k: 'Avanzi mangiati', v: md.filter((d) => d.leftover).length, c: 'rgb(var(--color-positive))' },
      { k: 'Prodotti buttati', v: ev.filter((e) => e.type === 'buttato').length, c: 'rgb(var(--color-negative))' },
    ];
    const buttatoEur = ev.filter((e) => e.type === 'buttato').reduce((s, e) => s + (Number(e.value) || 0), 0);
    return { trend, basi, monthDays, md, places, homeCost, outAvg, homeVals, grad, tempo, streaks: { veg: streak(isVegD), vegRec: record(isVegD), fruit: streak((d) => d.main === 'Verdure|frutta' || d.second === 'Verdure|frutta'), fruitRec: record((d) => d.main === 'Verdure|frutta' || d.second === 'Verdure|frutta'), fishWeeks }, spreco, buttatoEur, outCount: outMeals.length, outTot: outMeals.reduce((s, m) => s + m.cost, 0) };
  }, [rec, data, dishes, today]);

  const firstWd = (new Date(`${a.monthDays[0]}T12:00:00`).getDay() + 6) % 7;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Box n={1} title="Andamento della varietà" sub="Punteggio delle ultime 8 settimane; tratteggio = 70.">
        <LineMini points={a.trend} max={100} target={70} />
      </Box>
      <Box n={2} title="Di cosa ti nutri" sub="Basi dei piatti del mese (principale + secondaria).">
        <Donut parts={a.basi} />
      </Box>
      <Box n={3} title="Calendario dei pasti" sub="Mese in corso: pranzo sopra, cena sotto.">
        <div className="grid grid-cols-7 gap-1">
          {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => <span key={i} className="text-center text-[10px] text-text-muted">{d}</span>)}
          {Array.from({ length: firstWd }, (_, i) => <span key={`e${i}`} />)}
          {a.monthDays.map((day) => {
            const col = (m) => {
              const d = a.md.find((x) => x.date === day && x.meal === m);
              const b = d && (baseKey(d.main) || baseKey(d.second));
              return <div className="h-2.5 rounded-sm" style={{ background: b ? BASE_COLOR[b] : d ? 'rgb(var(--text-muted))' : 'rgb(var(--bg-elevated))' }} />;
            };
            return (
              <div key={day} className="space-y-0.5" title={dateLabel(day)}>
                {col('pranzo')}
                {col('cena')}
              </div>
            );
          })}
        </div>
      </Box>
      <Box n={4} title="Casa, fuori, delivery" sub={`Pasti per settimana${a.outCount ? ` · fuori ultimi 90 gg: ${a.outCount} pasti, ${euro(a.outTot)}` : ''}.`}>
        <StackMini cols={a.places.cols} series={a.places.series} />
      </Box>
      <Box n={5} title="Quanto costa mangiare" sub="Costo medio a porzione delle ricette fatte a casa, per settimana.">
        <LineMini points={a.homeCost} fmt={(v) => `${v}€`} color="rgb(var(--color-positive))" />
        <p className="text-sm">
          A casa <b className="tabular-nums">{a.homeVals.length ? euro(a.homeVals.reduce((s, x) => s + x.v, 0) / a.homeVals.length) : '—'}</b> a porzione · fuori <b className="tabular-nums">{a.outAvg != null ? euro(a.outAvg) : '—'}</b> a pasto
        </p>
      </Box>
      <Box n={7} title="Stai mangiando cose che ti piacciono?" sub="Stelle medie dei piatti con voto, per settimana.">
        <LineMini points={a.grad} max={5} color="rgb(var(--brand-primary))" />
      </Box>
      <Box n={8} title="Tempo in cucina" sub="Minuti di preparazione e cottura per settimana (a casa).">
        <StackMini cols={a.tempo.cols} series={a.tempo.series} />
      </Box>
      <Box n={9} title="Serie e record">
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            [a.streaks.veg, 'giorni di fila con verdura', `record ${a.streaks.vegRec}`],
            [a.streaks.fruit, 'giorni di fila con frutta', `record ${a.streaks.fruitRec}`],
            [a.streaks.fishWeeks, 'settimane di fila col pesce ok', ''],
          ].map(([v, l, s], i) => (
            <div key={i} className="rounded-md bg-bg-elevated p-2">
              <div className="text-2xl font-bold tabular-nums">{v}</div>
              <div className="text-[11px] text-text-muted leading-tight">{l}</div>
              {s && <div className="text-[10px] text-brand mt-0.5">{s}</div>}
            </div>
          ))}
        </div>
      </Box>
      <Box n={10} title="Anti-spreco" sub={`Mese in corso${a.buttatoEur ? ` · buttato ${euro(a.buttatoEur)}` : ''}.`}>
        <ul className="space-y-2">
          {a.spreco.map((x) => {
            const m = Math.max(1, ...a.spreco.map((y) => y.v));
            return (
              <li key={x.k} className="text-sm">
                <div className="flex justify-between"><span>{x.k}</span><b className="tabular-nums">{x.v}</b></div>
                <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden mt-1"><div className="h-full rounded-full" style={{ width: `${(x.v / m) * 100}%`, background: x.c }} /></div>
              </li>
            );
          })}
        </ul>
      </Box>
    </div>
  );
}

export { mealLabel, dateLabel };
