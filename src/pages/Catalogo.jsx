import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router';
import { Plus, Search, Star, ShieldCheck, Timer } from 'lucide-react';
import { useData } from '../hooks/useData.js';
import { Button, Tabs } from '../components/ui/kit.jsx';
import { ProductForm } from '../components/forms.jsx';
import { put } from '../db/repo.js';
import { fmtQty, minStock, autoAddBelowStock, qtyLabel } from '../db/logic.js';

export default function Catalogo() {
  const data = useData();
  const [params] = useSearchParams();
  const [area, setArea] = useState(params.get('area') || 'cibo');
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [modal, setModal] = useState(null);

  const groups = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    const list = Object.values(data.products).filter(
      (p) =>
        p.area === area &&
        (!s || p.name.toLowerCase().includes(s)) &&
        (filter === 'all' || (filter === 'fav' && p.favorite) || (filter === 'ess' && p.essential))
    );
    const g = {};
    for (const p of list) (g[p.category_id] ||= []).push(p);
    return data.categoryList.filter((c) => g[c.id]).map((c) => ({ c, items: g[c.id].sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [data, area, filter, q]);

  if (!data) return null;
  const toggle = async (p, k) => {
    await put('products', { id: p.id, [k]: p[k] ? 0 : 1 }, `${p.name}: ${k === 'favorite' ? 'preferito' : 'essenziale'} ${p[k] ? 'off' : 'on'}`);
    if (k === 'essential') await autoAddBelowStock();
  };

  const noDur = Object.values(data.products).filter((p) => p.area === 'cibo' && p.category_id !== 'cat-avanzi' && p.pantry_days == null && p.fridge_days == null).length;
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Catalogo</h1>
          <p className="text-text-secondary text-sm">★ preferiti = spesa base · 🛡 essenziali = scorta minima garantita</p>
        </div>
        <Button onClick={() => setModal({})}><Plus size={18} /> Nuovo</Button>
      </div>
      {noDur > 0 && (
        <Link to="/catalogo/durate" className="flex items-center gap-3 rounded-lg border border-brand/50 bg-brand/10 px-4 py-3 hover:border-brand">
          <Timer size={18} className="text-brand shrink-0" />
          <span className="flex-1 text-sm"><b>{noDur} prodotti</b> senza durate: scadenze automatiche spente.</span>
          <span className="text-brand text-sm font-semibold">Imposta →</span>
        </Link>
      )}
      <Tabs value={area} onChange={setArea} tabs={[{ value: 'cibo', label: 'Cibo' }, { value: 'casa', label: 'Casa' }]} />
      <Tabs value={filter} onChange={setFilter} tabs={[{ value: 'all', label: 'Tutti' }, { value: 'fav', label: '★ Preferiti' }, { value: 'ess', label: '🛡 Essenziali' }]} />
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cerca…" className="w-full rounded-md bg-bg-surface border border-bg-border pl-9 pr-3 py-2.5 focus:outline-none focus:border-brand" />
      </div>
      {groups.map(({ c, items }) => (
        <section key={c.id} className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-text-muted px-1">{c.name}</h2>
          <div className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
            {items.map((p) => {
              const m = minStock(p, data.categories);
              const have = data.stock[p.id] || 0;
              return (
                <div key={p.id} className="flex items-center gap-2 px-4 py-2.5">
                  <button type="button" className="flex-1 min-w-0 text-left" onClick={() => setModal({ product: p })}>
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-text-muted">
                      {data.locations[p.default_location_id]?.name} · in casa {qtyLabel(have, p.default_unit, p)}
                      {m != null ? ` / min ${fmtQty(m)}` : ''}
                    </div>
                  </button>
                  <button type="button" aria-label="Preferito" onClick={() => toggle(p, 'favorite')} className="w-10 h-10 flex items-center justify-center">
                    <Star size={20} className={p.favorite ? 'text-brand fill-brand' : 'text-text-muted'} />
                  </button>
                  <button type="button" aria-label="Essenziale" onClick={() => toggle(p, 'essential')} className="w-10 h-10 flex items-center justify-center">
                    <ShieldCheck size={20} className={p.essential ? (have < m ? 'text-brand-accent' : 'text-positive') : 'text-text-muted'} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      {modal && <ProductForm data={data} product={modal.product} area={area} initialName={q} onClose={() => setModal(null)} />}
    </div>
  );
}
