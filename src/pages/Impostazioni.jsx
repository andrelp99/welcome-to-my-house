import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { KeyRound, Palette, Info, RefreshCw, History, Undo2, Download, Upload, BookMarked, Bell, SlidersHorizontal } from 'lucide-react';
import { weightsOf, saveSetting } from '../db/meals.js';
import { DEFAULT_WEIGHTS, WEIGHT_LABELS } from '../db/variety.js';
import { Card } from '../components/ui/Card.jsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.jsx';
import { Button, Toggle } from '../components/ui/kit.jsx';
import { pushSupported, enablePush, disablePush, pushStatus, setPushPrefs, testPush } from '../db/push.js';
import { getHouseKey, apiFetch, ApiError } from '../api/client.js';
import { useSyncState, showToast, useRecipes } from '../hooks/useData.js';
import { syncNow, deviceId } from '../db/sync.js';
import { db, SYNC_TABLES, alive } from '../db/db.js';
import { undo, save } from '../db/repo.js';
import { photoToDataUrl, restorePhoto } from '../db/photos.js';

const STATUS = {
  idle: 'In attesa', syncing: 'Sincronizzo…', ok: 'Sincronizzato', offline: 'Offline', error: 'Errore', 'no-key': 'Dispositivo non attivato', 'bad-key': 'Chiave non valida',
};

export default function Impostazioni() {
  const key = getHouseKey();
  const sync = useSyncState();
  const history = useLiveQuery(() => db.history.orderBy('hid').reverse().limit(30).toArray(), []);
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);
  const [withPhotos, setWithPhotos] = useState(true);
  const [prog, setProg] = useState(null);

  async function exportJson() {
    const out = { app: 'welcome-to-my-house', version: 2, exported_at: new Date().toISOString(), tables: {}, files: {} };
    for (const t of SYNC_TABLES) out.tables[t] = (await db.table(t).toArray()).filter(alive);
    if (withPhotos) {
      const keys = [...new Set(['recipes', 'recipe_steps', 'receipts'].flatMap((t) => out.tables[t].map((r) => r.photo_key)).filter(Boolean))];
      let missing = 0;
      for (let i = 0; i < keys.length; i++) {
        setProg(`Foto ${i + 1}/${keys.length}`);
        const url = await photoToDataUrl(keys[i]);
        if (url) out.files[keys[i]] = url;
        else missing++;
      }
      setProg(null);
      if (missing) showToast(`${missing} foto non disponibili (offline?): backup senza di loro`);
    }
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `welcome-house-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importJson(file) {
    setBusy(true);
    try {
      const parsed = JSON.parse(await file.text());
      if (parsed.app !== 'welcome-to-my-house') throw new Error('File non riconosciuto');
      const ops = [];
      for (const t of SYNC_TABLES) for (const row of parsed.tables?.[t] || []) ops.push({ table: t, row: { ...row, deleted: 0 } });
      // a blocchi per non fare transazioni enormi
      for (let i = 0; i < ops.length; i += 200) await save(ops.slice(i, i + 200), i === 0 ? `Ripristino backup (${ops.length} righe)` : undefined);
      let photos = 0;
      for (const [id, url] of Object.entries(parsed.files || {})) if (await restorePhoto(id, url)) photos++;
      showToast(`Ripristinate ${ops.length} righe${photos ? ` e ${photos} foto` : ''}`);
    } catch (e) {
      showToast(`Import fallito: ${e.message}`);
    } finally {
      setBusy(false);
      fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Impostazioni</h1>

      <Card title="Sincronizzazione" icon={RefreshCw} accent="positive">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <div className="font-semibold">{STATUS[sync.status]}</div>
            <div className="text-text-muted text-xs">
              {sync.last ? `ultimo: ${new Date(sync.last).toLocaleTimeString('it-IT')}` : 'mai'}
              {sync.pending ? ` · ${sync.pending} modifiche in coda` : ''}
              {sync.error ? ` · ${sync.error}` : ''}
            </div>
          </div>
          <Button variant="ghost" onClick={() => syncNow()}><RefreshCw size={16} className={sync.status === 'syncing' ? 'animate-spin' : ''} /> Ora</Button>
        </div>
      </Card>

      <Notifiche />

      <Cronologia sync={sync} />

      <Card title="Cronologia locale (offline)" icon={History}>
        {!history?.length ? (
          <p className="text-text-secondary text-sm">Nessuna modifica registrata.</p>
        ) : (
          <ul className="divide-y divide-bg-border -my-2">
            {history.map((h) => (
              <li key={h.hid} className="flex items-center gap-2 py-2 text-sm">
                <span className="flex-1 min-w-0 truncate">{h.label}</span>
                <span className="text-xs text-text-muted shrink-0">{new Date(h.at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <button type="button" onClick={async () => showToast(`Annullato: ${await undo(h.hid)}`)} className="inline-flex items-center gap-1 text-brand text-xs font-semibold shrink-0">
                  <Undo2 size={14} /> Annulla
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Backup" icon={Download}>
        <p className="text-text-secondary text-sm mb-3">Esporta tutto in un file JSON. Il ripristino reinserisce le righe (non cancella nulla).</p>
        <div className="mb-3">
          <Toggle checked={withPhotos} onChange={setWithPhotos} label="Includi foto (ricette, passaggi, scontrini: file più grande)" />
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="ghost" disabled={!!prog} onClick={exportJson}><Download size={16} /> {prog || 'Esporta JSON'}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => fileRef.current.click()}><Upload size={16} /> Ripristina</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files[0] && importJson(e.target.files[0])} />
        </div>
      </Card>

      <Card title="Catalogo prodotti" icon={BookMarked}>
        <Link to="/catalogo" className="text-brand font-semibold text-sm">Gestisci prodotti, preferiti ed essenziali →</Link>
      </Card>

      <Pesi />

      <Card title="Tema" icon={Palette}>
        <div className="flex items-center justify-between">
          <p className="text-text-secondary text-sm">Scuro di default, chiaro su richiesta.</p>
          <ThemeToggle />
        </div>
      </Card>
      <Card title="Dispositivo" icon={KeyRound} accent="accent">
        <p className="text-text-secondary text-sm">{key ? 'Dispositivo attivato.' : 'Dispositivo non attivato: apri il link di attivazione.'}</p>
      </Card>
      <Card title="Versione" icon={Info}>
        <p className="text-text-secondary text-sm">0.15.0 · terzo alimento, ingredienti in più</p>
      </Card>
    </div>
  );
}

function Notifiche() {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const supported = pushSupported();
  const refresh = () => pushStatus().then(setSt).catch((e) => setSt({ error: e.message }));
  useEffect(() => {
    if (supported) refresh();
  }, [supported]);
  async function run(fn, ok) {
    setBusy(true);
    try {
      await fn();
      if (ok) showToast(ok);
      await refresh();
    } catch (e) {
      showToast(e.message);
    } finally {
      setBusy(false);
    }
  }
  const prefs = st?.prefs || { daily: true, weekly: true, monthly: true };
  const setPref = (k, v) => run(() => setPushPrefs({ ...prefs, [k]: v }));
  return (
    <Card title="Notifiche" icon={Bell} accent="accent">
      {!supported ? (
        <p className="text-sm text-text-secondary">Questo browser non supporta le notifiche. Su Android usa l’app installata da Chrome.</p>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">{st?.subscribed ? 'Attive su questo dispositivo' : 'Non attive su questo dispositivo'}</div>
              <div className="text-text-muted text-xs">{st?.error || `${st?.devices ?? 0} dispositivi iscritti`}</div>
            </div>
            {st?.subscribed ? (
              <Button variant="ghost" disabled={busy} onClick={() => run(disablePush, 'Notifiche disattivate')}>Disattiva</Button>
            ) : (
              <Button disabled={busy} onClick={() => run(async () => { await enablePush(); await testPush('test'); }, 'Notifiche attive: arriva una prova')}>Attiva</Button>
            )}
          </div>
          {st?.subscribed && (
            <>
              <Toggle checked={prefs.daily !== false} onChange={(v) => setPref('daily', v)} label="Scadenze ogni giorno alle 9:30 (solo se serve)" />
              <Toggle checked={prefs.weekly !== false} onChange={(v) => setPref('weekly', v)} label="Riepilogo domenica alle 20:00 (varietà, pasti da registrare)" />
              <Toggle checked={prefs.monthly !== false} onChange={(v) => setPref('monthly', v)} label="Report mensile il 1° alle 9:30" />
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="ghost" disabled={busy} onClick={() => run(() => testPush('daily'), 'Inviata anteprima scadenze')}>Prova scadenze</Button>
                <Button variant="ghost" disabled={busy} onClick={() => run(() => testPush('weekly'), 'Inviato riepilogo di prova')}>Prova riepilogo</Button>
                <Button variant="ghost" disabled={busy} onClick={() => run(() => testPush('monthly'), 'Inviato report di prova')}>Prova report</Button>
              </div>
            </>
          )}
          <p className="text-xs text-text-muted">Anticipo scadenze per luogo: frigo 3 gg, dispensa 7, freezer 14, farmacia 30.</p>
        </div>
      )}
    </Card>
  );
}

// Cronologia condivisa: operazioni di tutti i dispositivi, annullabili da qui.
function Cronologia({ sync }) {
  const [items, setItems] = useState(null);
  const [err, setErr] = useState(null);
  const [me, setMe] = useState(null);
  const [ask, setAsk] = useState(null); // { op, conflicts }
  const [busy, setBusy] = useState(null);
  const load = () =>
    apiFetch('/api/ops?limit=40')
      .then((r) => {
        setItems(r.items);
        setErr(null);
      })
      .catch((e) => setErr(e.message));
  useEffect(() => {
    deviceId().then(setMe);
  }, []);
  useEffect(() => {
    load();
  }, [sync.last]);

  async function run(it, force = false) {
    setBusy(it.op_id);
    try {
      await syncNow(); // prima invia le modifiche in coda
      await apiFetch('/api/undo', { method: 'POST', body: JSON.stringify({ op: it.op_id, force, device: me }) });
      setAsk(null);
      showToast(`Annullato: ${it.label}`);
      await syncNow();
      await load();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setAsk({ it });
      else showToast(`Annulla fallito: ${e.message}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Cronologia (tutti i dispositivi)" icon={History}>
      {err ? (
        <p className="text-text-secondary text-sm">Non raggiungibile ({err}). Sotto trovi la cronologia locale.</p>
      ) : !items ? (
        <p className="text-text-secondary text-sm">Carico…</p>
      ) : !items.length ? (
        <p className="text-text-secondary text-sm">Nessuna operazione registrata (le modifiche fatte prima della 0.9 non sono raggruppate).</p>
      ) : (
        <ul className="divide-y divide-bg-border -my-2">
          {items.map((it) => (
            <li key={it.op_id} className="flex items-center gap-2 py-2 text-sm">
              <div className="flex-1 min-w-0">
                <div className={`truncate ${it.undone ? 'line-through text-text-muted' : ''}`}>{it.label}</div>
                <div className="text-xs text-text-muted">
                  {new Date(it.at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {it.device === me ? 'questo dispositivo' : it.device}
                  {it.n > 1 ? ` · ${it.n} righe` : ''}
                </div>
              </div>
              {it.undone ? (
                <span className="text-xs text-text-muted shrink-0">annullata</span>
              ) : String(it.label).startsWith('Annullato:') ? null : (
                <button type="button" disabled={!!busy} onClick={() => run(it)} className="inline-flex items-center gap-1 text-brand text-xs font-semibold shrink-0 disabled:opacity-40">
                  <Undo2 size={14} /> {busy === it.op_id ? '…' : 'Annulla'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ask && (
        <div className="mt-3 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm space-y-2">
          <p>Alcune righe di “{ask.it.label}” sono state cambiate dopo. Annullando torni allo stato di prima anche per quelle.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setAsk(null)}>Lascia stare</Button>
            <Button onClick={() => run(ask.it, true)}>Annulla comunque</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// Pesi dell'ordinamento "Consigliate" (salvati e sincronizzati).
const WEIGHT_HINT = { var: 'non ripetere, aiutare gli obiettivi', grad: 'le tue stelle ★', rit: 'rispetto alla frequenza 🔁', scad: 'usa cose che scadono', fatt: 'hai già gli ingredienti' };
function Pesi() {
  const rec = useRecipes();
  const [w, setW] = useState(null);
  useEffect(() => {
    if (rec && !w) setW(weightsOf(rec));
  }, [rec, w]);
  if (!w) return null;
  const saved = weightsOf(rec);
  const dirty = Object.keys(w).some((k) => Number(w[k]) !== Number(saved[k]));
  const sum = Object.values(w).reduce((a, b) => a + Number(b), 0);
  return (
    <Card title="Proposte ricette" icon={SlidersHorizontal}>
      <p className="text-text-secondary text-sm mb-3">Quanto conta ogni aspetto nell'ordinamento “Consigliate” (Home, ricettario, Riempi planner).</p>
      <div className="space-y-3">
        {Object.keys(DEFAULT_WEIGHTS).map((k) => (
          <div key={k} className="grid grid-cols-[1fr_auto] gap-x-3 items-center">
            <label htmlFor={`w-${k}`} className="text-sm font-semibold">
              {WEIGHT_LABELS[k]} <span className="block text-xs font-normal text-text-muted">{WEIGHT_HINT[k]}</span>
            </label>
            <span className="tabular-nums font-bold text-sm w-8 text-right">{w[k]}</span>
            <input id={`w-${k}`} type="range" min="0" max="60" step="1" value={w[k]} onChange={(e) => setW((x) => ({ ...x, [k]: Number(e.target.value) }))} className="col-span-2 w-full accent-brand" />
          </div>
        ))}
      </div>
      <p className="text-xs text-text-muted mt-2">{sum === 100 ? 'Somma 100.' : `Somma ${sum}: conta la proporzione.`}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <Button disabled={!dirty} onClick={async () => { await saveSetting('weights', w, 'Pesi proposte'); showToast('Pesi salvati', { label: 'Annulla', run: () => undo() }); }}>Salva</Button>
        <Button variant="ghost" onClick={() => setW({ ...DEFAULT_WEIGHTS })}>Ripristina</Button>
      </div>
    </Card>
  );
}
