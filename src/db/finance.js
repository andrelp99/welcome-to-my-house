import { getDaysInMonth, getDayOfYear, format, parseISO, startOfWeek, addDays, differenceInCalendarDays } from 'date-fns';
import { db, alive } from './db.js';
import { convert } from './recipes.js';

// Prospetto finanziario: tutto calcolato in locale da scontrini, righe, spese extra, budget ed eventi.

export const AREAS = [
  { id: 'cibo', label: 'Cibo' },
  { id: 'casa', label: 'Casa' },
];
export const EXTRA_AREAS = [...AREAS, { id: 'altro', label: 'Altro' }];
export const monthKey = (d) => format(d, 'yyyy-MM');
export const monthLabel = (m) => parseISO(`${m}-01`).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
export const shiftMonth = (m, n) => {
  const d = parseISO(`${m}-01`);
  return format(new Date(d.getFullYear(), d.getMonth() + n, 1), 'yyyy-MM');
};
const r2 = (v) => Math.round(v * 100) / 100;

// Prezzo per unita' confrontabile: €/kg, €/l, €/pz
export function unitPrice(price, qty, unit) {
  if (price == null || !qty) return null;
  const u = unit || 'pz';
  if (u === 'g' || u === 'kg') return { v: price / convert(qty, u, 'kg'), u: '€/kg' };
  if (u === 'ml' || u === 'l') return { v: price / convert(qty, u, 'l'), u: '€/l' };
  return { v: price / qty, u: u === 'conf' ? '€/conf' : '€/pz' };
}

export async function loadFinance() {
  const [receipts, lines, extras, budgets, events, stores, products, categories] = await Promise.all([
    db.receipts.toArray(),
    db.purchase_lines.toArray(),
    db.extra_expenses.toArray(),
    db.budgets.toArray(),
    db.events.toArray(),
    db.stores.toArray(),
    db.products.toArray(),
    db.categories.toArray(),
  ]);
  const P = Object.fromEntries(products.map((p) => [p.id, p])); // anche cancellati: lo storico resta leggibile
  const C = Object.fromEntries(categories.map((c) => [c.id, c]));
  const S = Object.fromEntries(stores.map((s) => [s.id, s]));
  const R = receipts.filter(alive).sort((a, b) => b.date.localeCompare(a.date));
  const RB = Object.fromEntries(R.map((r) => [r.id, r]));
  const L = lines
    .filter((l) => alive(l) && RB[l.receipt_id])
    .map((l) => {
      const r = RB[l.receipt_id];
      const p = P[l.product_id];
      return { ...l, date: r.date, chain: S[r.store_id]?.chain || 'Altro', store: S[r.store_id], area: p?.area || 'altro', category: C[p?.category_id]?.name || 'Altro', product: p };
    });
  // spese: per ogni scontrino le righe per area; la differenza col totale (righe mancanti) va in "altro"
  const byReceipt = {};
  for (const l of L) (byReceipt[l.receipt_id] ||= []).push(l);
  const movements = [];
  for (const r of R) {
    const ls = byReceipt[r.id] || [];
    const sum = ls.reduce((s, l) => s + (l.price_paid || 0), 0);
    const byArea = {};
    for (const l of ls) byArea[l.area] = (byArea[l.area] || 0) + (l.price_paid || 0);
    const gap = (r.total_paid || 0) - sum;
    if (gap > 0.009) byArea.altro = (byArea.altro || 0) + gap;
    movements.push({ kind: 'receipt', id: r.id, date: r.date, amount: r.total_paid ?? sum, byArea, chain: S[r.store_id]?.chain || 'Altro', label: [S[r.store_id]?.chain, S[r.store_id]?.branch].filter(Boolean).join(' ') || 'Spesa', receipt: r, lines: ls, discount: r.total_discount || 0 });
  }
  for (const e of extras.filter(alive)) movements.push({ kind: 'extra', id: e.id, date: e.date, amount: e.amount, byArea: { [e.area]: e.amount }, label: e.category || e.note || 'Spesa extra', extra: e, discount: 0 });
  movements.sort((a, b) => b.date.localeCompare(a.date));
  return { P, C, S, receipts: R, lines: L, movements, budgets: budgets.filter(alive), events: events.filter(alive) };
}

// Budget in vigore: l'ultimo impostato per quel mese o prima (vale finche' non lo cambi)
export function budgetFor(fin, month, area) {
  const b = fin.budgets.filter((x) => x.area === area && x.month <= month).sort((a, b) => b.month.localeCompare(a.month) || b.updated_at - a.updated_at)[0];
  return b ? b.amount : null;
}

export function monthSummary(fin, month) {
  const mv = fin.movements.filter((m) => m.date.startsWith(month));
  const byArea = { cibo: 0, casa: 0, altro: 0 };
  for (const m of mv) for (const [a, v] of Object.entries(m.byArea)) byArea[a] = (byArea[a] || 0) + v;
  const total = mv.reduce((s, m) => s + (m.amount || 0), 0);
  const lines = fin.lines.filter((l) => l.date.startsWith(month));
  const byCategory = {};
  const byChain = {};
  for (const l of lines) byCategory[l.category] = (byCategory[l.category] || 0) + (l.price_paid || 0);
  for (const m of mv.filter((x) => x.kind === 'receipt')) byChain[m.chain] = (byChain[m.chain] || 0) + (m.amount || 0);
  const extra = mv.filter((m) => m.kind === 'extra');
  for (const e of extra) byCategory[e.extra.category || 'Spese extra'] = (byCategory[e.extra.category || 'Spese extra'] || 0) + e.amount;
  const savings = mv.reduce((s, m) => s + (m.discount || 0), 0);
  const waste = fin.events.filter((e) => e.type === 'buttato' && e.date.startsWith(month));
  // proiezione fine mese dal ritmo attuale
  const now = new Date();
  const cur = monthKey(now) === month;
  const days = getDaysInMonth(parseISO(`${month}-01`));
  const elapsed = cur ? now.getDate() : days;
  const projection = cur && elapsed >= 3 ? (total / elapsed) * days : null;
  const projArea = Object.fromEntries(Object.entries(byArea).map(([a, v]) => [a, cur && elapsed >= 3 ? (v / elapsed) * days : v]));
  return {
    month,
    movements: mv,
    total: r2(total),
    byArea: Object.fromEntries(Object.entries(byArea).map(([a, v]) => [a, r2(v)])),
    byCategory: sortEntries(byCategory),
    byChain: sortEntries(byChain),
    savings: r2(savings),
    waste: r2(waste.reduce((s, e) => s + (e.value || 0), 0)),
    wasteCount: waste.length,
    projection: projection != null ? r2(projection) : null,
    projArea,
    elapsed,
    days,
    current: cur,
  };
}
const sortEntries = (o) =>
  Object.entries(o)
    .map(([k, v]) => ({ label: k, value: r2(v) }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value);

export function monthsSeries(fin, month, n = 6) {
  return Array.from({ length: n }, (_, i) => shiftMonth(month, i - n + 1)).map((m) => {
    const s = monthSummary(fin, m);
    return { month: m, label: parseISO(`${m}-01`).toLocaleDateString('it-IT', { month: 'short' }), total: s.total, cibo: s.byArea.cibo, casa: s.byArea.casa };
  });
}

// Settimane del mese (lun-dom) con totale
export function weeksOf(fin, month) {
  const first = parseISO(`${month}-01`);
  const days = getDaysInMonth(first);
  const out = [];
  let ws = startOfWeek(first, { weekStartsOn: 1 });
  while (ws <= addDays(first, days - 1)) {
    const we = addDays(ws, 6);
    const from = format(ws, 'yyyy-MM-dd');
    const to = format(we, 'yyyy-MM-dd');
    const total = fin.movements.filter((m) => m.date >= from && m.date <= to && m.date.startsWith(month)).reduce((s, m) => s + (m.amount || 0), 0);
    out.push({ label: `${ws.getDate()}–${we.getDate()}`, value: r2(total) });
    ws = addDays(ws, 7);
  }
  return out;
}

export function dailyTotals(fin, month) {
  const t = {};
  for (const m of fin.movements) if (m.date.startsWith(month)) t[m.date] = (t[m.date] || 0) + (m.amount || 0);
  return t;
}

export function yearProjection(fin, now = new Date()) {
  const y = String(now.getFullYear());
  const spent = fin.movements.filter((m) => m.date.startsWith(y)).reduce((s, m) => s + (m.amount || 0), 0);
  const first = fin.movements.filter((m) => m.date.startsWith(y)).map((m) => m.date).sort()[0];
  if (!first) return null;
  const since = Math.max(getDayOfYear(parseISO(first)), 1);
  const span = getDayOfYear(now) - since + 1;
  if (span < 14) return { spent: r2(spent), projection: null };
  const daysInYear = (now.getFullYear() % 4 === 0 ? 366 : 365) - since + 1;
  return { spent: r2(spent), projection: r2((spent / span) * daysInYear), partial: since > 1 };
}

// ── Prezzi ──
export function priceHistory(fin, productId) {
  const pts = fin.lines
    .filter((l) => l.product_id === productId && l.price_paid != null && l.qty)
    .map((l) => ({ date: l.date, chain: l.chain, ...unitPrice(l.price_paid, l.qty, l.unit), full: l.price_full ? unitPrice(l.price_full, l.qty, l.unit)?.v : null, discount: l.discount || 0 }))
    .filter((x) => x.v != null && Number.isFinite(x.v))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return null;
  const u = pts[pts.length - 1].u;
  const same = pts.filter((p) => p.u === u);
  const avg = same.reduce((s, p) => s + p.v, 0) / same.length;
  const byChain = {};
  for (const p of same) (byChain[p.chain] ||= []).push(p.v);
  return {
    unit: u,
    points: same,
    avg,
    min: Math.min(...same.map((p) => p.v)),
    last: same[same.length - 1].v,
    byChain: Object.entries(byChain)
      .map(([chain, v]) => ({ chain, avg: v.reduce((s, x) => s + x, 0) / v.length, n: v.length }))
      .sort((a, b) => a.avg - b.avg),
  };
}

export function productsWithPrices(fin) {
  const n = {};
  for (const l of fin.lines) if (l.product && l.price_paid != null) n[l.product_id] = (n[l.product_id] || 0) + 1;
  return Object.entries(n)
    .map(([id, count]) => ({ p: fin.P[id], count }))
    .filter((x) => x.p)
    .sort((a, b) => b.count - a.count || a.p.name.localeCompare(b.p.name, 'it'));
}

// ── Sconti e affari ──
export function deals(fin, month = null) {
  const ls = fin.lines.filter((l) => l.product && (!month || l.date.startsWith(month)));
  const discounted = ls.filter((l) => (l.discount || 0) > 0).sort((a, b) => b.discount - a.discount);
  const stats = {};
  for (const l of ls) {
    const s = (stats[l.product_id] ||= { p: l.product, n: 0, off: 0, saved: 0 });
    s.n++;
    if ((l.discount || 0) > 0) {
      s.off++;
      s.saved += l.discount;
    }
  }
  const often = Object.values(stats)
    .filter((s) => s.n >= 3 && s.off / s.n >= 0.5)
    .sort((a, b) => b.off / b.n - a.off / a.n);
  // dove conviene: stessa unita', almeno 2 catene
  const where = [];
  for (const id of new Set(ls.map((l) => l.product_id))) {
    const h = priceHistory(fin, id);
    if (!h || h.byChain.length < 2) continue;
    const best = h.byChain[0];
    const worst = h.byChain[h.byChain.length - 1];
    const pct = (1 - best.avg / worst.avg) * 100;
    if (pct >= 3) where.push({ p: fin.P[id], best, worst, pct, unit: h.unit });
  }
  where.sort((a, b) => b.pct - a.pct);
  return {
    saved: r2(ls.reduce((s, l) => s + (l.discount || 0), 0)),
    top: discounted.slice(0, 5),
    often,
    where,
  };
}

// ── Sprechi ──
export function wasteStats(fin, month = null) {
  const ev = fin.events.filter((e) => e.type === 'buttato' && (!month || e.date.startsWith(month)));
  const by = {};
  for (const e of ev) {
    const s = (by[e.product_id] ||= { p: fin.P[e.product_id], n: 0, value: 0, qty: 0, unit: e.unit });
    s.n++;
    s.value += e.value || 0;
    s.qty += e.qty || 0;
  }
  return {
    total: r2(ev.reduce((s, e) => s + (e.value || 0), 0)),
    count: ev.length,
    unknown: ev.filter((e) => e.value == null).length,
    products: Object.values(by)
      .filter((x) => x.p)
      .sort((a, b) => b.value - a.value || b.n - a.n),
    recent: ev.sort((a, b) => b.date.localeCompare(a.date) || b.updated_at - a.updated_at).slice(0, 20),
  };
}

// ── Previsione esaurimento: ritmo di consumo degli ultimi 60 giorni ──
export function depletion(events, data, today = new Date()) {
  const since = format(addDays(today, -60), 'yyyy-MM-dd');
  const by = {};
  for (const e of events) {
    if (e.type !== 'consumo' || !e.product_id || e.date < since) continue;
    const p = data.products[e.product_id];
    if (!p) continue;
    const q = convert(Number(e.qty) || 0, e.unit || p.default_unit, p.default_unit);
    if (q == null) continue;
    const s = (by[p.id] ||= { p, qty: 0, first: e.date, n: 0 });
    s.qty += q;
    s.n++;
    if (e.date < s.first) s.first = e.date;
  }
  const out = [];
  for (const s of Object.values(by)) {
    if (s.n < 2) continue;
    const span = Math.max(14, differenceInCalendarDays(today, parseISO(s.first)) + 1);
    const rate = s.qty / span; // al giorno
    const have = data.stock[s.p.id] || 0;
    if (rate <= 0 || have <= 0) continue;
    out.push({ p: s.p, rate, have, days: Math.floor(have / rate) });
  }
  return out.sort((a, b) => a.days - b.days);
}

// ── Indicazioni automatiche ──
export function insights(fin, month) {
  const out = [];
  const s = monthSummary(fin, month);
  // ritmo vs media 3 mesi precedenti, allo stesso giorno del mese
  const prev = [1, 2, 3].map((i) => shiftMonth(month, -i));
  const prevAt = prev
    .map((m) => fin.movements.filter((x) => x.date.startsWith(m) && Number(x.date.slice(8, 10)) <= s.elapsed).reduce((t, x) => t + (x.amount || 0), 0))
    .filter((v) => v > 0);
  if (s.current && prevAt.length >= 2 && s.total > 0) {
    const avg = prevAt.reduce((a, b) => a + b, 0) / prevAt.length;
    const pct = Math.round((s.total / avg - 1) * 100);
    if (Math.abs(pct) >= 8) out.push({ tone: pct > 0 ? 'warn' : 'good', text: `Questo mese stai spendendo ${pct > 0 ? '+' : ''}${pct}% rispetto alla media degli ultimi mesi (a oggi).` });
  }
  for (const a of AREAS) {
    const b = budgetFor(fin, month, a.id);
    if (!b || !s.current) continue;
    const proj = s.projArea[a.id] || 0;
    if (s.byArea[a.id] > b) out.push({ tone: 'bad', text: `Budget ${a.label.toLowerCase()} superato di ${eur(s.byArea[a.id] - b)}.` });
    else if (proj > b * 1.03) out.push({ tone: 'warn', text: `A questo ritmo sfori il budget ${a.label.toLowerCase()} di circa ${eur(proj - b)}.` });
  }
  const d = deals(fin);
  for (const w of d.where.filter((x) => x.pct >= 10).slice(0, 3))
    out.push({ tone: 'good', text: `${w.p.name}: da ${w.best.chain} costa il ${Math.round(w.pct)}% in meno che da ${w.worst.chain}.` });
  for (const o of d.often.slice(0, 2)) out.push({ tone: 'info', text: `${o.p.name} lo prendi quasi sempre in offerta (${o.off}/${o.n}): quando lo trovi scontato fai scorta.` });
  const w = wasteStats(fin, month);
  if (w.total > 0) out.push({ tone: 'warn', text: `Questo mese hai buttato ${eur(w.total)} di cibo${w.products[0] ? `; il più sprecato: ${w.products[0].p.name}` : ''}.` });
  return out;
}
const eur = (v) => v.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
