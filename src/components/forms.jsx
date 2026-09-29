import { useEffect, useState } from 'react';
import { Trash2, Snowflake, PackageOpen, Check, X } from 'lucide-react';
import { Modal, Field, Input, Select, Toggle, Button, ProductPicker, Stepper } from './ui/kit.jsx';
import { put, save } from '../db/repo.js';
import { UNITS, todayISO, autoAddBelowStock, minStock, closeLot, allowedLocation, autoExpiry, durationLabel, usesOf, usesShown, usesFromShown, usesUnitLabel, lotUses, byUse, fmtQty, useBase } from '../db/logic.js';
import { showToast } from '../hooks/useData.js';
import { undo } from '../db/repo.js';

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

export function ProductForm({ data, product, initialName = '', area = 'cibo', draft = null, onClose, onSaved }) {
  const [f, setF] = useState(() => {
    const base = product || {
      name: initialName,
      area,
      category_id: data.categoryList.find((c) => c.area === area)?.id,
      default_unit: 'pz',
      default_location_id: area === 'cibo' ? 'loc-dispensa' : 'loc-altro',
      favorite: 0,
      essential: 0,
      min_stock: null,
      open_shelf_days: null,
      freezer_max_months: null,
      pantry_days: null,
      fridge_days: null,
      uses_per_pack: null,
      alternatives: '',
      notes: '',
      ...(draft || {}),
    };
    return { ...base, uses_shown: usesShown(base) ?? '' };
  });
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const cats = data.categoryList.filter((c) => c.area === f.area);
  const locs = data.locationList;
  const catDefault = data.categories[f.category_id]?.default_stock;

  async function submit() {
    if (!f.name.trim()) return;
    const { uses_shown: _u, ...rest } = f;
    const row = {
      ...rest,
      name: f.name.trim(),
      min_stock: num(f.min_stock),
      open_shelf_days: num(f.open_shelf_days),
      freezer_max_months: num(f.freezer_max_months),
      pantry_days: num(f.pantry_days),
      fridge_days: num(f.fridge_days),
      uses_per_pack: usesFromShown(f.uses_shown, f.default_unit),
    };
    // luogo abituale coerente con le durate
    if (!allowedLocation(row, row.default_location_id)) row.default_location_id = locs.find((l) => l.area === row.area && allowedLocation(row, l.id))?.id || 'loc-altro';
    const saved = await put('products', row, product ? `Modificato ${row.name}` : `Nuovo prodotto ${row.name}`);
    await autoAddBelowStock();
    onSaved?.(saved);
    onClose();
  }
  async function del() {
    await put('products', { id: product.id, deleted: 1 }, `Eliminato ${product.name}`);
    showToast(`Eliminato ${product.name}`, { label: 'Annulla', run: () => undo() });
    onClose();
  }

  return (
    <Modal
      title={product ? 'Modifica prodotto' : 'Nuovo prodotto'}
      onClose={onClose}
      footer={
        <>
          {product && (
            <Button variant="ghost" className="mr-auto text-negative" onClick={del}>
              <Trash2 size={16} /> Elimina
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button onClick={submit} disabled={!f.name.trim()}>Salva</Button>
        </>
      }
    >
      <Field label="Nome">
        <Input value={f.name} onChange={(e) => set('name')(e.target.value)} autoFocus={!product} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Area">
          <Select
            value={f.area}
            onChange={(e) => {
              const a = e.target.value;
              setF((s) => ({ ...s, area: a, category_id: data.categoryList.find((c) => c.area === a)?.id }));
            }}
          >
            <option value="cibo">Cibo</option>
            <option value="casa">Casa</option>
          </Select>
        </Field>
        <Field label="Categoria">
          <Select value={f.category_id || ''} onChange={(e) => set('category_id')(e.target.value)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Unità">
          <Select value={f.default_unit} onChange={(e) => set('default_unit')(e.target.value)}>
            {UNITS.map((u) => <option key={u}>{u}</option>)}
          </Select>
        </Field>
        <Field label="Luogo abituale">
          <Select value={f.default_location_id || ''} onChange={(e) => set('default_location_id')(e.target.value)}>
            {locs.filter((l) => l.id === f.default_location_id || allowedLocation({ ...f, pantry_days: num(f.pantry_days), fridge_days: num(f.fridge_days), freezer_max_months: num(f.freezer_max_months) }, l.id)).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
      </div>
      <div className="flex flex-wrap gap-6 py-1">
        <Toggle checked={!!f.favorite} onChange={(v) => set('favorite')(v ? 1 : 0)} label="★ Preferito" />
        <Toggle checked={!!f.essential} onChange={(v) => set('essential')(v ? 1 : 0)} label="Essenziale" />
      </div>
      {!!f.essential && (
        <Field label="Scorta minima" hint={`Vuoto = default categoria (${catDefault ?? 1} ${f.default_unit}). Sotto soglia → lista spesa automatica.`}>
          <Input inputMode="decimal" value={f.min_stock ?? ''} onChange={(e) => set('min_stock')(e.target.value)} placeholder={String(catDefault ?? 1)} />
        </Field>
      )}
      {f.area === 'cibo' && (
        <Field
          label={`Porzioni / usi per ${usesUnitLabel(f.default_unit)}`}
          hint={
            byUse(f, data.categories) && !f.uses_shown
              ? `⚠ ${data.categories[f.category_id]?.name} è una categoria a utilizzo: indica quanti usi.`
              : 'Es. dado 10 per conf, pasta 12 per kg, pesto 3 per vasetto. Le ricette scalano a usi (“2 dadi” = 2 usi, q.b. = 1 uso).'
          }
        >
          <Input inputMode="decimal" value={f.uses_shown ?? ''} onChange={(e) => set('uses_shown')(e.target.value)} placeholder="—" />
        </Field>
      )}
      {f.area === 'cibo' && (
        <div className="space-y-2">
          <div className="text-xs uppercase tracking-wider font-semibold text-text-muted">Quanto dura</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="In dispensa (gg)">
              <Input inputMode="numeric" value={f.pantry_days ?? ''} onChange={(e) => set('pantry_days')(e.target.value)} placeholder="non ci va" />
            </Field>
            <Field label="In frigo (gg)">
              <Input inputMode="numeric" value={f.fridge_days ?? ''} onChange={(e) => set('fridge_days')(e.target.value)} placeholder="non ci va" />
            </Field>
            <Field label="In freezer (mesi)">
              <Input inputMode="numeric" value={f.freezer_max_months ?? ''} onChange={(e) => set('freezer_max_months')(e.target.value)} placeholder="non ci va" />
            </Field>
            <Field label="Da aperto (gg)">
              <Input inputMode="numeric" value={f.open_shelf_days ?? ''} onChange={(e) => set('open_shelf_days')(e.target.value)} />
            </Field>
          </div>
          <p className="text-xs text-text-muted">Da quando entra in casa. Vuoto = lì non ci va (se imposti almeno dispensa o frigo). La scadenza dei lotti si calcola dal luogo in cui li metti.</p>
        </div>
      )}
      <Field label="Alternative accettate" hint="Se in lista c'è questo prodotto, vanno bene anche questi.">
        <AltPicker data={data} product={f} value={f.alternatives} onChange={set('alternatives')} />
      </Field>
      <Field label="Note">
        <Input value={f.notes || ''} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
    </Modal>
  );
}

// Usi gia' fatti della confezione/unita' aperta: cambia la quantita' del lotto.
function UsesEditor({ qty, product, onChange }) {
  const [units] = useState(() => lotUses(qty, product).units); // unita' iniziate, fisse mentre modifico
  const u = usesOf(product);
  const total = units * u;
  const left = Math.round(qty * u * 10) / 10;
  const used = Math.max(0, Math.round((total - left) * 10) / 10);
  const setUsed = (v) => onChange(Math.round(((total - Math.min(Math.max(0, v), total)) / u) * 1000) / 1000);
  return (
    <div className="flex items-end gap-3 rounded-md border border-bg-border bg-bg-elevated/50 p-3">
      <Field label="Usi già fatti">
        <Stepper value={used} unit="usi" onChange={setUsed} />
      </Field>
      <p className="pb-2 text-sm text-text-secondary">
        rimasti <b>{fmtQty(left)}</b> su {fmtQty(total)}
        <span className="block text-xs text-text-muted">{fmtQty(Math.round(u * useBase(product.default_unit) * 100) / 100)} usi per {usesUnitLabel(product.default_unit)}</span>
      </p>
    </div>
  );
}

// Scelta multipla delle alternative (salvate come nomi separati da virgola).
function AltPicker({ data, product, value, onChange }) {
  const list = String(value || '').split(',').map((x) => x.trim()).filter(Boolean);
  const others = Object.fromEntries(Object.entries(data.products).filter(([, p]) => p.area === product.area && p.id !== product.id && !list.some((n) => n.toLowerCase() === p.name.toLowerCase())));
  const setList = (l) => onChange(l.join(', '));
  return (
    <div className="space-y-2">
      {list.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {list.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-full bg-brand/15 border border-brand/50 px-3 py-1 text-sm">
              {n}
              <button type="button" aria-label={`Togli ${n}`} onClick={() => setList(list.filter((x) => x !== n))}>
                <X size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <ProductPicker products={others} prefer={product.category_id} onPick={(p) => setList([...list, p.name])} onCreate={(name) => setList([...list, name])} placeholder="Aggiungi alternativa (stessa categoria prima)…" />
    </div>
  );
}

// Aggiunta lotto: prodotto + quantita' + luogo + scadenza.
export function LotForm({ data, area, lot, presetProduct, onClose }) {
  const [product, setProduct] = useState(presetProduct || (lot && data.products[lot.product_id]) || null);
  const [creating, setCreating] = useState(null);
  const [f, setF] = useState(
    lot || {
      qty: 1,
      unit: presetProduct?.default_unit || 'pz',
      location_id: presetProduct?.default_location_id || '',
      expiry_date: '',
      opened_at: '',
      frozen_at: '',
    }
  );
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));

  const [autoExp, setAutoExp] = useState(null); // scadenza proposta dal luogo (sovrascrivibile)
  function place(p, locId, s) {
    const exp = lot ? null : autoExpiry(p, locId);
    const keep = s.expiry_date && s.expiry_date !== autoExp; // scritta a mano: non la tocco
    setAutoExp(exp);
    return { ...s, location_id: locId, expiry_date: keep ? s.expiry_date : exp || (s.expiry_date === autoExp ? '' : s.expiry_date) };
  }
  function pick(p) {
    setProduct(p);
    setF((s) => place(p, p.default_location_id || s.location_id, { ...s, unit: p.default_unit, qty: s.qty || 1 }));
  }
  useEffect(() => {
    if (presetProduct && !lot) setF((s) => place(presetProduct, s.location_id, s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const loc = data.locations[f.location_id];
  const isFreezer = f.location_id === 'loc-freezer';

  async function submit() {
    const row = {
      ...(lot ? { id: lot.id } : {}),
      product_id: product.id,
      qty: Number(f.qty),
      unit: f.unit,
      location_id: f.location_id || product.default_location_id || 'loc-altro',
      expiry_date: f.expiry_date || null,
      opened_at: f.opened_at || null,
      frozen_at: isFreezer ? f.frozen_at || todayISO() : null,
    };
    await put('stock_lots', row, `${lot ? 'Modificato' : 'Aggiunto'} ${product.name}`);
    await autoAddBelowStock();
    onClose();
  }
  async function close(type) {
    await closeLot(lot, product, data, type);
    showToast(`${type === 'buttato' ? 'Buttato' : 'Finito'} ${product.name}`, { label: 'Annulla', run: () => undo() });
    onClose();
  }

  if (creating != null)
    return <ProductForm data={data} area={area} initialName={creating} onClose={() => setCreating(null)} onSaved={pick} />;

  return (
    <Modal
      title={lot ? 'Modifica lotto' : 'Aggiungi in casa'}
      onClose={onClose}
      footer={
        <>
          {lot && (
            <div className="mr-auto flex gap-2">
              <Button variant="ghost" onClick={() => close('consumo')}>
                <Check size={16} /> Finito
              </Button>
              {product?.area === 'cibo' && (
                <Button variant="ghost" className="text-negative" onClick={() => close('buttato')}>
                  <Trash2 size={16} /> Buttato
                </Button>
              )}
            </div>
          )}
          <Button variant="ghost" onClick={onClose}>Annulla</Button>
          <Button onClick={submit} disabled={!product || !(Number(f.qty) > 0)}>Salva</Button>
        </>
      }
    >
      {product ? (
        <div className="flex items-center justify-between rounded-md bg-bg-elevated border border-bg-border px-3 py-2.5">
          <span className="font-semibold">{product.name}</span>
          {!lot && !presetProduct && <Button variant="text" onClick={() => setProduct(null)}>cambia</Button>}
        </div>
      ) : (
        <ProductPicker products={data.products} area={area} onPick={pick} onCreate={setCreating} autoFocus />
      )}
      {product && (
        <>
          <div className="flex items-end gap-3">
            <Field label="Quantità">
              <Stepper value={Number(f.qty)} unit={f.unit} onChange={set('qty')} />
            </Field>

            <Field label="Unità">
              <Select value={f.unit} onChange={(e) => set('unit')(e.target.value)}>
                {UNITS.map((u) => <option key={u}>{u}</option>)}
              </Select>
            </Field>
          </div>
          {usesOf(product) && f.unit === product.default_unit && Number(f.qty) > 0 && <UsesEditor qty={Number(f.qty)} product={product} onChange={set('qty')} />}
          <Field label="Dove">
            <div className="flex flex-wrap gap-2">
              {data.locationList.filter((l) => (l.area === product.area || l.id === 'loc-altro') && (allowedLocation(product, l.id) || l.id === f.location_id)).map((l) => (
                <button key={l.id} type="button" onClick={() => setF((s) => place(product, l.id, s))}
                  className={`rounded-full border px-3 py-1.5 text-sm ${f.location_id === l.id ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
                  {l.name}
                  {durationLabel(product, l.id) ? <span className="opacity-70"> · {durationLabel(product, l.id)}</span> : null}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Scadenza" hint={autoExp && f.expiry_date === autoExp ? 'Calcolata dal luogo, modificabile' : undefined}>
              <Input type="date" value={f.expiry_date || ''} onChange={(e) => set('expiry_date')(e.target.value)} />
            </Field>
            {isFreezer ? (
              <Field label="Congelato il" hint={`Limite: ${product.freezer_max_months || 3} mesi`}>
                <Input type="date" value={f.frozen_at || todayISO()} onChange={(e) => set('frozen_at')(e.target.value)} />
              </Field>
            ) : (
              <Field label="Aperto il" hint={product.open_shelf_days ? `Dura ${product.open_shelf_days} gg da aperto` : undefined}>
                <Input type="date" value={f.opened_at || ''} onChange={(e) => set('opened_at')(e.target.value)} />
              </Field>
            )}
          </div>
          {loc && <p className="text-xs text-text-muted">Avviso {loc.expiry_warn_days} gg prima del limite ({loc.name}).</p>}
        </>
      )}
    </Modal>
  );
}

// Azioni rapide su lotto: apri oggi / congela / sposta.
export async function quickLotAction(kind, lot, product) {
  const ops = {
    open: { id: lot.id, opened_at: todayISO() },
    freeze: { id: lot.id, location_id: 'loc-freezer', frozen_at: todayISO() },
    thaw: { id: lot.id, location_id: 'loc-frigo', frozen_at: null, opened_at: todayISO(), ...(autoExpiry(product, 'loc-frigo') ? { expiry_date: autoExpiry(product, 'loc-frigo') } : {}) },
  }[kind];
  const label = { open: 'Aperto', freeze: 'Congelato', thaw: 'Scongelato' }[kind];
  await save([{ table: 'stock_lots', row: ops }], `${label} ${product.name}`);
  showToast(`${label} ${product.name}`, { label: 'Annulla', run: () => undo() });
}
export const QuickIcons = { open: PackageOpen, freeze: Snowflake };
export { minStock };
