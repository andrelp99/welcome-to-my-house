import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { KeyRound, Palette, Info, RefreshCw, History, Undo2, Download, Upload, BookMarked, Bell } from 'lucide-react';
import { Card } from '../components/ui/Card.jsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.jsx';
import { Button, Toggle } from '../components/ui/kit.jsx';
import { pushSupported, enablePush, disablePush, pushStatus, setPushPrefs, testPush } from '../db/push.js';
import { getHouseKey } from '../api/client.js';
import { useSyncState, showToast } from '../hooks/useData.js';
import { syncNow } from '../db/sync.js';
import { db, SYNC_TABLES, alive } from '../db/db.js';
import { undo, save } from '../db/repo.js';

const STATUS = {
  idle: 'In attesa', syncing: 'Sincronizzo…', ok: 'Sincronizzato', offline: 'Offline', error: 'Errore', 'no-key': 'Dispositivo non attivato', 'bad-key': 'Chiave non valida',
};

export default function Impostazioni() {
  const key = getHouseKey();
  const sync = useSyncState();
  const history = useLiveQuery(() => db.history.orderBy('hid').reverse().limit(30).toArray(), []);
  const fileRef = useRef();
  const [busy, setBusy] = useState(false);

  async function exportJson() {
    const out = { app: 'welcome-to-my-house', version: 1, exported_at: new Date().toISOString(), tables: {} };
    for (const t of SYNC_TABLES) out.tables[t] = (await db.table(t).toArray()).filter(alive);
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
      showToast(`Ripristinate ${ops.length} righe`);
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

      <Card title="Cronologia (questo dispositivo)" icon={History}>
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
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" onClick={exportJson}><Download size={16} /> Esporta JSON</Button>
          <Button variant="ghost" disabled={busy} onClick={() => fileRef.current.click()}><Upload size={16} /> Ripristina</Button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files[0] && importJson(e.target.files[0])} />
        </div>
      </Card>

      <Card title="Catalogo prodotti" icon={BookMarked}>
        <Link to="/catalogo" className="text-brand font-semibold text-sm">Gestisci prodotti, preferiti ed essenziali →</Link>
      </Card>

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
        <p className="text-text-secondary text-sm">0.6.0 · fase F5</p>
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
              <Toggle checked={prefs.weekly !== false} onChange={(v) => setPref('weekly', v)} label="Riepilogo domenica alle 18:00" />
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
