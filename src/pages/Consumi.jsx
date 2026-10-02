// Dispensa → Consumi (0.14): Giorno · Periodo · Prodotti · Bilancio
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Search, X } from 'lucide-react';
import { Button, IconButton, Tabs, Empty } from '../components/ui/kit.jsx';
import { HBars } from '../components/charts.jsx';
import { AddUsedModal } from '../components/cook.jsx';
import { LineMini } from '../components/diary.jsx';
import { valueOf, dayRecap, periodStats, dormant, balance, productCard, periodCsv, isLeftoverProduct } from '../db/consumi.js';
import { addDaysIso, weekStartIso, PLACES } from '../db/variety.js';
import { euro, fmtQty, todayISO } from '../db/logic.js';

const dLabel = (d, o = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(`${d}T12:00:00`).toLocaleDateString('it-IT', o);
const short = (d) => dLabel(d, { day: 'numeric', month: 'short' });
const eur = (v) => (v == null ? '—' : euro(v));
const placeLabel = (id) => PLACES.find((p) => p.id === id)?.label || id;
const TREND = { up: ['↑', 'text-negative'], down: ['↓', 'text-positive'], eq: ['=', 'text-text-muted'], new: ['+', 'text-brand'] };

function Kpi({ label, value, sub, bad, neutral }) {
  return (
    <div className="rounded-md border border-bg-border bg-bg-surface px-3 py-2 min-w-0">
      <div className="text-[11px] text-text-secondary">{label}</div>
      <div className="text-lg font-bold tabular-nums truncate">{value}</div>
      {sub && <div className={`text-[11px] ${neutral ? 'text-text-muted' : bad ? 'text-negative' : 'text-positive'}`}>{sub}</div>}
    </div>
  );
}
const delta = (cur, prev, money = true) => {
  const d = Math.round((cur - prev) * 100) / 100;
  if (!prev && !cur) return null;
  return { text: `${d > 0 ? '↑' : d < 0 ? '↓' : '='} ${money ? euro(Math.abs(d)) : Math.abs(d)} vs prima`, bad: d > 0 };
};
function Card({ title, children, right }) {
  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface p-3 space-y-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold text-sm">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

// ── Giorno ──
function DayView({ rec, data, date, setDate }) {
  const r = useMemo(() => dayRecap(rec, data, date), [rec, data, date]);
  const [adding, setAdding] = useState(null);
  const today = todayISO();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 rounded-lg border border-bg-border bg-bg-surface px-2 py-1.5">
        <IconButton label="Giorno prima" onClick={() => setDate(addDaysIso(date, -1))}><ChevronLeft size={18} /></IconButton>
        <button type="button" className="text-sm font-semibold capitalize" onClick={() => setDate(today)}>
          {dLabel(date)}
          {date !== today && <span className="block text-xs text-brand font-normal normal-case">torna a oggi</span>}
        </button>
        <IconButton label="Giorno dopo" onClick={() => setDate(addDaysIso(date, 1))} disabled={date >= today}><ChevronRight size={18} /></IconButton>
      </div>
      <div className="flex justify-between text-sm px-1">
        <span className="text-text-secondary">Ingredienti dei pasti mangiati</span>
        <b className="tabular-nums">{euro(r.total)}</b>
      </div>
      {r.meals.length === 0 && r.outside.length === 0 && <Empty>Niente registrato per questo giorno.</Empty>}
      {r.meals.map((m) => (
        <section key={m.meal.id} className="rounded-lg border border-bg-border bg-bg-surface px-3 py-2.5 space-y-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-xs uppercase tracking-wider font-semibold text-text-secondary">
              {m.meal.label}
              {m.place !== 'casa' && <span className="ml-2 normal-case tracking-normal rounded-full border border-bg-border px-2 py-0.5 text-[11px]">{placeLabel(m.place)}</span>}
            </span>
            <b className="tabular-nums text-sm">{m.outCost ? euro(m.outCost) : euro(m.cost)}</b>
          </div>
          {m.dishes.map((d) => (
            <div key={d.entry.id} className="space-y-0.5">
              <div className="text-xs text-text-muted">
                {d.title}
                {d.item ? ' · alimento' : ''}
                {d.share < 1 ? ` · ${fmtQty(d.entry.servings)} di ${fmtQty(d.entry.cooked)} porz.` : ''}
                {!d.lines.length && !d.item ? ' · niente scalato' : ''}
                {!d.item && (m.place === 'casa' || m.place === 'schiscia') ? (
                  <button type="button" className="ml-2 text-brand font-semibold" onClick={() => setAdding(d.entry)}>+ ingredienti</button>
                ) : null}
              </div>
              {d.lines.map((l) => (
                <div key={l.p.id} className="grid grid-cols-[1fr_auto_auto] gap-3 text-sm tabular-nums">
                  <span className="truncate">{isLeftoverProduct(l.p) ? l.p.name : l.p.name}</span>
                  <span className="text-text-secondary">{fmtQty(Math.round(l.qty * d.share * 100) / 100)} {l.p.default_unit}</span>
                  <span className="w-16 text-right">{l.value != null ? euro(Math.round(l.value * d.share * 100) / 100) : '—'}</span>
                </div>
              ))}
            </div>
          ))}
        </section>
      ))}
      {adding && <AddUsedModal rec={rec} data={data} entry={adding} onClose={() => setAdding(null)} />}
      {r.outside.length > 0 && (
        <section className="space-y-1 px-1">
          <div className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Fuori dai pasti</div>
          {r.outside.map(({ e, p, recipe }) => (
            <div key={e.id} className={`grid grid-cols-[1fr_auto_auto] gap-3 text-sm tabular-nums ${e.type === 'buttato' ? 'text-negative' : e.type === 'rettifica' ? 'text-text-muted' : ''}`}>
              <span className="truncate">{e.type === 'buttato' ? 'Buttato · ' : e.type === 'rettifica' ? 'Correzione · ' : recipe ? `${recipe.title} · ` : 'Usato · '}{p.name}</span>
              <span className="text-text-secondary">{e.type === 'rettifica' ? '−' : ''}{fmtQty(e.qty)} {e.unit || p.default_unit}</span>
              <span className="w-16 text-right">{e.type === 'rettifica' ? '—' : eur(valueOf(e, p, data))}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

// ── Periodo ──
function periodRange(kind, anchor, custom) {
  if (kind === 'week') {
    const from = weekStartIso(anchor);
    return { from, to: addDaysIso(from, 6) };
  }
  if (kind === 'month') {
    const from = `${anchor.slice(0, 7)}-01`;
    const d = new Date(`${from}T12:00:00`);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    return { from, to: `${anchor.slice(0, 7)}-${String(last).padStart(2, '0')}` };
  }
  return custom;
}
function PeriodPicker({ kind, setKind, anchor, setAnchor, custom, setCustom, range }) {
  const step = (n) => setAnchor(kind === 'week' ? addDaysIso(anchor, 7 * n) : (() => { const d = new Date(`${anchor.slice(0, 7)}-15T12:00:00`); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); })());
  return (
    <div className="space-y-2">
      <div className="flex gap-1.5">
        {[['week', 'Settimana'], ['month', 'Mese'], ['custom', 'Date…']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full border px-3 py-1 text-sm ${kind === k ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>{l}</button>
        ))}
      </div>
      {kind === 'custom' ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input type="date" aria-label="Dal" value={custom.from} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="rounded-md bg-bg-elevated border border-bg-border px-2 py-1.5" />
          <span>→</span>
          <input type="date" aria-label="Al" value={custom.to} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="rounded-md bg-bg-elevated border border-bg-border px-2 py-1.5" />
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-bg-border bg-bg-surface px-2 py-1">
          <IconButton label="Precedente" onClick={() => step(-1)}><ChevronLeft size={18} /></IconButton>
          <span className="text-sm font-semibold capitalize">{kind === 'month' ? dLabel(range.from, { month: 'long', year: 'numeric' }) : `${short(range.from)} – ${short(range.to)}`}</span>
          <IconButton label="Successivo" onClick={() => step(1)}><ChevronRight size={18} /></IconButton>
        </div>
      )}
    </div>
  );
}

function PeriodView({ rec, data, range, onProduct }) {
  const st = useMemo(() => periodStats(rec, data, range.from, range.to), [rec, data, range.from, range.to]);
  const dorm = useMemo(() => dormant(rec, data, todayISO()), [rec, data]);
  const [open, setOpen] = useState(null);
  const du = delta(st.used, st.prevUsed);
  const dw = delta(st.wasted, st.prevWasted);
  function exportCsv() {
    const blob = new Blob([`﻿${periodCsv(st)}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `consumi_${range.from}_${range.to}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Ingredienti usati" value={euro(st.used)} sub={du?.text} bad={du?.bad} />
        <Kpi label="Ingredienti" value={st.count} sub={st.prevCount ? `${st.count - st.prevCount >= 0 ? '↑' : '↓'} ${Math.abs(st.count - st.prevCount)} vs prima` : null} neutral />
        <Kpi label="Buttato" value={euro(st.wasted)} sub={dw?.text} bad={dw?.bad} />
      </div>
      {st.rows.length === 0 ? (
        <Empty>Nessun ingrediente usato in questo periodo.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-bg-border bg-bg-surface">
          <table className="w-full text-sm tabular-nums">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-text-secondary">
                <th className="text-left font-semibold px-3 py-2">Ingrediente</th>
                <th className="text-right font-semibold px-2 py-2">Qtà</th>
                <th className="text-right font-semibold px-2 py-2">Usi</th>
                <th className="text-right font-semibold px-2 py-2">€</th>
                <th className="text-right font-semibold px-3 py-2">vs</th>
              </tr>
            </thead>
            <tbody>
              {st.rows.map((r) => (
                <FragmentRow key={r.p.id} r={r} open={open === r.p.id} onToggle={() => setOpen(open === r.p.id ? null : r.p.id)} onProduct={onProduct} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {st.byCategory.length > 0 && (
          <Card title="Per categoria">
            <HBars items={st.byCategory.map((c) => ({ label: c.name, value: c.value }))} format={euro} />
          </Card>
        )}
        <Card title="Costo per pasto" right={<span className="text-xs text-text-muted">cibo di casa {euro(st.perDay)}/giorno</span>}>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[['casa', 'Casa'], ['schiscia', 'Schiscia'], ['fuori', 'Fuori']].map(([k, l]) => (
              <div key={k} className="rounded-md bg-bg-elevated py-2">
                <div className="text-[11px] text-text-secondary">{l} · {st.mealCosts[k].n}</div>
                <div className="font-bold tabular-nums">{eur(st.mealCosts[k].avg)}</div>
              </div>
            ))}
          </div>
          <p className="text-xs text-text-muted">Media per pasto. Casa Crema non ha costo e non entra.</p>
        </Card>
        {st.recipes.length > 0 && (
          <Card title="Ricette: costo reale per porzione">
            {st.recipes.slice(0, 8).map((x, i) => (
              <div key={`${x.r.id}-${i}`} className="grid grid-cols-[1fr_auto_auto] gap-3 text-sm tabular-nums">
                <span className="truncate">{x.r.title}</span>
                <span className="text-text-muted text-xs self-center">{x.est != null ? `stimato ${euro(x.est)}` : ''}</span>
                <b>{euro(x.real)}</b>
              </div>
            ))}
          </Card>
        )}
        <Card title="Top">
          {st.topUsed.length > 0 && (
            <>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Più usati</div>
              <p className="text-sm">{st.topUsed.map((r) => `${r.p.name} ${r.uses}`).join(' · ')}</p>
              <div className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Più costosi</div>
              <p className="text-sm">{st.topCost.map((r) => `${r.p.name} ${euro(r.value)}`).join(' · ')}</p>
            </>
          )}
          <div className="text-[11px] uppercase tracking-wider font-semibold text-text-muted">Dormienti in dispensa (30+ gg senza usi)</div>
          {dorm.length ? (
            <div className="flex flex-wrap gap-1.5">
              {dorm.slice(0, 12).map((x) => (
                <button key={x.p.id} type="button" onClick={() => onProduct(x.p.id)} className="rounded-full border border-bg-border bg-bg-elevated px-2.5 py-0.5 text-xs">
                  {x.p.name} · {x.days} gg
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">Nessuno: usi tutto quello che hai.</p>
          )}
        </Card>
      </div>
      {st.rows.length > 0 && (
        <Button variant="ghost" className="w-full" onClick={exportCsv}><Download size={16} /> Esporta CSV del periodo</Button>
      )}
    </div>
  );
}
function FragmentRow({ r, open, onToggle, onProduct }) {
  const [t, cls] = TREND[r.trend];
  return (
    <>
      <tr className="border-t border-bg-border cursor-pointer hover:bg-bg-hover" onClick={onToggle}>
        <td className="px-3 py-1.5 max-w-[11rem] truncate">{r.p.name}</td>
        <td className="px-2 py-1.5 text-right whitespace-nowrap">{fmtQty(Math.round(r.qty * 100) / 100)} {r.p.default_unit}</td>
        <td className="px-2 py-1.5 text-right">{r.uses}</td>
        <td className="px-2 py-1.5 text-right">{euro(r.value)}</td>
        <td className={`px-3 py-1.5 text-right text-xs ${cls}`}>{t}</td>
      </tr>
      {open && (
        <tr className="bg-bg-base/50">
          <td colSpan={5} className="px-3 py-2 text-xs text-text-secondary space-y-1">
            <div>{r.recipes.length ? `In: ${r.recipes.join(' · ')}` : 'Usato da solo (alimento o conta rapida)'}</div>
            <div>Giorni: {r.days.map(short).join(', ')}</div>
            <button type="button" className="text-brand font-semibold" onClick={() => onProduct(r.p.id)}>Scheda prodotto →</button>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Prodotti ──
function ProductView({ rec, data, pid, setPid }) {
  const [q, setQ] = useState('');
  const today = todayISO();
  const card = useMemo(() => (pid ? productCard(rec, data, pid, today) : null), [rec, data, pid, today]);
  const used = useMemo(() => {
    const n = {};
    for (const e of rec.events) if (e.type === 'consumo' && data.products[e.product_id] && !isLeftoverProduct(data.products[e.product_id])) n[e.product_id] = (n[e.product_id] || 0) + 1;
    return n;
  }, [rec, data]);
  if (!card) {
    const s = q.trim().toLowerCase();
    const list = Object.values(data.products)
      .filter((p) => p.area === 'cibo' && !isLeftoverProduct(p) && (s ? p.name.toLowerCase().includes(s) : used[p.id]))
      .sort((a, b) => (used[b.id] || 0) - (used[a.id] || 0) || a.name.localeCompare(b.name, 'it'))
      .slice(0, 40);
    return (
      <div className="space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca prodotto…" className="w-full rounded-md bg-bg-surface border border-bg-border pl-9 pr-3 py-2.5 focus:outline-none focus:border-brand" />
        </div>
        {list.length === 0 ? (
          <Empty>{s ? 'Nessun prodotto.' : 'Ancora nessun consumo registrato.'}</Empty>
        ) : (
          <ul className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
            {list.map((p) => (
              <li key={p.id}>
                <button type="button" className="w-full flex justify-between gap-2 px-3 py-2.5 text-left text-sm" onClick={() => setPid(p.id)}>
                  <span className="truncate">{p.name}</span>
                  <span className="text-text-muted shrink-0">{used[p.id] ? `${used[p.id]} usi` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  const { p } = card;
  const unit = p.default_unit;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="font-bold text-lg flex-1 truncate">{p.name}</h2>
        <IconButton label="Chiudi scheda" onClick={() => setPid(null)}><X size={18} /></IconButton>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="In dispensa" value={`${fmtQty(Math.round(card.have * 100) / 100)} ${unit}`} />
        <Kpi label="Uso medio" value={`${fmtQty(card.perWeek)} ${unit}`} sub="a settimana" neutral />
        <Kpi label="Finisce tra" value={card.finishes != null ? `~${card.finishes} gg` : '—'} />
      </div>
      <Card title="Uso per settimana · ultime 8">
        <LineMini points={card.weeks.map((w) => ({ v: w.qty, label: short(w.to) }))} fmt={(v) => fmtQty(v)} />
      </Card>
      <Card title="Prezzo">
        <div className="flex justify-between text-sm"><span className="text-text-secondary">Ultimo{card.last ? ` · ${card.last.chain || ''} ${short(card.last.date)}` : ''}</span><b className="tabular-nums">{card.last ? `${euro(card.last.paid / card.last.qty)}/${card.last.unit}` : '—'}</b></div>
        <div className="flex justify-between text-sm"><span className="text-text-secondary">Medio 3 mesi</span><b className="tabular-nums">{card.avgPrice != null ? `${euro(card.avgPrice)}/${card.last?.unit || unit}` : '—'}</b></div>
      </Card>
      <Card title="Storico">
        {card.history.length === 0 && <p className="text-sm text-text-muted">Niente ancora.</p>}
        {card.history.slice(0, 20).map((h, i) => (
          <div key={i} className={`grid grid-cols-[1fr_auto_auto] gap-3 text-sm tabular-nums ${h.kind === 'acquisto' ? 'text-positive' : h.kind === 'buttato' ? 'text-negative' : ''}`}>
            <span className="truncate">{short(h.date)} · {h.label}</span>
            <span className="text-text-secondary">{h.kind === 'acquisto' ? '+' : ''}{fmtQty(Math.round(h.qty * 100) / 100)}</span>
            <span className="w-16 text-right">{eur(h.value != null ? Math.round(h.value * 100) / 100 : null)}</span>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ── Bilancio ──
function BalanceView({ rec, data, range }) {
  const b = useMemo(() => balance(rec, data, range.from, range.to), [rec, data, range.from, range.to]);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Kpi label="Comprato" value={euro(b.bought)} />
        <Kpi label="Usato" value={euro(b.used)} />
        <Kpi label="Buttato" value={euro(b.wasted)} sub={`${Math.round(b.wastePct * 1000) / 10} % spreco`} bad={b.wastePct > 0.05} />
      </div>
      <Card title="Per prodotto">
        <div className="flex flex-wrap gap-3 text-[11px] text-text-secondary">
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-positive mr-1 align-[-1px]" />usato</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-negative mr-1 align-[-1px]" />buttato</span>
          <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-bg-border mr-1 align-[-1px]" />ancora in casa / non usato</span>
        </div>
        {b.rows.length === 0 && <p className="text-sm text-text-muted">Niente comprato o usato in questo periodo.</p>}
        <div className="space-y-1.5">
          {b.rows.slice(0, 30).map((r) => (
            <div key={r.p.id} className="grid grid-cols-[6.5rem_1fr_2.75rem] gap-2 items-center text-xs tabular-nums">
              <span className="truncate">{r.p.name}</span>
              <div className="flex h-2.5 rounded-full overflow-hidden bg-bg-border" title={`comprato ${fmtQty(Math.round(r.bought * 100) / 100)} · usato ${fmtQty(Math.round(r.used * 100) / 100)} · buttato ${fmtQty(Math.round(r.wasted * 100) / 100)} ${r.p.default_unit}`}>
                <div className="bg-positive" style={{ width: `${r.pctUsed * 100}%` }} />
                <div className="bg-negative" style={{ width: `${r.pctWasted * 100}%` }} />
              </div>
              <span className={`text-right ${r.waste > 0.2 ? 'text-negative' : ''}`}>{Math.round(r.waste * 100)} %</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

export default function Consumi({ rec, data, initialDate }) {
  const [view, setView] = useState('giorno');
  const [date, setDate] = useState(initialDate || todayISO());
  const [kind, setKind] = useState('week');
  const [anchor, setAnchor] = useState(todayISO());
  const [custom, setCustom] = useState({ from: addDaysIso(todayISO(), -13), to: todayISO() });
  const [pid, setPid] = useState(null);
  const range = periodRange(kind, anchor, custom);
  const openProduct = (id) => {
    setPid(id);
    setView('prodotti');
  };
  return (
    <div className="space-y-3">
      <Tabs
        value={view}
        onChange={setView}
        tabs={[
          { value: 'giorno', label: 'Giorno' },
          { value: 'periodo', label: 'Periodo' },
          { value: 'prodotti', label: 'Prodotti' },
          { value: 'bilancio', label: 'Bilancio' },
        ]}
      />
      {(view === 'periodo' || view === 'bilancio') && <PeriodPicker kind={kind} setKind={setKind} anchor={anchor} setAnchor={setAnchor} custom={custom} setCustom={setCustom} range={range} />}
      {view === 'giorno' && <DayView rec={rec} data={data} date={date} setDate={setDate} />}
      {view === 'periodo' && <PeriodView rec={rec} data={data} range={range} onProduct={openProduct} />}
      {view === 'prodotti' && <ProductView rec={rec} data={data} pid={pid} setPid={setPid} />}
      {view === 'bilancio' && <BalanceView rec={rec} data={data} range={range} />}
    </div>
  );
}
