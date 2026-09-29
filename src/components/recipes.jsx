import { useRef, useState } from 'react';
import { ChefHat, Camera, ImagePlus, X, Check, AlertTriangle, XCircle, HelpCircle, Repeat, Trash2, Plus, MinusCircle, Ban } from 'lucide-react';
import { usePhoto, addPhoto } from '../db/photos.js';
import { Modal, Field, Input, Select, Button, IconButton, Stepper, ProductPicker, Empty } from './ui/kit.jsx';
import { fmtAmount, cookRecipe, proposedUses } from '../db/recipes.js';
import { fmtQty } from '../db/logic.js';
import { put, remove, undo } from '../db/repo.js';
import { showToast } from '../hooks/useData.js';

export function Photo({ id, className = '', alt = '', icon = true }) {
  const url = usePhoto(id);
  if (url) return <img src={url} alt={alt} className={`object-cover ${className}`} />;
  return (
    <div className={`flex items-center justify-center bg-bg-elevated text-text-muted ${className}`}>
      {icon && <ChefHat size={28} className="opacity-50" />}
    </div>
  );
}

export function PhotoPicker({ value, onChange, compact = false }) {
  const cam = useRef();
  const gal = useRef();
  const [busy, setBusy] = useState(false);
  async function pick(file) {
    if (!file) return;
    setBusy(true);
    try {
      onChange(await addPhoto(file));
    } finally {
      setBusy(false);
      cam.current.value = '';
      gal.current.value = '';
    }
  }
  return (
    <div className="flex items-center gap-3">
      {value ? (
        <div className="relative">
          <Photo id={value} className={compact ? 'w-16 h-16 rounded-md' : 'w-28 h-28 rounded-md'} />
          <button type="button" aria-label="Togli foto" onClick={() => onChange(null)} className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-brand-accent text-white flex items-center justify-center">
            <X size={14} />
          </button>
        </div>
      ) : null}
      <div className="flex gap-2">
        <Button variant="ghost" disabled={busy} onClick={() => cam.current.click()}>
          <Camera size={16} /> {compact ? '' : 'Scatta'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => gal.current.click()}>
          <ImagePlus size={16} /> {compact ? '' : 'Galleria'}
        </Button>
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files[0])} />
      <input ref={gal} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files[0])} />
    </div>
  );
}

export const STATUS_UI = {
  ok: { icon: Check, cls: 'text-positive', label: 'ho' },
  low: { icon: AlertTriangle, cls: 'text-negative', label: 'poco' },
  missing: { icon: XCircle, cls: 'text-negative', label: 'manca' },
  unlinked: { icon: HelpCircle, cls: 'text-text-muted', label: 'non collegato' },
  free: { icon: MinusCircle, cls: 'text-text-muted', label: 'non serve' },
};

// Lista ingredienti con stato dispensa, raggruppata per "grp".
export function IngredientList({ rows, scale, onLink }) {
  let grp = null;
  const out = [];
  for (const { ing, st } of rows) {
    if ((ing.grp || null) !== grp) {
      grp = ing.grp || null;
      if (grp) out.push(<li key={`g-${ing.id}`} className="pt-3 pb-1 text-xs uppercase tracking-wider font-semibold text-text-muted">{grp}</li>);
    }
    const ui = st.sub ? { icon: Repeat, cls: 'text-warning', label: 'sostituto' } : STATUS_UI[st.level];
    const nameCls = st.sub ? 'text-warning' : st.level === 'ok' ? 'text-positive' : st.level === 'missing' || st.level === 'low' ? 'text-negative' : '';
    const Icon = ui.icon;
    const amount = ing.qty != null || ing.unit ? fmtAmount(ing.qty != null ? ing.qty * scale : null, ing.unit) : '';
    out.push(
      <li key={ing.id} className="flex items-start gap-3 py-2">
        <Icon size={18} className={`mt-0.5 shrink-0 ${ui.cls}`} aria-label={ui.label} />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between gap-2">
            <span className={`${nameCls} ${ing.optional ? 'opacity-70' : ''}`}>
              {ing.text}
              {ing.optional ? <span className="text-text-muted text-xs"> · facoltativo</span> : null}
            </span>
            <span className="font-semibold tabular-nums shrink-0">{amount}</span>
          </div>
          <div className="text-xs text-text-muted">
            {st.level === 'free' ? (
              'non serve in dispensa'
            ) : st.level === 'unlinked' ? (
              onLink ? (
                <button type="button" className="text-brand font-semibold print:hidden" onClick={() => onLink(ing)}>Collega al catalogo</button>
              ) : null
            ) : (
              <>
                in casa {fmtQty(st.have)} {st.unit}
                {st.level === 'low' && st.missing != null ? ` · mancano ${fmtAmount(st.missing, st.unit)}` : ''}
                {st.sub ? ` · usa ${st.sub.product.name}${st.sub.ratio !== 1 ? ` (×${fmtQty(st.sub.ratio)})` : ''}${st.sub.note ? `, ${st.sub.note}` : ''}` : ''}
              </>
            )}
          </div>
        </div>
      </li>
    );
  }
  return <ul className="divide-y divide-bg-border">{out}</ul>;
}

// Conferma "Ho cucinato": quantita' da scalare modificabili + avanzi.
export function CookedModal({ recipe, status, servings, data, onClose }) {
  const [uses, setUses] = useState(() => proposedUses(status).map((u) => ({ ...u, on: u.qty > 0 })));
  const [left, setLeft] = useState(0);
  const [leftLoc, setLeftLoc] = useState('loc-frigo');
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    await cookRecipe({
      recipe,
      servings,
      uses: uses.filter((u) => u.on && u.qty > 0),
      leftovers: left > 0 ? { portions: left, location_id: leftLoc } : null,
      data,
    });
    showToast(`Buon appetito! Dispensa aggiornata`, { label: 'Annulla', run: () => undo() });
    onClose(true);
  }
  return (
    <Modal
      title="Ho cucinato"
      onClose={() => onClose(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => onClose(false)}>Annulla</Button>
          <Button onClick={confirm} disabled={busy}>Conferma</Button>
        </>
      }
    >
      <p className="text-sm text-text-secondary">
        {recipe.title} · {fmtQty(servings)} porzioni. Tolgo dalla dispensa (prima i lotti che scadono prima):
      </p>
      {uses.length === 0 ? (
        <Empty>Nessun ingrediente collegato al catalogo.</Empty>
      ) : (
        <ul className="space-y-2">
          {uses.map((u, i) => (
            <li key={u.product.id} className="flex items-center gap-2">
              <input type="checkbox" className="w-5 h-5 accent-[rgb(var(--brand-primary))]" checked={u.on} onChange={(e) => setUses((a) => a.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
              <span className={`flex-1 min-w-0 truncate text-sm ${u.on ? '' : 'text-text-muted line-through'}`}>{u.product.name}</span>
              <Stepper value={u.qty} unit={u.product.default_unit} onChange={(v) => setUses((a) => a.map((x, j) => (j === i ? { ...x, qty: v, on: v > 0 } : x)))} />
            </li>
          ))}
        </ul>
      )}
      <div className="rounded-md border border-bg-border p-3 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold">Avanzi (porzioni)</span>
          <Stepper value={left} unit="pz" onChange={setLeft} />
        </div>
        {left > 0 && (
          <Field label="Dove" hint={leftLoc === 'loc-freezer' ? 'Congelato oggi, limite 3 mesi.' : 'Scadenza tra 3 giorni.'}>
            <Select value={leftLoc} onChange={(e) => setLeftLoc(e.target.value)}>
              <option value="loc-frigo">Frigo</option>
              <option value="loc-freezer">Freezer</option>
            </Select>
          </Field>
        )}
      </div>
    </Modal>
  );
}

// Modale per collegare un ingrediente a un prodotto del catalogo.
export function LinkModal({ ing, data, onPick, onCreate, onSkip, onClose }) {
  return (
    <Modal title={`Collega “${ing.text}”`} onClose={onClose}>
      <ProductPicker products={data.products} area="cibo" onPick={onPick} onCreate={onCreate} placeholder="Cerca nel catalogo…" autoFocus />
      <p className="text-xs text-text-muted">Collegato al catalogo, l'ingrediente viene confrontato con la dispensa e può finire in lista spesa.</p>
      {onSkip && (
        <Button variant="ghost" onClick={onSkip}>
          <Ban size={16} /> Non serve in dispensa (acqua, ghiaccio…)
        </Button>
      )}
    </Modal>
  );
}

// Gestione sostituti: 1 prodotto = ratio × sostituto
export function SubstitutionsPanel({ data, rec }) {
  const [adding, setAdding] = useState(null); // { from, to, ratio, note }
  const list = rec.subList
    .filter((s) => data.products[s.product_id] && data.products[s.substitute_id])
    .sort((a, b) => data.products[a.product_id].name.localeCompare(data.products[b.product_id].name, 'it'));
  async function saveNew() {
    await put('substitutions', { product_id: adding.from.id, substitute_id: adding.to.id, ratio: Number(String(adding.ratio).replace(',', '.')) || 1, note: adding.note || null }, `Sostituto: ${adding.from.name} → ${adding.to.name}`);
    setAdding(null);
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-text-secondary">Se manca un ingrediente ma hai il sostituto, la ricetta resta fattibile.</p>
        <Button onClick={() => setAdding({ from: null, to: null, ratio: 1, note: '' })}>
          <Plus size={16} /> Nuovo
        </Button>
      </div>
      {list.length === 0 ? (
        <Empty icon={Repeat}>Nessun sostituto.</Empty>
      ) : (
        <ul className="rounded-lg border border-bg-border bg-bg-surface divide-y divide-bg-border">
          {list.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="flex-1 min-w-0">
                <b>{data.products[s.product_id].name}</b> → {data.products[s.substitute_id].name}
                <span className="text-text-muted">
                  {s.ratio !== 1 ? ` · ×${fmtQty(s.ratio)}` : ''}
                  {s.note ? ` · ${s.note}` : ''}
                </span>
              </span>
              <IconButton label="Elimina" onClick={async () => { await remove('substitutions', s.id, 'Eliminato sostituto'); showToast('Sostituto eliminato', { label: 'Annulla', run: () => undo() }); }}>
                <Trash2 size={16} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <Modal
          title="Nuovo sostituto"
          onClose={() => setAdding(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setAdding(null)}>Annulla</Button>
              <Button disabled={!adding.from || !adding.to || adding.from.id === adding.to.id} onClick={saveNew}>Salva</Button>
            </>
          }
        >
          <Field label={`Se manca${adding.from ? `: ${adding.from.name}` : ''}`}>
            {!adding.from && <ProductPicker products={data.products} area="cibo" onPick={(p) => setAdding((a) => ({ ...a, from: p }))} autoFocus />}
          </Field>
          {adding.from && (
            <Field label={`Usa${adding.to ? `: ${adding.to.name}` : ''}`}>
              {!adding.to && <ProductPicker products={data.products} area="cibo" onPick={(p) => setAdding((a) => ({ ...a, to: p }))} />}
            </Field>
          )}
          {adding.to && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Rapporto" hint="1 = stessa quantità">
                <Input inputMode="decimal" value={adding.ratio} onChange={(e) => setAdding((a) => ({ ...a, ratio: e.target.value }))} />
              </Field>
              <Field label="Nota">
                <Input value={adding.note} onChange={(e) => setAdding((a) => ({ ...a, note: e.target.value }))} placeholder="facoltativa" />
              </Field>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
