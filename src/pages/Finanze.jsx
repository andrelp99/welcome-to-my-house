import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { parseISO, getDaysInMonth, format } from 'date-fns';
import { ChevronLeft, ChevronRight, Plus, Wallet, TrendingUp, BadgePercent, Trash2, Receipt, Lightbulb, Target, ImageOff, Search, Pencil } from 'lucide-react';
import { useData, showToast } from '../hooks/useData.js';
import { Button, IconButton, Tabs, Modal, Field, Input, Select, Empty } from '../components/ui/kit.jsx';
import { Bars, HBars, PriceLine, BudgetBar } from '../components/charts.jsx';
import { Photo } from '../components/recipes.jsx';
import {
  loadFinance, monthSummary, monthsSeries, weeksOf, dailyTotals, yearProjection, budgetFor, priceHistory, productsWithPrices, deals, wasteStats, insights,
  monthKey, monthLabel, shiftMonth, AREAS, EXTRA_AREAS,
} from '../db/finance.js';
import { euro, fmtQty, todayISO } from '../db/logic.js';
import { put, save, undo } from '../db/repo.js';
import { deletePhoto } from '../db/photos.js';

const eur0 = (v) => (v == null ? '—' : v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR', maximumFractionDigits: v >= 100 ? 0 : 2 }));
const pct = (a, b) => (b ? Math.round((a / b - 1) * 100) : null);

export default function Finanze() {
  const fin = useLiveQuery(loadFinance, []);
  const data = useData();
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [tab, setTab] = useState('overview');
  if (!fin || !data) return null;
  const cur = monthKey(new Date());

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">Prospetto finanziario</h1>
        <p className="text-text-secondary text-sm">Spese, budget, prezzi, offerte e sprechi.</p>
      </div>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-bg-border bg-bg-surface px-2 py-1.5">
        <IconButton label="Mese precedente" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          <ChevronLeft size={18} />
        </IconButton>
        <button type="button" className="text-sm font-semibold capitalize" onClick={() => setMonth(cur)}>
          {monthLabel(month)}
          {month !== cur && <span className="block text-xs text-brand font-normal normal-case">torna a oggi</span>}
        </button>
        <IconButton label="Mese successivo" onClick={() => setMonth((m) => shiftMonth(m, 1))} disabled={month >= cur}>
          <ChevronRight size={18} />
        </IconButton>
      </div>
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'overview', label: 'Panoramica' },
          { value: 'spese', label: 'Spese' },
          { value: 'prezzi', label: 'Prezzi' },
          { value: 'affari', label: 'Affari' },
          { value: 'sprechi', label: 'Sprechi' },
        ]}
      />
      {tab === 'overview' && <Overview fin={fin} month={month} />}
      {tab === 'spese' && <Spese fin={fin} month={month} data={data} />}
      {tab === 'prezzi' && <Prezzi fin={fin} />}
      {tab === 'affari' && <Affari fin={fin} month={month} />}
      {tab === 'sprechi' && <Sprechi fin={fin} month={month} />}
    </div>
  );
}

function Box({ title, icon: Icon, children, action }) {
  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface p-4 shadow-card space-y-3 min-w-0">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs uppercase tracking-wider font-semibold text-text-secondary">
          {Icon && <Icon size={14} />} {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, tone, small }) {
  return (
    <div className="rounded-lg border border-bg-border bg-bg-surface p-3 shadow-card min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-text-muted">{label}</div>
      <div className={`${small ? 'text-sm' : 'text-xl'} font-bold tabular-nums ${tone === 'bad' ? 'text-negative' : tone === 'good' ? 'text-positive' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-text-muted truncate">{sub}</div>}
    </div>
  );
}

function Overview({ fin, month }) {
  const s = useMemo(() => monthSummary(fin, month), [fin, month]);
  const prev = useMemo(() => monthSummary(fin, shiftMonth(month, -1)), [fin, month]);
  const series = useMemo(() => monthsSeries(fin, month, 6), [fin, month]);
  const year = useMemo(() => yearProjection(fin), [fin]);
  const tips = useMemo(() => insights(fin, month), [fin, month]);
  const [editBudget, setEditBudget] = useState(false);
  const budgets = AREAS.map((a) => ({ ...a, amount: budgetFor(fin, month, a.id) }));
  const totalBudget = budgets.reduce((t, b) => t + (b.amount || 0), 0);
  const d = pct(s.total, prev.total);
  const empty = fin.movements.length === 0;

  return (
    <div className="space-y-4">
      {empty && <Empty icon={Wallet}>Ancora nessuna spesa registrata: fai un check-in o leggi uno scontrino dalla Lista spesa.</Empty>}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Speso" value={eur0(s.total)} sub={d != null && prev.total ? `${d > 0 ? '+' : ''}${d}% vs mese prima` : s.current ? `giorno ${s.elapsed} di ${s.days}` : ''} tone={totalBudget && s.total > totalBudget ? 'bad' : null} />
        <Kpi label="Fine mese" value={s.projection != null ? `~${eur0(s.projection)}` : '—'} sub={s.current ? (s.projection != null ? 'al ritmo attuale' : 'servono 3 giorni di dati') : 'mese chiuso'} tone={totalBudget && s.projection > totalBudget ? 'bad' : null} />
        <Kpi label="Risparmio offerte" value={eur0(s.savings)} sub="sconti sugli scontrini" tone={s.savings > 0 ? 'good' : null} />
        <Kpi label="Cibo buttato" value={eur0(s.waste)} sub={`${s.wasteCount} ${s.wasteCount === 1 ? 'volta' : 'volte'}`} tone={s.waste > 0 ? 'bad' : null} />
      </div>

      <Box title="Budget mensile" icon={Target} action={<Button variant="ghost" onClick={() => setEditBudget(true)}><Pencil size={14} /> Imposta</Button>}>
        {budgets.every((b) => !b.amount) ? (
          <p className="text-sm text-text-secondary">Nessun budget. Impostalo per cibo e casa: vale da questo mese in poi finché non lo cambi.</p>
        ) : (
          budgets.map((b) =>
            b.amount ? (
              <div key={b.id}>
                <div className="text-sm font-semibold mb-1">{b.label}</div>
                <BudgetBar spent={s.byArea[b.id] || 0} projection={s.current ? s.projArea[b.id] : null} budget={b.amount} format={eur0} />
              </div>
            ) : null
          )
        )}
        {s.byArea.altro > 0 && <p className="text-xs text-text-muted">Altro (fuori budget): {eur0(s.byArea.altro)}</p>}
      </Box>

      {tips.length > 0 && (
        <Box title="Indicazioni" icon={Lightbulb}>
          <ul className="space-y-2 text-sm">
            {tips.map((t, i) => (
              <li key={i} className="flex gap-2">
                <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${t.tone === 'bad' ? 'bg-negative' : t.tone === 'warn' ? 'bg-warning' : t.tone === 'good' ? 'bg-positive' : 'bg-brand'}`} />
                <span>{t.text}</span>
              </li>
            ))}
          </ul>
        </Box>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Box title="Ultimi 6 mesi" icon={TrendingUp}>
          <Bars items={series.map((x) => ({ label: x.label, value: x.total, highlight: x.month === month }))} format={eur0} refValue={totalBudget || null} refLabel="budget" />
        </Box>
        <Box title={`Anno ${new Date().getFullYear()}`} icon={Wallet}>
          {year ? (
            <div className="text-sm space-y-1">
              <div>
                Speso finora: <b>{eur0(year.spent)}</b>
              </div>
              <div>
                Proiezione fine anno: <b>{year.projection != null ? `~${eur0(year.projection)}` : 'servono 2 settimane di dati'}</b>
              </div>
              {year.partial && <p className="text-xs text-text-muted">Calcolata dalla prima spesa registrata, non da gennaio.</p>}
            </div>
          ) : (
            <p className="text-sm text-text-secondary">Nessun dato quest'anno.</p>
          )}
        </Box>
      </div>

      {editBudget && <BudgetModal fin={fin} month={month} onClose={() => setEditBudget(false)} />}
    </div>
  );
}

function BudgetModal({ fin, month, onClose }) {
  const [v, setV] = useState(() => Object.fromEntries(AREAS.map((a) => [a.id, budgetFor(fin, month, a.id) ?? ''])));
  async function saveB() {
    const ops = [];
    for (const a of AREAS) {
      const amount = Number(String(v[a.id]).replace(',', '.'));
      const existing = fin.budgets.find((b) => b.month === month && b.area === a.id);
      if (!(amount > 0)) {
        if (existing) ops.push({ table: 'budgets', row: { id: existing.id, deleted: 1 } });
        continue;
      }
      ops.push({ table: 'budgets', row: { ...(existing ? { id: existing.id } : {}), month, area: a.id, amount } });
    }
    if (ops.length) await save(ops, `Budget ${monthLabel(month)}`);
    onClose();
  }
  return (
    <Modal
      title={`Budget da ${monthLabel(month)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button onClick={saveB}>Salva</Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">Vale da questo mese in poi, finché non lo cambi. Vuoto = nessun budget.</p>
      <div className="grid grid-cols-2 gap-3">
        {AREAS.map((a) => (
          <Field key={a.id} label={`${a.label} (€/mese)`}>
            <Input inputMode="decimal" value={v[a.id]} onChange={(e) => setV((x) => ({ ...x, [a.id]: e.target.value }))} placeholder="es. 400" />
          </Field>
        ))}
      </div>
    </Modal>
  );
}

function Spese({ fin, month, data }) {
  const s = useMemo(() => monthSummary(fin, month), [fin, month]);
  const weeks = useMemo(() => weeksOf(fin, month), [fin, month]);
  const days = useMemo(() => dailyTotals(fin, month), [fin, month]);
  const [open, setOpen] = useState(null);
  const [extra, setExtra] = useState(null);
  const first = parseISO(`${month}-01`);
  const lead = (first.getDay() + 6) % 7;
  const n = getDaysInMonth(first);
  const maxDay = Math.max(...Object.values(days), 1);
  const cats = [...new Set(fin.movements.filter((m) => m.kind === 'extra').map((m) => m.extra.category).filter(Boolean))];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setExtra({})}>
          <Plus size={16} /> Spesa extra
        </Button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Box title="Per settimana" icon={TrendingUp}>
          <Bars items={weeks} format={eur0} height={120} />
        </Box>
        <Box title="Calendario" icon={Receipt}>
          <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-text-muted">
            {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((d, i) => (
              <span key={i}>{d}</span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`e${i}`} />
            ))}
            {Array.from({ length: n }, (_, i) => {
              const dt = `${month}-${String(i + 1).padStart(2, '0')}`;
              const v = days[dt] || 0;
              return (
                <div key={dt} title={v ? `${i + 1}: ${euro(v)}` : undefined} className={`rounded aspect-square flex flex-col items-center justify-center ${dt === todayISO() ? 'ring-1 ring-brand' : ''}`} style={{ background: v ? `rgb(var(--brand-primary) / ${0.15 + 0.75 * (v / maxDay)})` : 'rgb(var(--bg-elevated))' }}>
                  <span className={v ? 'text-text-primary font-semibold' : ''}>{i + 1}</span>
                  {v ? <span className="text-[8px] leading-none text-text-primary">{Math.round(v)}</span> : null}
                </div>
              );
            })}
          </div>
        </Box>
        <Box title="Per categoria">{s.byCategory.length ? <HBars items={s.byCategory} format={eur0} /> : <p className="text-sm text-text-muted">Nessun dato.</p>}</Box>
        <Box title="Per supermercato">{s.byChain.length ? <HBars items={s.byChain} format={eur0} /> : <p className="text-sm text-text-muted">Nessun dato.</p>}</Box>
      </div>
      <Box title={`Movimenti · ${eur0(s.total)}`} icon={Wallet}>
        {s.movements.length === 0 ? (
          <p className="text-sm text-text-muted">Nessuna spesa in questo mese.</p>
        ) : (
          <ul className="divide-y divide-bg-border">
            {s.movements.map((m) => (
              <li key={m.id}>
                <button type="button" className="w-full flex items-center gap-3 py-2 text-left text-sm" onClick={() => (m.kind === 'extra' ? setExtra(m.extra) : setOpen(m))}>
                  <span className="w-12 shrink-0 text-xs text-text-muted tabular-nums">{m.date.slice(8, 10)}/{m.date.slice(5, 7)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{m.label}</span>
                    <span className="block text-xs text-text-muted truncate">
                      {m.kind === 'extra' ? `extra · ${m.extra.area}` : `${m.lines.length} righe${m.discount ? ` · risparmio ${euro(m.discount)}` : ''}${m.receipt.photo_key ? ' · foto' : ''}`}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">{euro(m.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Box>
      {open && <ReceiptModal m={open} onClose={() => setOpen(null)} />}
      {extra && <ExtraModal extra={extra.id ? extra : null} cats={cats} onClose={() => setExtra(null)} />}
    </div>
  );
}

function ReceiptModal({ m, onClose }) {
  const r = m.receipt;
  async function dropPhoto() {
    await deletePhoto(r.photo_key);
    await put('receipts', { id: r.id, photo_key: null }, 'Foto scontrino eliminata');
    showToast('Foto eliminata');
    onClose();
  }
  async function dropReceipt() {
    await save([{ table: 'receipts', row: { id: r.id, deleted: 1 } }, ...m.lines.map((l) => ({ table: 'purchase_lines', row: { id: l.id, deleted: 1 } }))], `Eliminato scontrino ${m.label}`);
    showToast('Scontrino eliminato (la dispensa non cambia)', { label: 'Annulla', run: () => undo() });
    onClose();
  }
  return (
    <Modal title={`${m.label} · ${m.date.split('-').reverse().join('/')}`} onClose={onClose} footer={<Button variant="ghost" className="text-negative mr-auto" onClick={dropReceipt}><Trash2 size={16} /> Elimina scontrino</Button>}>
      <div className="flex justify-between text-sm">
        <span>Totale</span>
        <b>{euro(m.amount)}</b>
      </div>
      {m.discount > 0 && <div className="flex justify-between text-sm text-positive"><span>Risparmio</span><b>{euro(m.discount)}</b></div>}
      <ul className="divide-y divide-bg-border text-sm">
        {m.lines.map((l) => (
          <li key={l.id} className="flex justify-between gap-2 py-1.5">
            <span className="min-w-0 truncate">
              {l.product?.name || l.offer_type || 'Articolo'} <span className="text-text-muted">· {fmtQty(l.qty)} {l.unit}</span>
            </span>
            <span className="shrink-0 tabular-nums">
              {l.price_full ? <s className="text-text-muted mr-1">{euro(l.price_full)}</s> : null}
              {euro(l.price_paid)}
            </span>
          </li>
        ))}
      </ul>
      {r.photo_key && (
        <div className="space-y-2">
          <Photo id={r.photo_key} className="w-full max-h-80 rounded-md object-contain" icon={false} />
          <Button variant="ghost" onClick={dropPhoto}>
            <ImageOff size={16} /> Elimina foto (i dati restano)
          </Button>
        </div>
      )}
    </Modal>
  );
}

function ExtraModal({ extra, cats, onClose }) {
  const [f, setF] = useState(() => extra || { amount: '', date: todayISO(), area: 'casa', category: '', note: '' });
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const amount = Number(String(f.amount).replace(',', '.'));
  async function submit() {
    await put('extra_expenses', { ...(extra ? { id: extra.id } : {}), amount, date: f.date, area: f.area, category: f.category?.trim() || null, note: f.note?.trim() || null }, `Spesa extra ${euro(amount)}`);
    onClose();
  }
  async function del() {
    await put('extra_expenses', { id: extra.id, deleted: 1 }, 'Eliminata spesa extra');
    showToast('Spesa extra eliminata', { label: 'Annulla', run: () => undo() });
    onClose();
  }
  return (
    <Modal
      title={extra ? 'Spesa extra' : 'Nuova spesa extra'}
      onClose={onClose}
      footer={
        <>
          {extra && <Button variant="ghost" className="text-negative mr-auto" onClick={del}><Trash2 size={16} /> Elimina</Button>}
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button disabled={!(amount > 0) || !f.date} onClick={submit}>Salva</Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">Spese fuori dalla spesa al supermercato (es. farmacia, detersivi al mercato, bollette casa): entrano in totali, budget e proiezioni.</p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Importo €">
          <Input inputMode="decimal" value={f.amount} onChange={set('amount')} autoFocus={!extra} />
        </Field>
        <Field label="Data">
          <Input type="date" value={f.date} onChange={set('date')} />
        </Field>
        <Field label="Area">
          <Select value={f.area} onChange={set('area')}>
            {EXTRA_AREAS.map((a) => (
              <option key={a.id} value={a.id}>{a.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Categoria">
          <Input list="extra-cats" value={f.category || ''} onChange={set('category')} placeholder="es. farmacia" />
          <datalist id="extra-cats">
            {cats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>
      <Field label="Nota">
        <Input value={f.note || ''} onChange={set('note')} />
      </Field>
    </Modal>
  );
}

function Prezzi({ fin }) {
  const list = useMemo(() => productsWithPrices(fin), [fin]);
  const [q, setQ] = useState('');
  const [pid, setPid] = useState(null);
  const h = useMemo(() => (pid ? priceHistory(fin, pid) : null), [fin, pid]);
  const s = q.trim().toLowerCase();
  const shown = list.filter((x) => !s || x.p.name.toLowerCase().includes(s)).slice(0, 30);
  const fmt = (v) => `${v.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${h?.unit || ''}`;
  if (!list.length) return <Empty icon={Search}>I prezzi arrivano dai check-in e dagli scontrini.</Empty>;
  return (
    <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] items-start">
      <Box title="Prodotti">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca prodotto…" className="w-full rounded-md bg-bg-elevated border border-bg-border pl-9 pr-3 py-2.5 placeholder:text-text-muted focus:outline-none focus:border-brand" />
        </div>
        <ul className="divide-y divide-bg-border max-h-[50vh] overflow-y-auto">
          {shown.map(({ p, count }) => (
            <li key={p.id}>
              <button type="button" onClick={() => setPid(p.id)} className={`w-full flex justify-between gap-2 py-2 text-sm text-left ${pid === p.id ? 'text-brand font-semibold' : ''}`}>
                <span className="truncate">{p.name}</span>
                <span className="text-text-muted text-xs shrink-0">{count} acquisti</span>
              </button>
            </li>
          ))}
        </ul>
      </Box>
      {h ? (
        <Box title={fin.P[pid].name} icon={TrendingUp}>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Kpi small label="Ultimo" value={fmt(h.last)} tone={h.last <= h.avg ? 'good' : 'bad'} />
            <Kpi small label="Media" value={fmt(h.avg)} />
            <Kpi small label="Minimo" value={fmt(h.min)} />
          </div>
          <PriceLine points={h.points} avg={h.avg} format={(v) => v.toLocaleString('it-IT', { maximumFractionDigits: 2 })} />
          <p className="text-xs text-text-muted">Punti verdi = in offerta. Prezzo “buono” = sotto la tua media ({fmt(h.avg)}).</p>
          {h.byChain.length > 1 && (
            <table className="w-full text-sm">
              <tbody>
                {h.byChain.map((c, i) => (
                  <tr key={c.chain} className="border-t border-bg-border">
                    <td className={`py-1.5 ${i === 0 ? 'text-positive font-semibold' : ''}`}>{c.chain}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.avg)}</td>
                    <td className="py-1.5 text-right text-xs text-text-muted">{c.n}×</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Box>
      ) : (
        <Empty icon={TrendingUp}>Scegli un prodotto per vedere lo storico prezzi.</Empty>
      )}
    </div>
  );
}

function Affari({ fin, month }) {
  const all = useMemo(() => deals(fin), [fin]);
  const m = useMemo(() => deals(fin, month), [fin, month]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Kpi label={`Risparmio ${monthLabel(month).split(' ')[0]}`} value={eur0(m.saved)} tone={m.saved > 0 ? 'good' : null} />
        <Kpi label="Risparmio totale" value={eur0(all.saved)} tone={all.saved > 0 ? 'good' : null} />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Box title="Migliori offerte del mese" icon={BadgePercent}>
          {m.top.length ? (
            <ul className="divide-y divide-bg-border text-sm">
              {m.top.map((l) => (
                <li key={l.id} className="flex justify-between gap-2 py-1.5">
                  <span className="truncate">{l.product.name} <span className="text-text-muted text-xs">· {l.chain} {l.date.slice(8, 10)}/{l.date.slice(5, 7)}</span></span>
                  <span className="text-positive font-semibold shrink-0">−{euro(l.discount)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">Nessuna offerta registrata questo mese.</p>
          )}
        </Box>
        <Box title="Dove conviene" icon={Target}>
          {all.where.length ? (
            <ul className="divide-y divide-bg-border text-sm">
              {all.where.slice(0, 10).map((w) => (
                <li key={w.p.id} className="py-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="truncate font-medium">{w.p.name}</span>
                    <span className="text-positive font-semibold shrink-0">−{Math.round(w.pct)}%</span>
                  </div>
                  <div className="text-xs text-text-muted">
                    {w.best.chain} {w.best.avg.toFixed(2).replace('.', ',')} {w.unit} vs {w.worst.chain} {w.worst.avg.toFixed(2).replace('.', ',')}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">Serve lo stesso prodotto comprato in almeno due supermercati.</p>
          )}
        </Box>
        <Box title="Spesso in offerta: fai scorta" icon={Lightbulb}>
          {all.often.length ? (
            <ul className="divide-y divide-bg-border text-sm">
              {all.often.slice(0, 8).map((o) => (
                <li key={o.p.id} className="flex justify-between gap-2 py-1.5">
                  <span className="truncate">{o.p.name}</span>
                  <span className="text-text-muted text-xs shrink-0">{o.off}/{o.n} in offerta · −{euro(o.saved)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">Servono almeno 3 acquisti dello stesso prodotto.</p>
          )}
        </Box>
      </div>
    </div>
  );
}

function Sprechi({ fin, month }) {
  const m = useMemo(() => wasteStats(fin, month), [fin, month]);
  const all = useMemo(() => wasteStats(fin), [fin]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Kpi label={`Buttato ${monthLabel(month).split(' ')[0]}`} value={eur0(m.total)} sub={`${m.count} ${m.count === 1 ? 'volta' : 'volte'}`} tone={m.total > 0 ? 'bad' : 'good'} />
        <Kpi label="Buttato in tutto" value={eur0(all.total)} sub={`${all.count} ${all.count === 1 ? 'volta' : 'volte'}`} />
      </div>
      {all.count === 0 ? (
        <Empty icon={Trash2}>Niente buttato finora 👏 In Dispensa usa “Buttato” sui lotti scaduti: qui vedrai quanto vale lo spreco.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <Box title="Più sprecati (sempre)" icon={Trash2}>
            <HBars items={all.products.map((x) => ({ label: `${x.p.name} (${x.n}×)`, value: Math.round(x.value * 100) / 100 }))} format={eur0} />
            {all.unknown > 0 && <p className="text-xs text-text-muted">{all.unknown} senza prezzo noto (non contati nel totale).</p>}
          </Box>
          <Box title="Ultimi buttati">
            <ul className="divide-y divide-bg-border text-sm">
              {all.recent.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 py-1.5">
                  <span className="truncate">
                    {fin.P[e.product_id]?.name || '?'} <span className="text-text-muted text-xs">· {fmtQty(e.qty)} {e.unit} · {e.date.split('-').reverse().join('/')}</span>
                  </span>
                  <span className="shrink-0">{e.value != null ? euro(e.value) : '—'}</span>
                </li>
              ))}
            </ul>
          </Box>
        </div>
      )}
    </div>
  );
}
