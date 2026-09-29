import { useEffect, useMemo, useState } from 'react';
import { X, Minus, Plus, Search, PlusCircle } from 'lucide-react';
import { stepFor, fmtQty, daysLabel } from '../../db/logic.js';

export function Button({ variant = 'primary', className = '', ...props }) {
  const v = {
    primary: 'bg-brand text-brand-on hover:bg-brand-light',
    danger: 'bg-brand-accent text-white hover:opacity-90',
    ghost: 'bg-bg-elevated border border-bg-border text-text-primary hover:bg-bg-hover',
    text: 'text-brand hover:underline px-1',
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-40 ${v} ${className}`}
      {...props}
    />
  );
}

export function IconButton({ label, className = '', ...props }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center w-10 h-10 rounded-md bg-bg-elevated border border-bg-border text-text-secondary hover:text-text-primary hover:bg-bg-hover disabled:opacity-40 ${className}`}
      {...props}
    />
  );
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end md:items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full md:max-w-lg max-h-[92vh] flex flex-col bg-bg-surface border border-bg-border rounded-t-lg md:rounded-lg shadow-elevated"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-bg-border">
          <h2 className="font-bold text-lg">{title}</h2>
          <IconButton label="Chiudi" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">{children}</div>
        {footer && (
          <div className="px-5 py-4 border-t border-bg-border flex gap-2 justify-end" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">{label}</span>
      {children}
      {hint && <span className="block text-xs text-text-muted">{hint}</span>}
    </label>
  );
}

const inputCls =
  'w-full rounded-md bg-bg-elevated border border-bg-border px-3 py-2.5 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand';

export function Input(props) {
  return <input className={inputCls} {...props} />;
}
export function Select({ children, ...props }) {
  return (
    <select className={inputCls} {...props}>
      {children}
    </select>
  );
}

export function Toggle({ checked, onChange, label }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-3 text-sm font-medium ${checked ? 'text-text-primary' : 'text-text-secondary'}`}
    >
      <span className={`relative w-10 h-6 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-bg-border'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label}
    </button>
  );
}

export function Stepper({ value, unit, onChange, min = 0 }) {
  const step = stepFor(unit);
  return (
    <div className="inline-flex items-center rounded-md border border-bg-border bg-bg-elevated">
      <button type="button" aria-label="Meno" className="w-10 h-10 flex items-center justify-center text-text-secondary disabled:opacity-30" disabled={value <= min} onClick={() => onChange(Math.max(min, Math.round((value - step) * 1000) / 1000))}>
        <Minus size={16} />
      </button>
      <span className="min-w-[3.5rem] text-center font-semibold tabular-nums text-sm">
        {fmtQty(value)} <span className="text-text-muted font-normal">{unit}</span>
      </span>
      <button type="button" aria-label="Più" className="w-10 h-10 flex items-center justify-center text-text-secondary" onClick={() => onChange(Math.round((value + step) * 1000) / 1000)}>
        <Plus size={16} />
      </button>
    </div>
  );
}

const LEVEL_CLS = {
  expired: 'bg-negative/15 text-negative border-negative/40',
  soon: 'bg-warning/15 text-warning border-warning/40',
  ok: 'bg-positive/15 text-positive border-positive/40',
  none: 'bg-bg-elevated text-text-muted border-bg-border',
};
export const LEVEL_DOT = { expired: 'bg-negative', soon: 'bg-warning', ok: 'bg-positive', none: 'bg-bg-border' };

export function ExpiryBadge({ status }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${LEVEL_CLS[status.level]}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${LEVEL_DOT[status.level]}`} />
      {daysLabel(status.days)}
    </span>
  );
}

// Ricerca prodotto nel catalogo con creazione al volo.
// prefer = categoria da proporre per prima (es. alternative e sostituti: stessa categoria del prodotto).
export function ProductPicker({ products, area, onPick, onCreate, placeholder = 'Cerca prodotto…', autoFocus, prefer }) {
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const all = Object.values(products).filter((p) => (!area || p.area === area) && p.category_id !== 'cat-avanzi');
    const s = q.trim().toLowerCase();
    const res = s ? all.filter((p) => p.name.toLowerCase().includes(s)) : prefer ? all.filter((p) => p.category_id === prefer) : all.filter((p) => p.favorite);
    return res.sort((a, b) => {
      const ca = prefer && a.category_id === prefer ? 0 : 1;
      const cb = prefer && b.category_id === prefer ? 0 : 1;
      const sa = a.name.toLowerCase().startsWith(s) ? 0 : 1;
      const sb = b.name.toLowerCase().startsWith(s) ? 0 : 1;
      return ca - cb || sa - sb || a.name.localeCompare(b.name);
    }).slice(0, prefer && !s ? 24 : 12);
  }, [products, area, q, prefer]);
  const exact = list.some((p) => p.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input className={`${inputCls} pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
      </div>
      <div className="flex flex-wrap gap-2">
        {list.map((p) => (
          <button key={p.id} type="button" onClick={() => { onPick(p); setQ(''); }} className="rounded-full border border-bg-border bg-bg-elevated px-3 py-1.5 text-sm hover:border-brand">
            {p.favorite ? '★ ' : ''}{p.name}
          </button>
        ))}
        {q.trim() && !exact && onCreate && (
          <button type="button" onClick={() => { onCreate(q.trim()); setQ(''); }} className="inline-flex items-center gap-1 rounded-full border border-dashed border-brand text-brand px-3 py-1.5 text-sm">
            <PlusCircle size={14} /> Nuovo: “{q.trim()}”
          </button>
        )}
        {!q.trim() && list.length === 0 && <span className="text-xs text-text-muted">{prefer ? 'Nessun altro prodotto in questa categoria: scrivi per cercare' : 'Scrivi per cercare (vuoto = preferiti ★)'}</span>}
      </div>
    </div>
  );
}

export function Empty({ icon: Icon, children }) {
  return (
    <div className="text-center py-10 text-text-muted space-y-2">
      {Icon && <Icon size={32} className="mx-auto opacity-60" />}
      <p className="text-sm">{children}</p>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 md:mx-0 md:px-0">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium border ${
            value === t.value ? 'bg-brand text-brand-on border-brand' : 'bg-bg-surface border-bg-border text-text-secondary'
          }`}
        >
          {t.label}
          {t.count != null && <span className="ml-1.5 opacity-70">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}
