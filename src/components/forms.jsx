import { useState } from 'react';
import { Trash2, Snowflake, PackageOpen, Check } from 'lucide-react';
import { Modal, Field, Input, Select, Toggle, Button, ProductPicker, Stepper } from './ui/kit.jsx';
import { put, save } from '../db/repo.js';
import { UNITS, todayISO, autoAddBelowStock, minStock, closeLot } from '../db/logic.js';
import { showToast } from '../hooks/useData.js';
import { undo } from '../db/repo.js';

const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));

export function ProductForm({ data, product, initialName = '', area = 'cibo', onClose, onSaved }) {
  const [f, setF] = useState(
    product || {
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
      alternatives: '',
      notes: '',
    }
  );
  const set = (k) => (v) => setF((s) => ({ ...s, [k]: v }));
  const cats = data.categoryList.filter((c) => c.area === f.area);
  const locs = data.locationList;
  const catDefault = data.categories[f.category_id]?.default_stock;

  async function submit() {
    if (!f.name.trim()) return;
    const row = { ...f, name: f.name.trim(), min_stock: num(f.min_stock), open_shelf_days: num(f.open_shelf_days), freezer_max_months: num(f.freezer_max_months) };
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
            {locs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
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
        <div className="grid grid-cols-2 gap-3">
          <Field label="Dura da aperto (gg)">
            <Input inputMode="numeric" value={f.open_shelf_days ?? ''} onChange={(e) => set('open_shelf_days')(e.target.value)} />
          </Field>
          <Field label="Max in freezer (mesi)">
            <Input inputMode="numeric" value={f.freezer_max_months ?? ''} onChange={(e) => set('freezer_max_months')(e.target.value)} placeholder="3" />
          </Field>
        </div>
      )}
      <Field label="Alternative accettate" hint="Separate da virgola, es. Penne, Rigatoni">
        <Input value={f.alternatives || ''} onChange={(e) => set('alternatives')(e.target.value)} />
      </Field>
      <Field label="Note">
        <Input value={f.notes || ''} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
    </Modal>
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

  function pick(p) {
    setProduct(p);
    setF((s) => ({ ...s, unit: p.default_unit, location_id: p.default_location_id || s.location_id, qty: s.qty || 1 }));
  }
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
          <Field label="Dove">
            <div className="flex flex-wrap gap-2">
              {data.locationList.filter((l) => l.area === product.area || l.id === 'loc-altro').map((l) => (
                <button key={l.id} type="button" onClick={() => set('location_id')(l.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm ${f.location_id === l.id ? 'bg-brand text-brand-on border-brand' : 'border-bg-border bg-bg-elevated'}`}>
                  {l.name}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Scadenza">
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
    thaw: { id: lot.id, location_id: 'loc-frigo', frozen_at: null, opened_at: todayISO() },
  }[kind];
  const label = { open: 'Aperto', freeze: 'Congelato', thaw: 'Scongelato' }[kind];
  await save([{ table: 'stock_lots', row: ops }], `${label} ${product.name}`);
  showToast(`${label} ${product.name}`, { label: 'Annulla', run: () => undo() });
}
export const QuickIcons = { open: PackageOpen, freeze: Snowflake };
export { minStock };
