import { Construction } from 'lucide-react';
import { Card } from '../components/ui/Card.jsx';

export function Placeholder({ title, testo, fase }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      <Card title={`In arrivo · fase ${fase}`} icon={Construction} accent="accent">
        <p className="text-text-secondary">{testo}</p>
      </Card>
    </div>
  );
}
