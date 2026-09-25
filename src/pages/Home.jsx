import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { AlarmClock, ShieldCheck, ShoppingCart, ChefHat, Wifi, WifiOff, KeyRound } from 'lucide-react';
import { Card } from '../components/ui/Card.jsx';
import { apiFetch, getHouseKey } from '../api/client.js';

function useConnection() {
  const [state, setState] = useState({ status: 'checking' });
  useEffect(() => {
    if (!getHouseKey()) {
      setState({ status: 'no-key' });
      return;
    }
    apiFetch('/api/ping')
      .then((r) => setState({ status: 'ok', db: r.db }))
      .catch((e) => setState({ status: e.status === 401 ? 'bad-key' : 'offline' }));
  }, []);
  return state;
}

export default function Home() {
  const conn = useConnection();
  const oggi = format(new Date(), "EEEE d MMMM", { locale: it });

  return (
    <div className="space-y-5">
      <div>
        <p className="text-text-muted text-sm first-letter:uppercase">{oggi}</p>
        <h1 className="text-2xl md:text-3xl font-bold">
          Bentornato a <span className="text-brand">casa</span>
        </h1>
      </div>

      <ConnectionBanner conn={conn} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="In scadenza" icon={AlarmClock} accent="accent">
          <p className="text-text-secondary text-sm">Frigo entro 3 giorni, dispensa entro 7. Arriva con la fase F1.</p>
        </Card>
        <Card title="Essenziali sotto scorta" icon={ShieldCheck}>
          <p className="text-text-secondary text-sm">I prodotti che devono esserci sempre. Arriva con la fase F1.</p>
        </Card>
        <Card title="Lista spesa" icon={ShoppingCart}>
          <Link to="/spesa" className="text-brand font-semibold text-sm">Apri la lista →</Link>
        </Card>
        <Card title="Cosa cucino oggi?" icon={ChefHat} accent="accent">
          <p className="text-text-secondary text-sm">Ricette fattibili con quello che hai. Arriva con la fase F4.</p>
        </Card>
      </div>
    </div>
  );
}

function ConnectionBanner({ conn }) {
  if (conn.status === 'checking') return null;
  const map = {
    ok: { icon: Wifi, cls: 'border-positive/40 text-positive', text: 'Collegato al server' },
    offline: { icon: WifiOff, cls: 'border-warning/40 text-warning', text: 'Server non raggiungibile' },
    'no-key': { icon: KeyRound, cls: 'border-brand-accent/40 text-brand-accent', text: 'Dispositivo non attivato: apri il link di attivazione' },
    'bad-key': { icon: KeyRound, cls: 'border-brand-accent/40 text-brand-accent', text: 'Chiave dispositivo non valida: riapri il link di attivazione' },
  };
  const { icon: Icon, cls, text } = map[conn.status];
  return (
    <div className={`flex items-center gap-2 rounded-md border bg-bg-surface px-4 py-3 text-sm font-medium ${cls}`}>
      <Icon size={18} /> {text}
    </div>
  );
}
