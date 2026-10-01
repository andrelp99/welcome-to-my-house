import { useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, Star, Trash2, Check, Store, Receipt, ShieldCheck, ScanLine, Loader2, Sparkles, Share2, ShoppingBasket } from 'lucide-react';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { useData, showToast } from '../hooks/useData.js';
import { Button, IconButton, Modal, Field, Input, Select, Stepper, ProductPicker, Empty } from '../components/ui/kit.jsx';
import { put, save, undo } from '../db/repo.js';
import { euro, fmtQty, todayISO, autoAddBelowStock, belowStock, allowedLocation, autoExpiry } from '../db/logic.js';
import { uuid } from '../db/db.js';
import { readReceipt, normRaw, lineQty, DRAFT_PREFIX, saveDraft, deleteDraft, newDraftId, draftFromJson } from '../db/receipt.js';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db.js';
import { ProductForm } from '../components/forms.jsx';
import { PhotoList } from './RicettaImport.jsx';

const ORIGIN = { scorta: { label: 'scorta', cls: 'text-brand-accent border-brand-accent/50' }, preferito: { label: '★', cls: 'text-brand border-brand/50' }, ricetta: { label: 'ricetta', cls: 'text-positive border-positive/50' }, planner: { label: 'planner', cls: 'text-positive border-positive/50' } };

export default function Spesa() {
  const data = useData();
  const [checkin, setCheckin] = useState(false);
  const [scan, setScan] = useState(false);
  const [ocr, setOcr] = useState(null);
  const [shop, setShop] = useState(false);
  const awake = useWakeLock(shop);
  const drafts = useLiveQuery(() => db.settings.where('id').startsWith(DRAFT_PREFIX).toArray(), []);
  const [askDel, setAskDel] = useState(null);

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
  // stima per supermercato: solo prodotti con un prezzo noto in ogni catena confrontata, cosi' e' equa
  const open = data.shopping.filter((s) => s.product_id && !s.checked);
  const chains = Object.keys(data.lastPriceByChain);
  const common = open.filter((s) => chains.every((c) => data.lastPriceByChain[c][s.product_id] != null));
  const byChain = common.length
    ? chains
        .map((chain) => ({ chain, n: open.length, known: common.length, total: common.reduce((t, s) => t + data.lastPriceByChain[chain][s.product_id] * (s.qty || 1), 0) }))
        .sort((a, b) => a.total - b.total)
    : [];
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
  // Lista come testo (WhatsApp ecc.): solo cio' che resta da prendere, per categoria
  async function shareList() {
    const lines = ['🛒 Lista spesa'];
    for (const { c, items } of groups.list) {
      const todo = items.filter((x) => !x.it.checked);
      if (!todo.length) continue;
      lines.push('', `${c.name}:`);
      for (const { it, p } of todo) lines.push(`- ${p?.name || it.free_text}${it.qty && !(it.qty === 1 && (it.unit || 'pz') === 'pz') ? ` ${fmtQty(it.qty)} ${it.unit || ''}`.trimEnd() : ''}`);
    }
    const text = lines.join('\n');
    try {
      if (navigator.share) await navigator.share({ title: 'Lista spesa', text });
      else {
        await navigator.clipboard.writeText(text);
        showToast('Lista copiata negli appunti');
      }
    } catch {
      /* condivisione annullata */
    }
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
          {byChain.length > 1 && (
            <p className="text-xs text-text-muted mt-0.5">
              {byChain.map((c, i) => (
                <span key={c.chain} className={i === 0 ? 'text-positive font-semibold' : ''}>
                  {i ? ' · ' : ''}
                  {c.chain} {euro(c.total)}
                  {c.known < c.n ? ` (${c.known}/${c.n})` : ''}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          <Button variant="ghost" aria-label="Leggi scontrino" onClick={() => setScan(true)}>
            <ScanLine size={18} /> <span className="hidden sm:inline">Scontrino</span>
          </Button>
          <Button onClick={() => setCheckin(true)} disabled={!checked.length}>
            <Receipt size={18} /> Check-in{checked.length ? ` (${checked.length})` : ''}
          </Button>
        </div>
      </div>

      {(drafts || []).filter((d) => !d.deleted).map((d) => {
        let v = null;
        try {
          v = JSON.parse(d.value);
        } catch {
          return null;
        }
        const tot = v.lines.reduce((t, l) => t + (Number(String(l.price_paid).replace(',', '.')) || 0), 0);
        return (
          <div key={d.id} className="rounded-lg border border-brand/50 bg-brand/10 px-4 py-3 flex flex-wrap items-center gap-3">
            <Receipt size={18} className="text-brand shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
              <div className="font-semibold">Scontrino da confermare</div>
              <div className="text-text-secondary">
                {[v.form?.chain || v.chain, (v.form?.date || v.date) && new Date(`${v.form?.date || v.date}T12:00:00`).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }), `${v.lines.length} righe`, euro(tot)].filter(Boolean).join(' · ')}
              </div>
            </div>
            {askDel === d.id ? (
              <>
                <Button variant="ghost" onClick={() => setAskDel(null)}>No</Button>
                <Button variant="ghost" className="text-negative" onClick={async () => { setAskDel(null); await deleteDraft(d.id); showToast('Scontrino eliminato', { label: 'Annulla', run: () => undo() }); }}>Sì, elimina</Button>
              </>
            ) : (
              <>
                <IconButton label="Elimina scontrino" onClick={() => setAskDel(d.id)}><Trash2 size={16} /></IconButton>
                <Button onClick={() => setOcr(draftFromJson(d.id, v, data))}>Riprendi</Button>
              </>
            )}
          </div>
        );
      })}

      <div className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
        <ProductPicker products={data.products} onPick={addProduct} onCreate={addFree} placeholder="Aggiungi alla lista…" />
        <div className="flex flex-wrap gap-2">
          <Button variant={shop ? 'primary' : 'ghost'} onClick={() => setShop((v) => !v)}>
            <ShoppingBasket size={16} /> {shop ? `Modalità spesa${awake ? ' · schermo acceso' : ''}` : 'Modalità spesa'}
          </Button>
          <Button variant="ghost" onClick={shareList} disabled={!data.shopping.some((s) => !s.checked)}><Share2 size={16} /> Condividi</Button>
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
                <div key={it.id} className={`flex items-center gap-3 px-3 ${shop ? 'py-4 text-lg' : 'py-2.5'} ${it.checked ? 'opacity-50' : ''}`}>
                  <button
                    type="button"
                    aria-label={it.checked ? 'Togli dal carrello' : 'Nel carrello'}
                    onClick={() => put('shopping_items', { id: it.id, checked: it.checked ? 0 : 1 })}
                    className={`${shop ? 'w-10 h-10' : 'w-7 h-7'} shrink-0 rounded-md border-2 flex items-center justify-center ${it.checked ? 'bg-brand border-brand text-brand-on' : 'border-bg-border'}`}
                  >
                    {it.checked ? <Check size={16} strokeWidth={3} /> : null}
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`font-medium ${shop ? '' : 'truncate'} ${it.checked ? 'line-through' : ''}`}>
                      {name}
                      {o && <span className={`ml-1.5 text-[10px] font-bold uppercase border rounded px-1 ${o.cls}`}>{o.label}</span>}
                    </div>
                    <div className={`text-xs text-text-muted ${shop ? 'hidden' : ''}`}>
                      {price != null ? `~${euro(price)}` : 'prezzo ?'}
                      {p ? ` · in casa ${fmtQty(data.stock[p.id] || 0)} ${p.default_unit}` : ''}
                      {p?.alternatives ? ` · ok anche: ${p.alternatives}` : ''}
                      {(it.origin === 'ricetta' || it.origin === 'planner') && it.note ? ` · per ${it.note}` : ''}
                    </div>
                  </div>
                  {shop ? (
                    <span className="text-sm text-text-secondary tabular-nums shrink-0">{fmtQty(it.qty || 1)} {it.unit || 'pz'}</span>
                  ) : (
                    <Stepper value={Number(it.qty || 1)} unit={it.unit || 'pz'} min={0} onChange={(v) => put('shopping_items', { id: it.id, qty: v })} />
                  )}
                  <IconButton className={shop ? 'hidden' : ''} label="Togli" onClick={async () => { await put('shopping_items', { id: it.id, deleted: 1 }, `Tolto ${name}`); showToast(`Tolto ${name}`, { label: 'Annulla', run: () => undo() }); }}>
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {checkin && <CheckIn data={data} items={checked} onClose={() => setCheckin(false)} />}
      {scan && <ReceiptScan data={data} onClose={() => setScan(false)} onRead={(r) => { setScan(false); setOcr(r); }} />}
      {ocr && <CheckIn data={data} items={[]} initial={ocr} onClose={() => setOcr(null)} />}
    </div>
  );
}

// Check-in: dove, quanto pagato, sconto, dove lo metto, scadenza -> scontrino + righe + lotti in casa.
// initial (da scontrino AI): { chain, branch, date, total, lines, photo_key }
function CheckIn({ data, items, initial, onClose }) {
  const ocr = !!initial;
  const chains = [...new Set([...data.stores.map((s) => s.chain), ...(initial?.chain ? [initial.chain] : [])])];
  const startChain = initial?.chain || chains[0] || '';
  const findBranch = (c, b) => {
    const list = data.stores.filter((s) => s.chain === c);
    if (b) {
      const n = b.toLowerCase();
      const hit = list.find((s) => s.branch && (n.includes(s.branch.toLowerCase()) || s.branch.toLowerCase().includes(n)));
      if (hit) return hit.id;
    }
    if (!list.length || b) return 'new'; // punto vendita letto ma non trovato: proponi il nuovo
    return list[0].id;
  };
  const form0 = initial?.form || {};
  const [chain, setChain] = useState(form0.chain || startChain);
  const [storeId, setStoreId] = useState(() => (form0.storeId && (form0.storeId === 'new' || data.stores.some((s) => s.id === form0.storeId)) ? form0.storeId : findBranch(form0.chain || startChain, initial?.branch)));
  const [newBranch, setNewBranch] = useState(form0.newBranch ?? initial?.branch ?? '');
  const [date, setDate] = useState(form0.date || initial?.date || todayISO());
  const [askDel, setAskDel] = useState(false);
  const [linking, setLinking] = useState(null);
  const [creating, setCreating] = useState(null);
  const [lines, setLines] = useState(() =>
    initial
      ? initial.lines
      : items.map((it) => {
          const p = data.products[it.product_id];
          const last = p ? data.lastPrice[p.id] : null;
          return {
            key: it.id,
            it,
            p,
            name: it.free_text,
            qty: Number(it.qty || 1),
            unit: it.unit || p?.default_unit || 'pz',
            price_paid: last != null ? (last * Number(it.qty || 1)).toFixed(2) : '',
            price_full: '',
            location_id: p?.default_location_id || 'loc-altro',
            expiry_date: '',
          };
        })
  );
  const upd = (i, k, v) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  // bozza scontrino: salva ogni modifica (resta anche chiudendo con la X)
  const draftId = initial?.draftId || null;
  const first = useRef(true);
  const done = useRef(false);
  useEffect(() => {
    if (!draftId) return;
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => !done.current && saveDraft(draftId, { ...initial, lines }, { chain, storeId, newBranch, date }), 500);
    return () => clearTimeout(t);
  }, [draftId, lines, chain, storeId, newBranch, date]); // eslint-disable-line react-hooks/exhaustive-deps
  // chiusura subito dopo una modifica: salva l'ultimo stato
  const latest = useRef(null);
  latest.current = { lines, chain, storeId, newBranch, date };
  useEffect(
    () => () => {
      if (!draftId || done.current || first.current) return;
      const x = latest.current;
      saveDraft(draftId, { ...initial, lines: x.lines }, { chain: x.chain, storeId: x.storeId, newBranch: x.newBranch, date: x.date });
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const n = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
  const total = lines.reduce((s, l) => s + (n(l.price_paid) || 0), 0);
  const discount = lines.reduce((s, l) => s + (n(l.price_full) != null && n(l.price_paid) != null ? n(l.price_full) - n(l.price_paid) : 0), 0);
  const branches = data.stores.filter((s) => s.chain === chain);
  const unlinked = lines.filter((l) => !l.p).length;
  const totalGap = initial?.total != null ? Math.round((initial.total - total) * 100) / 100 : 0;

  function linkLine(i, p) {
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const it = l.it || data.shopping.find((s) => s.product_id === p.id && !ls.some((x) => x.it?.id === s.id));
        return { ...l, p, it: it || null, ...lineQty(l, p), location_id: p.default_location_id || 'loc-altro' };
      })
    );
    setLinking(null);
  }

  async function confirm() {
    const ops = [];
    let sid = storeId;
    if (storeId === 'new') {
      sid = uuid();
      ops.push({ table: 'stores', row: { id: sid, chain, branch: newBranch.trim() || null } });
    }
    const rid = uuid();
    ops.push({ table: 'receipts', row: { id: rid, store_id: sid, date, total_paid: Math.round(total * 100) / 100, total_discount: Math.round(discount * 100) / 100, photo_key: initial?.photo_key || null } });
    for (const l of lines) {
      const plid = uuid();
      const paid = n(l.price_paid);
      const full = n(l.price_full);
      ops.push({
        table: 'purchase_lines',
        row: { id: plid, receipt_id: rid, product_id: l.p?.id || null, qty: l.qty, unit: l.unit, price_paid: paid, price_full: full, discount: full != null && paid != null ? Math.round((full - paid) * 100) / 100 : null, offer_type: l.raw ? l.raw.slice(0, 80) : null, from_list: l.it ? 1 : 0 },
      });
      if (l.p && l.qty > 0)
        ops.push({
          table: 'stock_lots',
          row: { product_id: l.p.id, qty: l.qty, unit: l.unit, location_id: l.location_id, expiry_date: l.expiry_date || autoExpiry(l.p, l.location_id, date) || null, frozen_at: l.location_id === 'loc-freezer' ? date : null, purchase_line_id: plid },
        });
      if (l.it) ops.push({ table: 'shopping_items', row: { id: l.it.id, deleted: 1 } });
      // memoria: la prossima volta questa riga di scontrino viene riconosciuta da sola
      if (ocr && l.p && l.raw) ops.push({ table: 'receipt_aliases', row: { id: `ra-${normRaw(l.raw).replace(/ /g, '-').slice(0, 60)}`, text: l.raw, product_id: l.p.id, store_chain: chain, deleted: 0 } });
    }
    if (draftId) {
      done.current = true;
      ops.push({ table: 'settings', row: { id: draftId, deleted: 1 } });
    }
    await save(ops, `Spesa ${chain} ${euro(total)}`);
    await autoAddBelowStock();
    showToast(`Spesa registrata: ${euro(total)}`, { label: 'Annulla', run: () => undo() });
    onClose();
  }

  return (
    <Modal
      title={ocr ? 'Scontrino letto: controlla' : 'Check-in spesa'}
      onClose={onClose}
      footer={
        <>
          <div className="mr-auto text-sm">
            <div className="font-bold">{euro(total)}</div>
            {discount > 0 && <div className="text-positive text-xs">risparmio {euro(discount)}</div>}
          </div>
          {draftId ? (
            askDel ? (
              <>
                <Button variant="ghost" onClick={() => setAskDel(false)}>No</Button>
                <Button variant="ghost" className="text-negative" onClick={async () => { done.current = true; await deleteDraft(draftId); showToast('Scontrino eliminato', { label: 'Annulla', run: () => undo() }); onClose(); }}>Sì, elimina</Button>
              </>
            ) : (
              <>
                <IconButton label="Elimina scontrino" onClick={() => setAskDel(true)}><Trash2 size={16} /></IconButton>
                <Button variant="ghost" onClick={onClose}>Dopo</Button>
              </>
            )
          ) : (
            <Button variant="ghost" onClick={onClose}>Annulla</Button>
          )}
          <Button onClick={confirm} disabled={!chain || !lines.length}>Registra</Button>
        </>
      }
    >
      {ocr && (
        <div className="rounded-md border border-brand/40 bg-brand-dim/40 px-3 py-2 text-sm space-y-1">
          {draftId && <div className="text-text-secondary">Salvato: se chiudi lo ritrovi in Spesa finché non lo registri o lo elimini.</div>}
          <div>{lines.length} righe lette{unlinked ? ` · ${unlinked} da collegare al catalogo (senza collegamento non entrano in dispensa)` : ''}.</div>
          {Math.abs(totalGap) >= 0.05 && <div className="text-warning">Totale scontrino {euro(initial.total)}: differenza {euro(totalGap)}. Controlla righe e sconti.</div>}
        </div>
      )}
      <Field label="Supermercato">
        <div className="flex flex-wrap gap-2">
          {chains.map((c) => (
            <button key={c} type="button" onClick={() => { setChain(c); setStoreId(findBranch(c, newBranch)); }}
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
        <Field label="Nome punto vendita" hint="es. Crema via Milano (vuoto = generico)">
          <Input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} />
        </Field>
      )}

      <div className="space-y-3">
        {lines.map((l, i) => (
          <div key={l.key} className={`rounded-md border p-3 space-y-2 ${l.p ? 'border-bg-border bg-bg-elevated/50' : 'border-warning/50 bg-warning/5'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold truncate">{l.p?.name || l.name}</div>
                {ocr && (
                  <button type="button" onClick={() => setLinking(i)} className={`text-xs truncate max-w-full ${l.p ? 'text-text-muted' : 'text-warning font-semibold'}`}>
                    {l.raw} · {l.p ? 'cambia' : 'collega al catalogo'}{l.it ? ' · in lista ✓' : ''}
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Stepper value={Number(l.qty)} unit={l.unit} onChange={(v) => upd(i, 'qty', v)} />
                {ocr && (
                  <IconButton label="Togli riga" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input inputMode="decimal" placeholder="Pagato €" value={l.price_paid} onChange={(e) => upd(i, 'price_paid', e.target.value)} />
              <Input inputMode="decimal" placeholder="Prezzo pieno € (se scontato)" value={l.price_full} onChange={(e) => upd(i, 'price_full', e.target.value)} />
            </div>
            {l.p && (
              <div className="grid grid-cols-2 gap-2">
                <Select value={l.location_id} onChange={(e) => upd(i, 'location_id', e.target.value)}>
                  {data.locationList.filter((x) => x.id === l.location_id || allowedLocation(l.p, x.id)).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </Select>
                {l.p.area === 'cibo' || l.location_id === 'loc-farmacia' ? (
                  <Input type="date" value={l.expiry_date || autoExpiry(l.p, l.location_id, date) || ''} onChange={(e) => upd(i, 'expiry_date', e.target.value)} aria-label="Scadenza" />
                ) : <span />}
              </div>
            )}
          </div>
        ))}
      </div>
      {linking != null && (
        <Modal title={`Collega “${lines[linking].raw}”`} onClose={() => setLinking(null)}>
          <ProductPicker products={data.products} onPick={(p) => linkLine(linking, p)} onCreate={(name) => setCreating({ i: linking, name })} autoFocus />
          <p className="text-xs text-text-muted">Lo ricordo: la prossima volta questa riga viene collegata da sola.</p>
        </Modal>
      )}
      {creating && (
        <ProductForm data={data} initialName={creating.name} area="cibo" onClose={() => setCreating(null)} onSaved={(p) => linkLine(creating.i, p)} />
      )}
    </Modal>
  );
}

// Foto scontrino -> AI -> check-in da rivedere.
function ReceiptScan({ data, onRead, onClose }) {
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const r = await readReceipt(files, data);
      if (!r.lines.length) throw new Error('Nessuna riga letta. Riprova con più luce e scontrino dritto.');
      // salva subito la lettura: anche chiudendo (o chiudendo l'app mentre legge) non si perde
      const draftId = newDraftId();
      await saveDraft(draftId, r, {});
      onRead({ ...r, draftId });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Leggi scontrino"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button disabled={!files.length || busy} onClick={go}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} {busy ? 'Leggo…' : 'Leggi'}
          </Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">Scontrino dritto su fondo scuro, tutto nell’inquadratura. Se è lungo, fai fino a 3 foto dall’alto in basso. Serve la rete.</p>
      <PhotoList files={files} onChange={setFiles} max={3} />
      {err && <p className="text-sm text-negative">{err}</p>}
    </Modal>
  );
}
