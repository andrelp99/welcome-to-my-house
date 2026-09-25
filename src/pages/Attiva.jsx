import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { apiFetch, setHouseKey } from '../api/client.js';
import { syncNow } from '../db/sync.js';

// Link di attivazione: https://<app>/attiva?k=<CHIAVE> — si apre una volta per dispositivo.
export default function Attiva() {
  const [params] = useSearchParams();
  const [state, setState] = useState('loading');

  useEffect(() => {
    const k = params.get('k');
    if (!k) {
      setState('missing');
      return;
    }
    setHouseKey(k);
    window.history.replaceState(null, '', '/attiva');
    apiFetch('/api/ping')
      .then(() => {
        setState('ok');
        syncNow();
      })
      .catch(() => setState('error'));
  }, [params]);

  const content = {
    loading: [Loader2, 'text-text-secondary animate-spin', 'Attivazione in corso…'],
    ok: [CheckCircle2, 'text-positive', 'Dispositivo attivato. Da ora non serve altro.'],
    error: [XCircle, 'text-brand-accent', 'Chiave non valida o server non raggiungibile.'],
    missing: [XCircle, 'text-brand-accent', 'Link incompleto: manca la chiave.'],
  }[state];
  const [Icon, cls, text] = content;

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="max-w-sm w-full bg-bg-surface border border-bg-border rounded-lg shadow-elevated p-8 text-center space-y-4">
        <img src="/icons/icon.svg" alt="" className="w-20 h-20 mx-auto rounded-lg" />
        <h1 className="text-xl font-bold">Welcome to My House</h1>
        <Icon size={36} className={`mx-auto ${cls}`} />
        <p className="text-text-secondary">{text}</p>
        {state === 'ok' && (
          <Link to="/" className="inline-block bg-brand text-brand-on font-semibold px-5 py-2.5 rounded-md">
            Entra
          </Link>
        )}
      </div>
    </div>
  );
}
