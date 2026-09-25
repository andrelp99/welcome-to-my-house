import { useMemo, useState } from 'react';
import { ShoppingCart, Star, Trash2, Check, Store, Receipt, ShieldCheck } from 'lucide-react';
import { useData, showToast } from '../hooks/useData.js';
import { Button, IconButton, Modal, Field, Input, Select, Stepper, ProductPicker, Empty } from '../components/ui/kit.jsx';
import { put, save, undo } from '../db/repo.js';
import { euro, fmtQty, todayISO, autoAddBelowStock, belowStock } from '../db/logic.js';
import { uuid } from '../db/db.js';

const ORIGIN = { scorta: { label: 'scorta', cls: 'text-brand-accent border-brand-accent/50' }, preferito: { label: '★', cls: 'text-brand border-brand/50' } };

export default function Spesa() {
  const data = useData();
  const [checkin, setCheckin] = useState(false);

  const groups = useMemo(() => {
    if (!data) return { list: [], total: 0, known: 0 };
    let total = 0;
    let known = 0;
    const g = {};
    for (const it of data.shopping) {
      const p = data.products[it.product_id];
      const price = p && data.lastPrice[p.id] != null ? data.lastPrice[p.id] * (it.qty || 1) : null;
      if (price != null) { total += price; known++; }
      const key = p ? p.category_id : 'libero';
      (g[key] ||= []).push({ it, p, price });
    }
    const list = data.categoryList
      .filter((c) => g[c.id])
      .map((c) => ({ c, items: g[c.id] }))
      .concat(g.libero ? [{ c: { id: 'libero', name: 'Altro' }, items: g.libero }] : []);
    for (const x of list) x.items.sort((a, b) => a.it.checked - b.it.checked || (a.p?.name || a.it.free_text).localeCompare(b.p?.name || b.it.free_text));
    return { list, total, known };
  }, [data]);

  if (!data) return null;
  const inList = new Set(data.shopping.map((s) => s.product_id).filter(Boolean));
  const checked = data.shopping.filter((s) => s.checked);

  async function addProduct(p) {
    if (inList.has(p.id)) return showToast(`${p.name} è già in lista`);
    await put('shopping_items', { product_id: p.id, qty: 1, unit: p.default_unit, origin: 'manuale', checked: 0 }, `In lista: ${p.name}`);
  }
  async function addFree(text) {
    await put('shopping_items', { free_text: text, qty: 1, unit: 'pz', origin: 'manuale', checked: 0 }, `In lista: ${text}`);
  }
  async function addFavorites() {
    const ops = Object.values(data.products)
      .filter((p) => p.favorite && !inList.has(p.id))
      .map((p) => ({ table: 'shopping_items', row: { product_id: p.id, qty: 1, unit: p.default_unit, origin: 'preferito', checked: 0 } }));
    if (!ops.length) return showToast('Preferiti già tutti in lista (o nessun preferito ★)');
    await save(ops, `Aggiunti ${ops.length} preferiti`);
    showToast(`Aggiunti ${ops.length} preferiti`, { label: 'Annulla', run: () => undo() });
  }
  async function addBelow() {
    const n = await autoAddBelowStock();
    showToast(n ? `Aggiunti ${n} essenziali sotto scorta` : 'Nessun essenziale sotto scorta da aggiungere');
  }
  async function clearChecked() {
    await save(checked.map((s) => ({ table: 'shopping_items', row: { id: s.id, deleted: 1 } })), 'Svuotati spuntati');
    showToast('Tolti gli spuntati', { label: 'Annulla', run: () => undo() });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Lista spesa</h1>
          <p className="text-text-secondary text-sm">
            {data.shopping.length} voci · stima {euro(groups.total)}
            {groups.known < data.shopping.length && groups.known > 0 ? ` (prezzo noto per ${groups.known})` : ''}
          </p>
        </div>
        <Button onClick={() => setCheckin(true)} disabled={!checked.length}>
          <Receipt size={18} /> Check-in{checked.length ? ` (${checked.length})` : ''}
        </Button>
      </div>

      <div className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <ProductPicker products={data.products} onPick={addProduct} onCreate={addFree} placeholder="Aggiungi alla lista…" />
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={addFavorites}><Star size={16} /> Preferiti</Button>
          <Button variant="ghost" onClick={addBelow}><ShieldCheck size={16} /> Sotto scorta ({belowStock(data).length})</Button>
          {checked.length > 0 && <Button variant="ghost" onClick={clearChecked}><Trash2 size={16} /> Togli spuntati</Button>}
        </div>
      </div>

      {data.shopping.length === 0 && <Empty icon={ShoppingCart}>Lista vuota. Aggiungi prodotti, preferiti o essenziali sotto scorta.</Empty>}

      {groups.list.map(({ c, items }) => (
        <section key={c.id} className="space-y-2">
          <h2 className="text-xs uppercase tracking-wider font-semibold text-text-muted px-1">{c.name}</h2>
          <div className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
            {items.map(({ it, p, price }) => {
              const name = p?.name || it.free_text;
              const o = ORIGIN[it.origin];
              return (
                <div key={it.id} className={`flex items-center gap-3 px-3 py-2.5 ${it.checked ? 'opacity-50' : ''}`}>
                  <button
                    type="button"
                    aria-label={it.checked ? 'Togli dal carrello' : 'Nel carrello'}
                    onClick={() => put('shopping_items', { id: it.id, checked: it.checked ? 0 : 1 })}
                    className={`w-7 h-7 shrink-0 rounded-md border-2 flex items-center justify-center ${it.checked ? 'bg-brand border-brand text-brand-on' : 'border-bg-border'}`}
                  >
                    {it.checked ? <Check size={16} strokeWidth={3} /> : null}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium truncate ${it.checked ? 'line-through' : ''}`}>
                      {name}
                      {o && <span className={`ml-1.5 text-[10px] font-bold uppercase border rounded px-1 ${o.cls}`}>{o.label}</span>}
                    </div>
                    <div className="text-xs text-text-muted">
                      {price != null ? `~${euro(price)}` : 'prezzo ?'}
                      {p ? ` · in casa ${fmtQty(data.stock[p.id] || 0)} ${p.default_unit}` : ''}
                      {p?.alternatives ? ` · ok anche: ${p.alternatives}` : ''}
                    </div>
                  </div>
                  <Stepper value={Number(it.qty || 1)} unit={it.unit || 'pz'} min={0} onChange={(v) => put('shopping_items', { id: it.id, qty: v })} />
                  <IconButton label="Togli" onClick={async () => { await put('shopping_items', { id: it.id, deleted: 1 }, `Tolto ${name}`); showToast(`Tolto ${name}`, { label: 'Annulla', run: () => undo() }); }}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {checkin && <CheckIn data={data} items={checked} onClose={() => setCheckin(false)} />}
    </div>
  );
}

// Check-in: dove, quanto pagato, sconto, dove lo metto, scadenza -> scontrino + righe + lotti in casa.
function CheckIn({ data, items, onClose }) {
  const chains = [...new Set(data.stores.map((s) => s.chain))];
  const [chain, setChain] = useState(chains[0] || '');
  const [storeId, setStoreId] = useState(data.stores.find((s) => s.chain === chains[0])?.id || '');
  const [newBranch, setNewBranch] = useState('');
  const [date, setDate] = useState(todayISO());
  const [lines, setLines] = useState(() =>
    items.map((it) => {
      const p = data.products[it.product_id];
      const last = p ? data.lastPrice[p.id] : null;
      return {
        it, p,
        qty: Number(it.qty || 1),
        price_paid: last != null ? (last * Number(it.qty || 1)).toFixed(2) : '',
        price_full: '',
        location_id: p?.default_location_id || 'loc-altro',
        expiry_date: '',
      };
    })
  );
  const upd = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const n = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
  const total = lines.reduce((s, l) => s + (n(l.price_paid) || 0), 0);
  const discount = lines.reduce((s, l) => s + (n(l.price_full) != null && n(l.price_paid) != null ? n(l.price_full) - n(l.price_paid) : 0), 0);
  const branches = data.stores.filter((s) => s.chain === chain);

  async function confirm() {
    const ops = [];
    let sid = storeId;
    if (storeId === 'new' && newBranch.trim()) {
      sid = uuid();
      ops.push({ table: 'stores', row: { id: sid, chain, branch: newBranch.trim() } });
    }
    const rid = uuid();
    ops.push({ table: 'receipts', row: { id: rid, store_id: sid === 'new' ? null : sid, date, total_paid: Math.round(total * 100) / 100, total_discount: Math.round(discount * 100) / 100 } });
    for (const l of lines) {
      const plid = uuid();
      const paid = n(l.price_paid);
      const full = n(l.price_full);
      ops.push({
        table: 'purchase_lines',
        row: { id: plid, receipt_id: rid, product_id: l.p?.id || null, qty: l.qty, unit: l.it.unit || l.p?.default_unit || 'pz', price_paid: paid, price_full: full, discount: full != null && paid != null ? Math.round((full - paid) * 100) / 100 : null },
      });
      if (l.p && l.qty > 0)
        ops.push({
          table: 'stock_lots',
          row: { product_id: l.p.id, qty: l.qty, unit: l.it.unit || l.p.default_unit, location_id: l.location_id, expiry_date: l.expiry_date || null, frozen_at: l.location_id === 'loc-freezer' ? date : null, purchase_line_id: plid },
        });
      ops.push({ table: 'shopping_items', row: { id: l.it.id, deleted: 1 } });
    }
    await save(ops, `Spesa ${chain} ${euro(total)}`);
    showToast(`Spesa registrata: ${euro(total)}`, { label: 'Annulla', run: () => undo() });
    onClose();
  }

  return (
    <Modal
      title="Check-in spesa"
      onClose={onClose}
      footer={
        <>
          <div className="mr-auto text-sm">
            <div className="font-bold">{euro(total)}</div>
            {discount > 0 && <div className="text-positive text-xs">risparmio {euro(discount)}</div>}
          </div>
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button onClick={confirm} disabled={storeId === 'new' && !newBranch.trim()}>Registra</Button>
        </>
      }
    >
      <Field label="Supermercato">
        <div className="flex flex-wrap gap-2">
          {chains.map((c) => (
            <button key={c} type="button" onClick={() => { setChain(c); setStoreId(data.stores.find((s) => s.chain === c)?.id || ''); }}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${chain === c ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
              <Store size={14} /> {c}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Punto vendita">
          <Select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {branches.map((s) => <option key={s.id} value={s.id}>{s.branch || '(generico)'}</option>)}
            <option value="new">+ nuovo punto vendita…</option>
          </Select>
        </Field>
        <Field label="Data">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      {storeId === 'new' && (
        <Field label="Nome punto vendita" hint="es. Crema via Milano">
          <Input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} autoFocus />
        </Field>
      )}

      <div className="space-y-3">
        {lines.map((l, i) => (
          <div key={l.it.id} className="rounded-md border border-bg-border bg-bg-elevated/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold truncate">{l.p?.name || l.it.free_text}</span>
              <Stepper value={l.qty} unit={l.it.unit || 'pz'} onChange={(v) => upd(i, 'qty', v)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input inputMode="decimal" placeholder="Pagato €" value={l.price_paid} onChange={(e) => upd(i, 'price_paid', e.target.value)} />
              <Input inputMode="decimal" placeholder="Prezzo pieno € (se scontato)" value={l.price_full} onChange={(e) => upd(i, 'price_full', e.target.value)} />
            </div>
            {l.p && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={l.location_id} onChange={(e) => upd(i, 'location_id', e.target.value)}>
                  {data.locationList.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
                {l.p.area === 'cibo' || l.location_id === 'loc-farmacia' ? (
                  <Input type="date" value={l.expiry_date} onChange={(e) => upd(i, 'expiry_date', e.target.value)} aria-label="Scadenza" />
                ) : <span />}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  );
}
