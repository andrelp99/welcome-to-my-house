import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Plus, ListChecks, BookMarked, Search, ChevronDown, Pencil, Snowflake, PackageOpen, Flame, ShieldCheck, Star, Minus, Trash2 } from 'lucide-react';
import { useData, showToast } from '../hooks/useData.js';
import { undo } from '../db/repo.js';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db.js';
import { depletion } from '../db/finance.js';
import { Button, IconButton, Tabs, Stepper, ExpiryBadge, Empty, LEVEL_DOT } from '../components/ui/kit.jsx';
import { LotForm, ProductForm, quickLotAction } from '../components/forms.jsx';
import { lotStatus, LEVEL_ORDER, fmtQty, setTotalQty, minStock, stepFor, closeLot } from '../db/logic.js';

export default function Inventario({ area, title, subtitle }) {
  const data = useData();
  const consumi = useLiveQuery(() => db.events.where('type').equals('consumo').toArray(), []);
  const left = useMemo(() => (data && consumi ? Object.fromEntries(depletion(consumi, data).map((x) => [x.p.id, x.days])) : {}), [data, consumi]);
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [count, setCount] = useState(false);
  const [open, setOpen] = useState(null);
  const [modal, setModal] = useState(null);

  const rows = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    const byProduct = {};
    for (const lot of data.lots) {
      const p = data.products[lot.product_id];
      if (p.area !== area) continue;
      if (tab !== 'all' && tab !== 'soon' && lot.location_id !== tab) continue;
      const st = lotStatus(lot, p, data.locations[lot.location_id]);
      (byProduct[p.id] ||= { p, lots: [] }).lots.push({ lot, st });
    }
    if (count) {
      // in conta rapida mostra anche essenziali/preferiti a zero
      for (const p of Object.values(data.products))
        if (p.area === area && (p.essential || p.favorite) && !byProduct[p.id] && (tab === 'all' || p.default_location_id === tab))
          byProduct[p.id] = { p, lots: [] };
    }
    let list = Object.values(byProduct).map((r) => {
      r.lots.sort((a, b) => LEVEL_ORDER[a.st.level] - LEVEL_ORDER[b.st.level] || (a.st.days ?? 1e9) - (b.st.days ?? 1e9));
      r.worst = r.lots[0]?.st || { level: 'none', days: null };
      r.total = r.lots.reduce((t, x) => t + Number(x.lot.qty), 0);
      r.min = minStock(r.p, data.categories);
      return r;
    });
    if (tab === 'soon') list = list.filter((r) => r.worst.level === 'expired' || r.worst.level === 'soon');
    if (s) list = list.filter((r) => r.p.name.toLowerCase().includes(s));
    const groups = {};
    for (const r of list) (groups[r.p.category_id] ||= []).push(r);
    return data.categoryList
      .filter((c) => groups[c.id])
      .map((c) => ({ c, items: groups[c.id].sort((a, b) => (tab === 'soon' ? LEVEL_ORDER[a.worst.level] - LEVEL_ORDER[b.worst.level] : 0) || a.p.name.localeCompare(b.p.name)) }))
      .concat(groups.undefined ? [{ c: { id: 'x', name: 'Senza categoria' }, items: groups.undefined }] : []);
  }, [data, area, tab, q, count]);

  if (!data) return null;
  const locs = data.locationList.filter((l) => l.area === area);
  const soonCount = data.lots.filter((l) => {
    const p = data.products[l.product_id];
    if (p.area !== area) return false;
    const lv = lotStatus(l, p, data.locations[l.location_id]).level;
    return lv === 'expired' || lv === 'soon';
  }).length;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">{title}</h1>
          <p className="text-text-secondary text-sm">{subtitle}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link to={`/catalogo?area=${area}`} title="Catalogo prodotti" className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-bg-elevated border border-bg-border text-text-secondary">
            <BookMarked size={18} />
          </Link>
          <IconButton label="Conta rapida" onClick={() => setCount((c) => !c)} className={count ? '!bg-brand !text-brand-on !border-brand' : ''}>
            <ListChecks size={18} />
          </IconButton>
          <Button onClick={() => setModal({ kind: 'lot' })}>
            <Plus size={18} /> <span className="hidden sm:inline">Aggiungi</span>
          </Button>
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'Tutto' },
          ...locs.map((l) => ({ value: l.id, label: l.name })),
          { value: 'soon', label: '⚠ In scadenza', count: soonCount || null },
        ]}
      />

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca…" className="w-full rounded-md bg-bg-surface border border-bg-border pl-9 pr-3 py-2.5 focus:outline-none focus:border-brand" />
      </div>

      {count && (
        <div className="rounded-md border border-brand/40 bg-brand-dim/40 px-4 py-3 text-sm">
          <b>Conta rapida:</b> imposta quanto hai davvero. I cali consumano prima i lotti più vicini a scadere. Qui compaiono anche essenziali e preferiti a zero.
        </div>
      )}

      {rows.length === 0 && (
        <Empty icon={area === 'cibo' ? Flame : ShieldCheck}>
          {tab === 'soon' ? 'Niente in scadenza. 👌' : 'Qui è vuoto. Aggiungi qualcosa con “Aggiungi”.'}
        </Empty>
      )}

      {rows.map(({ c, items }) => (
        <section key={c.id} className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-text-muted px-1">{c.name}</h2>
          <div className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border overflow-hidden">
            {items.map((r) => (
              <ProductRow key={r.p.id} r={r} data={data} left={left[r.p.id]} count={count} open={open === r.p.id} onToggle={() => setOpen(open === r.p.id ? null : r.p.id)} setModal={setModal} />
            ))}
          </div>
        </section>
      ))}

      {modal?.kind === 'lot' && <LotForm data={data} area={area} lot={modal.lot} presetProduct={modal.product} onClose={() => setModal(null)} />}
      {modal?.kind === 'product' && <ProductForm data={data} product={modal.product} onClose={() => setModal(null)} />}
    </div>
  );
}

function ProductRow({ r, data, left, count, open, onToggle, setModal }) {
  const { p, lots, worst, total, min } = r;
  const under = min != null && total < min;
  const unit = lots[0]?.lot.unit || p.default_unit;
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${LEVEL_DOT[worst.level]}`} />
        <button type="button" onClick={count ? () => setModal({ kind: 'product', product: p }) : onToggle} className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-1.5 font-medium truncate">
            {p.favorite ? <Star size={13} className="text-brand fill-brand shrink-0" /> : null}
            <span className="truncate">{p.name}</span>
            {under && <span className="shrink-0 text-[10px] font-bold uppercase text-brand-accent border border-brand-accent/50 rounded px-1">scorta</span>}
          </div>
          {!count && (
            <div className="text-xs text-text-muted">
              {fmtQty(total)} {unit}
              {lots.length > 1 ? ` · ${lots.length} lotti` : ''}
              {min != null ? ` · min ${fmtQty(min)}` : ''}
              {left != null && left <= 14 ? ` · finisce ~${left === 0 ? 'oggi' : `${left} gg`}` : ''}
            </div>
          )}
        </button>
        {count ? (
          <Stepper value={total} unit={unit} onChange={(v) => setTotalQty(p, v, data)} />
        ) : (
          <>
            {worst.level !== 'none' && <ExpiryBadge status={worst} />}
            <IconButton label={`Usa ${stepFor(unit)} ${unit}`} onClick={() => setTotalQty(p, Math.max(0, total - stepFor(unit)), data)}>
              <Minus size={16} />
            </IconButton>
            <ChevronDown size={18} onClick={onToggle} className={`text-text-muted transition-transform cursor-pointer ${open ? 'rotate-180' : ''}`} />
          </>
        )}
      </div>
      {open && !count && (
        <div className="bg-bg-base/50 px-4 pb-3 space-y-2">
          {lots.map(({ lot, st }) => {
            const loc = data.locations[lot.location_id];
            const frozen = !!lot.frozen_at;
            return (
              <div key={lot.id} className="flex items-center gap-2 rounded-md bg-bg-surface border border-bg-border px-3 py-2">
                <div className="flex-1 min-w-0 text-sm">
                  <div className="font-semibold">
                    {fmtQty(lot.qty)} {lot.unit} <span className="font-normal text-text-muted">· {loc?.name}</span>
                  </div>
                  <div className="text-xs text-text-muted">
                    {lot.expiry_date ? `scad. ${lot.expiry_date.split('-').reverse().join('/')}` : 'senza scadenza'}
                    {lot.opened_at ? ' · aperto' : ''}
                    {frozen ? ` · congelato ${lot.frozen_at.split('-').reverse().join('/')}` : ''}
                  </div>
                </div>
                <ExpiryBadge status={st} />
                {p.area === 'cibo' && !frozen && !lot.opened_at && (
                  <IconButton label="Aperto oggi" onClick={() => quickLotAction('open', lot, p)}><PackageOpen size={16} /></IconButton>
                )}
                {p.area === 'cibo' && (
                  <IconButton label={frozen ? 'Scongela' : 'Congela'} onClick={() => quickLotAction(frozen ? 'thaw' : 'freeze', lot, p)}>
                    <Snowflake size={16} className={frozen ? 'text-brand' : ''} />
                  </IconButton>
                )}
                {p.area === 'cibo' && (st.level === 'expired' || st.level === 'soon') && (
                  <IconButton
                    label="Buttato"
                    onClick={async () => {
                      await closeLot(lot, p, data, 'buttato');
                      showToast(`Buttato ${p.name}`, { label: 'Annulla', run: () => undo() });
                    }}
                  >
                    <Trash2 size={16} className="text-negative" />
                  </IconButton>
                )}
                <IconButton label="Modifica" onClick={() => setModal({ kind: 'lot', lot })}><Pencil size={16} /></IconButton>
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setModal({ kind: 'lot', product: p })}><Plus size={16} /> Lotto</Button>
            <Button variant="ghost" className="flex-1" onClick={() => setModal({ kind: 'product', product: p })}><Pencil size={16} /> Prodotto</Button>
          </div>
        </div>
      )}
    </div>
  );
}
