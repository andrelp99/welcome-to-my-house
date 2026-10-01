// "Ho cucinato" unico: dalla ricetta, dal planner (✓), da "Cosa ho mangiato". Rapido o lista modificabile.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Modal, Field, Select, Button, Stepper, ProductPicker } from './ui/kit.jsx';
import { Stars } from './recipes.jsx';
import { buildUses, cookSave, scalesAt, rowState, qtyForOption, portionQty, restoreOps } from '../db/cook.js';
import { getSetting, mealFromClock } from '../db/meals.js';
import { MEALS_ALL, PLACES } from '../db/variety.js';
import { euro, fmtQty, todayISO } from '../db/logic.js';
import { priceOf, niceQty } from '../db/recipes.js';
import { save, undo } from '../db/repo.js';
import { showToast } from '../hooks/useData.js';

const DOT = { ok: 'bg-positive', low: 'bg-warning', missing: 'bg-negative' };
const dateLabel = (d) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
const num = (v) => {
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
// stima € di una riga (per il riepilogo prima di confermare)
const estimate = (r, data) => (r.on ? priceOf(r.product, r.qty, data) || 0 : 0);

export function CookModal({ rec, data, recipe = null, entry = null, date: date0, meal: meal0, place: place0, servings = 1, urgent = 0, startEdit = false, onClose }) {
  const extra = !!getSetting(rec, 'planner', {})?.extraMeals;
  const date = entry?.date || date0 || todayISO();
  const [meal, setMeal] = useState(entry?.meal || meal0 || mealFromClock(extra));
  const [place, setPlace] = useState(place0 || rec.meals[`ml-${date}-${entry?.meal || meal0}`]?.place || 'casa');
  const [cooked, setCooked] = useState(Math.max(1, Number(entry?.cooked) || Number(servings) || 1));
  const [eaten, setEaten] = useState(Math.max(1, Math.min(Number(entry?.servings) || 1, Number(servings) || 1)));
  const [edit, setEdit] = useState(startEdit);
  const [rating, setRating] = useState(recipe?.rating || null);
  const [leftLoc, setLeftLoc] = useState('loc-frigo');
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const base = useMemo(() => buildUses({ recipe, entry, cooked, data, rec }), [recipe, entry, cooked, data, rec]);
  const [rows, setRows] = useState(base.rows);
  const [extraRows, setExtraRows] = useState([]);
  const [lastCooked, setLastCooked] = useState(cooked);
  // cambiano le porzioni: ricalcola le dosi (le aggiunte restano)
  if (lastCooked !== cooked) {
    setLastCooked(cooked);
    setRows(base.rows);
  }
  const all = [...rows, ...extraRows];
  const scales = scalesAt(place);
  const left = recipe ? Math.max(0, Math.round((cooked - eaten) * 1000) / 1000) : 0;
  const est = all.reduce((s, r) => s + estimate(r, data), 0);
  const title = recipe?.title || entry?.note || 'Piatto';
  const upd = (key, patch, list = 'rows') => (list === 'rows' ? setRows : setExtraRows)((a) => a.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function confirm(useRows = all) {
    setBusy(true);
    const { total } = await cookSave({ rec, data, recipe, entry, date, meal, place, cooked, eaten, rows: useRows, leftLoc, rating, usedExpiring: urgent });
    showToast(scales ? `${title}: dispensa aggiornata${total ? ` · ${euro(total)}` : ''}` : `${title}: nel diario`, { label: 'Annulla', run: () => undo() });
    onClose(true);
  }

  const footer = !scales ? (
    <Button onClick={() => confirm([])} disabled={busy}>Conferma</Button>
  ) : edit ? (
    <>
      <Button variant="ghost" onClick={() => setEdit(false)}>Indietro</Button>
      <Button onClick={() => confirm()} disabled={busy}>Conferma</Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={() => setEdit(true)}>Modifica</Button>
      <Button onClick={() => confirm()} disabled={busy}>{recipe ? 'Come da ricetta' : 'Conferma'}</Button>
    </>
  );

  return (
    <Modal title={`Ho cucinato${date !== todayISO() ? ` · ${dateLabel(date)}` : ''}`} onClose={() => onClose(false)} footer={footer}>
      <div className="font-semibold">{title}</div>
      <div className="flex flex-wrap gap-1.5">
        {PLACES.map((p) => (
          <button key={p.id} type="button" onClick={() => setPlace(p.id)} className={`rounded-full border px-3 py-1 text-sm ${place === p.id ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pasto">
          <Select value={meal} onChange={(e) => setMeal(e.target.value)} disabled={!!entry}>
            {MEALS_ALL.filter((m) => extra || !m.extra || m.id === meal).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </Select>
        </Field>
        {recipe && (
          <Field label="Com'era?">
            <Stars value={rating} onChange={setRating} label="Gradimento" />
          </Field>
        )}
      </div>
      {!scales ? (
        <p className="text-sm text-text-secondary">A {PLACES.find((p) => p.id === place)?.label} non scalo nulla dalla dispensa: va solo nel diario.</p>
      ) : (
        <>
          {recipe && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cucinate">
                <Stepper value={cooked} unit="porz." min={1} onChange={(v) => { setCooked(Math.max(1, v)); setEaten((e) => Math.min(e, Math.max(1, v))); }} />
              </Field>
              <Field label="Mangiate ora">
                <Stepper value={eaten} unit="porz." min={1} onChange={(v) => setEaten(Math.min(cooked, Math.max(1, v)))} />
              </Field>
            </div>
          )}
          {left > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>Avanzo: <b>{fmtQty(left)} porz.</b></span>
              <Select value={leftLoc} onChange={(e) => setLeftLoc(e.target.value)} aria-label="Dove metti l'avanzo" className="!w-auto">
                <option value="loc-frigo">in frigo (3 giorni)</option>
                <option value="loc-freezer">in freezer</option>
              </Select>
            </div>
          )}
          <div className="flex justify-between text-sm text-text-secondary">
            <span>{all.filter((r) => r.on).length} ingredienti · prima i lotti che scadono</span>
            {est > 0 && <b className="text-text-primary">~{euro(est)}</b>}
          </div>
          {base.unlinked > 0 && <p className="text-xs text-text-muted">{base.unlinked} ingredienti non collegati al catalogo: non li scalo.</p>}
          {!edit && all.length === 0 && <p className="text-sm text-text-muted">Nessun ingrediente da scalare: tocca Modifica per aggiungerli.</p>}
          {edit && (
            <div className="space-y-1">
              {[...rows.map((r) => [r, 'rows']), ...extraRows.map((r) => [r, 'extra'])].map(([r, list]) => {
                const st = rowState(r, data);
                return (
                  <div key={r.key} className="border-t border-bg-border first:border-0 py-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" aria-label={`Usato ${r.product.name}`} className="w-5 h-5 shrink-0 accent-[rgb(var(--brand-primary))]" checked={r.on} onChange={(e) => upd(r.key, { on: e.target.checked }, list)} />
                      <div className="flex-1 min-w-0">
                        <div className={`flex items-center gap-1.5 text-sm font-medium ${r.on ? '' : 'text-text-muted line-through'}`}>
                          <span className={`w-2 h-2 rounded-full shrink-0 ${DOT[st]}`} />
                          <span className="truncate">{list === 'extra' ? `+ ${r.product.name}` : r.product.name}</span>
                        </div>
                        <div className="text-xs text-text-muted truncate">
                          {r.mem?.mine ? <span className="text-brand">dose tua · {fmtQty(niceQty(r.mem.mine * cooked, r.product.default_unit))} {r.product.default_unit}</span>
                            : r.mem?.last ? <span className="text-brand">l'ultima volta {fmtQty(niceQty(r.mem.last * cooked, r.product.default_unit))} {r.product.default_unit}</span>
                            : list === 'extra' ? 'aggiunto da te' : r.optional ? 'superfluo' : r.text}
                          {st === 'missing' && r.on ? <span className="text-negative"> · non risulta in dispensa</span> : st === 'low' && r.on ? <span className="text-warning"> · ne risulta meno</span> : null}
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1 text-sm shrink-0">
                        <input inputMode="decimal" aria-label={`Quantità ${r.product.name}`} value={r.qtyText ?? fmtQty(r.qty)} onChange={(e) => upd(r.key, { qtyText: e.target.value, qty: num(e.target.value), on: num(e.target.value) > 0 }, list)} className="w-16 rounded-md bg-bg-elevated border border-bg-border px-2 py-1 text-right tabular-nums focus:outline-none focus:border-brand" />
                        <span className="text-text-muted w-9">{r.product.default_unit}</span>
                      </span>
                    </div>
                    {r.options.length > 1 && (
                      <div className="pl-7">
                        <select aria-label={`Cosa hai usato al posto di ${r.base.name}`} value={r.product.id} onChange={(e) => { const o = r.options.find((x) => x.product.id === e.target.value); upd(r.key, { product: o.product, qty: qtyForOption(r, o), qtyText: undefined }, list); }} className="rounded-md bg-bg-elevated border border-bg-border px-2 py-1 text-xs">
                          {r.options.map((o) => <option key={o.product.id} value={o.product.id}>{o.product.id === r.base.id ? o.product.name : `${o.product.name} (alternativa)`}</option>)}
                        </select>
                      </div>
                    )}
                    {r.on && st !== 'ok' && (
                      <div className="pl-7 flex flex-wrap gap-1.5">
                        {[['comunque', 'usato comunque'], ['lista', 'finito → lista spesa'], ['no', 'non usato']].map(([k, l]) => (
                          <button key={k} type="button" onClick={() => upd(r.key, { action: k, ...(k === 'no' && st === 'missing' ? { on: false } : {}) }, list)} className={`rounded-full border px-2 py-0.5 text-xs ${r.action === k ? 'border-brand text-brand bg-brand/10' : 'border-bg-border text-text-muted'}`}>
                            {l}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              {adding ? (
                <ProductPicker products={data.products} area="cibo" autoFocus placeholder="Cosa hai aggiunto?" onPick={(p) => { setExtraRows((a) => [...a, { key: `x-${p.id}-${a.length}`, text: p.name, base: p, product: p, options: [{ product: p, ratio: 1 }], need: null, qty: portionQty(p), on: true, optional: false, mem: null, action: 'comunque' }]); setAdding(false); }} />
              ) : (
                <Button variant="text" onClick={() => setAdding(true)}><Plus size={16} /> ingrediente</Button>
              )}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

// Tolto "mangiato" (o eliminato) un piatto che aveva scalato la dispensa: rimetto gli ingredienti?
export function RestoreModal({ rec, data, entry, remove = false, onClose }) {
  const [busy, setBusy] = useState(false);
  const evs = rec.events.filter((e) => e.plan_id === entry.id && e.type === 'consumo');
  const names = [...new Set(evs.map((e) => data.products[e.product_id]?.name).filter(Boolean))];
  const title = (entry.recipe_id && rec.byId[entry.recipe_id]?.title) || (entry.leftover_of && `Avanzo: ${rec.byId[entry.leftover_of]?.title}`) || entry.note || 'Piatto';
  async function go(restore) {
    setBusy(true);
    const ops = restore ? await restoreOps(rec, data, entry) : [];
    ops.push({ table: 'meal_plan', row: remove ? { id: entry.id, deleted: 1 } : { id: entry.id, done: 0, done_at: null } });
    await save(ops, `${title}: ${remove ? 'tolto' : 'non mangiato'}${restore ? ', ingredienti rimessi' : ''}`);
    showToast(restore ? 'Ingredienti rimessi in dispensa' : remove ? 'Tolto dal planner' : 'Segnato come non mangiato', { label: 'Annulla', run: () => undo() });
    onClose(true);
  }
  return (
    <Modal
      title={remove ? 'Togli piatto' : 'Non mangiato'}
      onClose={() => onClose(false)}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={() => go(false)}>No, li ho usati</Button>
          <Button disabled={busy} onClick={() => go(true)}>Sì, rimetti</Button>
        </>
      }
    >
      <p className="font-semibold">{title}: rimetto in dispensa gli ingredienti?</p>
      {names.length > 0 && <p className="text-sm text-text-secondary">{names.join(' · ')}</p>}
      {data.lots.some((l) => l.plan_id === entry.id) && <p className="text-xs text-text-muted">Tolgo anche l'avanzo creato.</p>}
    </Modal>
  );
}
