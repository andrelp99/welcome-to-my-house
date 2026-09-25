import { KeyRound, Palette, Info } from 'lucide-react';
import { Card } from '../components/ui/Card.jsx';
import { ThemeToggle } from '../components/ui/ThemeToggle.jsx';
import { getHouseKey } from '../api/client.js';

export default function Impostazioni() {
  const key = getHouseKey();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Impostazioni</h1>
      <Card title="Tema" icon={Palette}>
        <div className="flex items-center justify-between">
          <p className="text-text-secondary text-sm">Scuro di default, chiaro su richiesta.</p>
          <ThemeToggle />
        </div>
      </Card>
      <Card title="Dispositivo" icon={KeyRound} accent="accent">
        <p className="text-text-secondary text-sm">
          {key ? 'Dispositivo attivato.' : 'Dispositivo non attivato: apri il link di attivazione.'}
        </p>
      </Card>
      <Card title="Versione" icon={Info}>
        <p className="text-text-secondary text-sm">0.1.0 · fase F0</p>
      </Card>
    </div>
  );
}
