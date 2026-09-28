// Grafici minimi in HTML/SVG, colori dai token del tema (chiaro/scuro automatico, niente librerie).

export function Bars({ items, format = (v) => v, height = 140, refValue = null, refLabel = '' }) {
  const max = Math.max(...items.map((i) => i.value), refValue || 0, 1);
  return (
    <div>
      <div className="relative flex items-end gap-1.5" style={{ height }}>
        {refValue ? (
          <div className="absolute inset-x-0 border-t border-dashed border-brand-accent" style={{ bottom: `${(refValue / max) * 100}%` }}>
            <span className="absolute right-0 -top-4 text-[10px] text-brand-accent">{refLabel}</span>
          </div>
        ) : null}
        {items.map((i, n) => (
          <div key={n} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full" title={`${i.label}: ${format(i.value)}`}>
            <span className="text-[10px] text-text-muted tabular-nums mb-0.5 truncate max-w-full">{i.value ? format(i.value) : ''}</span>
            <div className={`w-full rounded-t ${i.highlight ? 'bg-brand' : 'bg-brand/50'}`} style={{ height: `${Math.max(i.value ? 2 : 0, (i.value / max) * 100)}%`, maxHeight: 'calc(100% - 14px)' }} />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1">
        {items.map((i, n) => (
          <span key={n} className="flex-1 min-w-0 text-center text-[10px] text-text-muted truncate">{i.label}</span>
        ))}
      </div>
    </div>
  );
}

// Barre orizzontali per classifiche (categorie, supermercati, prodotti)
export function HBars({ items, format = (v) => v, max = 8 }) {
  const top = items.slice(0, max);
  const m = Math.max(...top.map((i) => i.value), 1);
  return (
    <ul className="space-y-2">
      {top.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{i.label}</span>
            <span className="tabular-nums font-semibold shrink-0">{format(i.value)}</span>
          </div>
          <div className="h-1.5 rounded-full bg-bg-elevated overflow-hidden mt-1">
            <div className="h-full bg-brand" style={{ width: `${(i.value / m) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Linea prezzi nel tempo; punti in offerta evidenziati, media tratteggiata
export function PriceLine({ points, avg, format = (v) => v, height = 160 }) {
  if (!points.length) return null;
  const W = 300;
  const H = 100;
  const vs = points.map((p) => p.v);
  const lo = Math.min(...vs, avg) * 0.95;
  const hi = Math.max(...vs, avg) * 1.05 || 1;
  const x = (i) => (points.length === 1 ? W / 2 : (i / (points.length - 1)) * W);
  const y = (v) => H - ((v - lo) / (hi - lo || 1)) * H;
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return (
    <div>
      <div className="flex justify-between text-[10px] text-text-muted">
        <span>{format(hi)}</span>
        <span className="text-brand-accent">media {format(avg)}</span>
      </div>
      <div className="relative" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible">
          <line x1="0" x2={W} y1={y(avg)} y2={y(avg)} stroke="rgb(var(--brand-accent))" strokeDasharray="4 4" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          <path d={d} fill="none" stroke="rgb(var(--brand-primary))" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        </svg>
        {points.map((p, i) => (
          <span
            key={i}
            title={`${p.date} · ${p.chain} · ${format(p.v)}${p.discount > 0 ? ' (offerta)' : ''}`}
            className={`absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full ring-2 ring-bg-surface ${p.discount > 0 ? 'bg-positive' : 'bg-brand'}`}
            style={{ left: `${(x(i) / W) * 100}%`, top: `${(y(p.v) / H) * 100}%` }}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-text-muted">
        <span>{points[0].date.split('-').reverse().join('/')}</span>
        <span>{format(lo)}</span>
        <span>{points[points.length - 1].date.split('-').reverse().join('/')}</span>
      </div>
    </div>
  );
}

// Avanzamento budget: speso, proiezione (tratteggio), limite
export function BudgetBar({ spent, projection, budget, format }) {
  const max = Math.max(budget, projection || 0, spent, 1);
  const over = spent > budget;
  const projOver = projection != null && projection > budget;
  return (
    <div className="space-y-1">
      <div className="relative h-3 rounded-full bg-bg-elevated overflow-hidden">
        {projection != null && <div className={`absolute inset-y-0 left-0 ${projOver ? 'bg-negative/25' : 'bg-brand/20'}`} style={{ width: `${(projection / max) * 100}%` }} />}
        <div className={`absolute inset-y-0 left-0 rounded-full ${over ? 'bg-negative' : 'bg-brand'}`} style={{ width: `${(spent / max) * 100}%` }} />
        <div className="absolute inset-y-0 w-0.5 bg-text-primary" style={{ left: `${(budget / max) * 100}%` }} />
      </div>
      <div className="flex justify-between text-xs text-text-muted">
        <span className={over ? 'text-negative font-semibold' : ''}>{format(spent)} su {format(budget)}</span>
        {projection != null && <span className={projOver ? 'text-negative' : ''}>fine mese ~{format(projection)}</span>}
      </div>
    </div>
  );
}
