import { Routes, Route, Navigate } from 'react-router';
import { Layout } from './components/ui/Layout.jsx';
import Home from './pages/Home.jsx';
import Attiva from './pages/Attiva.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import { Placeholder } from './pages/Placeholder.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/attiva" element={<Attiva />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="casa" element={<Placeholder title="Casa" fase="F1" testo="Pulizia, bagno, lavanderia, farmacia e tutto il non-cibo." />} />
        <Route path="dispensa" element={<Placeholder title="Dispensa" fase="F1" testo="Frigo, freezer e dispensa cibo con lotti e scadenze." />} />
        <Route path="spesa" element={<Placeholder title="Lista spesa" fase="F1" testo="Lista unica, preferiti, essenziali e check-in della spesa." />} />
        <Route path="ricette" element={<Placeholder title="Ricettario" fase="F2" testo="Le tue ricette, con ingredienti confrontati con la dispensa." />} />
        <Route path="finanze" element={<Placeholder title="Prospetto finanziario" fase="F5" testo="Storico prezzi, budget, proiezioni, sconti e analisi." />} />
        <Route path="impostazioni" element={<Impostazioni />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
