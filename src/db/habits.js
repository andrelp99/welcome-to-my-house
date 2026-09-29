import { differenceInCalendarDays, parseISO, addDays, format } from 'date-fns';

// Abitudini di spesa: calcolate dagli scontrini del check-in (fin = loadFinance()).
const WD = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
const wdOf = (iso) => (parseISO(iso).getDay() + 6) % 7;

export function shoppingHabits(fin, today = new Date()) {
  const lineSum = {};
  for (const l of fin.lines) lineSum[l.receipt_id] = (lineSum[l.receipt_id] || 0) + (l.price_paid || 0);
  const tot = (r) => r.total_paid ?? lineSum[r.id] ?? 0;
  const rs = [...fin.receipts].sort((a, b) => a.date.localeCompare(b.date));
  const n = rs.length;
  const gaps = [];
  for (let i = 1; i < n; i++) gaps.push(differenceInCalendarDays(parseISO(rs[i].date), parseISO(rs[i - 1].date)));
  const spanMonths = n ? Math.max(1, differenceInCalendarDays(today, parseISO(rs[0].date)) / 30.4) : 1;
  const byWd = WD.map((label, i) => ({ label, value: rs.filter((r) => wdOf(r.date) === i).length }));
  const byChain = {};
  for (const r of rs) {
    const c = fin.S[r.store_id]?.chain || 'Altro';
    byChain[c] ||= { label: c, value: 0, total: 0 };
    byChain[c].value++;
    byChain[c].total += tot(r);
  }
  const totals = rs.map(tot).filter((x) => x > 0);
  // mesi: spese per mese (ultimi 6)
  return {
    count: n,
    perMonth: n / spanMonths,
    avgGap: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    lastDate: n ? rs[n - 1].date : null,
    avgTicket: totals.length ? totals.reduce((a, b) => a + b, 0) / totals.length : null,
    byWd,
    byChain: Object.values(byChain).sort((a, b) => b.value - a.value),
  };
}

// Per prodotto: volte, quantita', spesa, intervallo medio tra acquisti, prossimo previsto, ultimo acquisto.
export function productHabits(fin, today = new Date()) {
  const by = {};
  for (const l of fin.lines) {
    if (!l.product_id || !l.product) continue;
    const x = (by[l.product_id] ||= { p: l.product, dates: [], qty: 0, unit: l.unit, spent: 0, lines: [], fromList: 0, known: 0, months: new Array(12).fill(0) });
    x.dates.push(l.date);
    x.qty += Number(l.qty) || 0;
    x.spent += l.price_paid || 0;
    x.lines.push(l);
    x.months[parseISO(l.date).getMonth()]++;
    if (l.from_list != null) {
      x.known++;
      if (l.from_list) x.fromList++;
    }
  }
  const out = Object.values(by).map((x) => {
    const days = [...new Set(x.dates)].sort();
    const gaps = [];
    for (let i = 1; i < days.length; i++) gaps.push(differenceInCalendarDays(parseISO(days[i]), parseISO(days[i - 1])));
    const every = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null;
    const last = days[days.length - 1];
    const since = differenceInCalendarDays(today, parseISO(last));
    const next = every ? format(addDays(parseISO(last), Math.round(every)), 'yyyy-MM-dd') : null;
    return { ...x, times: days.length, every, last, since, next, lines: x.lines.sort((a, b) => b.date.localeCompare(a.date)) };
  });
  const bought = (id) => out.find((x) => x.p.id === id);
  return {
    all: out,
    top: [...out].sort((a, b) => b.times - a.times || b.spent - a.spent),
    topSpent: [...out].sort((a, b) => b.spent - a.spent),
    once: out.filter((x) => x.times === 1).sort((a, b) => b.last.localeCompare(a.last)),
    // "non lo compri piu'": fermo da oltre il doppio del suo intervallo (min 45 gg)
    stopped: out.filter((x) => x.every && x.since > Math.max(45, 2 * x.every)).sort((a, b) => b.since - a.since),
    dueSoon: out.filter((x) => x.next && x.times >= 3).sort((a, b) => a.next.localeCompare(b.next)).slice(0, 12),
    bought,
  };
}

// Fuori lista: righe con from_list noto (check-in dalla 0.12)
export function offList(fin) {
  const known = fin.lines.filter((l) => l.from_list != null);
  const off = known.filter((l) => !l.from_list);
  const byP = {};
  for (const l of off) if (l.product) (byP[l.product.id] ||= { label: l.product.name, value: 0 }).value++;
  return { known: known.length, off: off.length, spentOff: off.reduce((s, l) => s + (l.price_paid || 0), 0), top: Object.values(byP).sort((a, b) => b.value - a.value) };
}

// Comprato e buttato: quota buttata per prodotto (eventi "buttato" vs quantita' comprata)
export function boughtVsWasted(fin, ph) {
  const w = {};
  for (const e of fin.events) if (e.type === 'buttato' && e.product_id) w[e.product_id] = (w[e.product_id] || 0) + (Number(e.qty) || 0);
  return Object.entries(w)
    .map(([id, q]) => {
      const b = ph.bought(id);
      return b ? { p: b.p, wasted: q, bought: b.qty, pct: b.qty ? Math.min(100, Math.round((q / b.qty) * 100)) : null, unit: b.unit } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
}

// Categorie per mese (ultimi n mesi): [{ month, parts: { categoria: euro } }]
export function categoriesByMonth(fin, n = 6, today = new Date()) {
  const months = [];
  for (let i = n - 1; i >= 0; i--) months.push(format(new Date(today.getFullYear(), today.getMonth() - i, 1), 'yyyy-MM'));
  const cats = {};
  const rows = months.map((m) => {
    const parts = {};
    for (const l of fin.lines) if (l.date.startsWith(m) && l.area === 'cibo') parts[l.category] = (parts[l.category] || 0) + (l.price_paid || 0);
    for (const [k, v] of Object.entries(parts)) cats[k] = (cats[k] || 0) + v;
    return { month: m, parts };
  });
  const top = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
  return { months: rows, top };
}
