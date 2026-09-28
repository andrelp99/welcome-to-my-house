import { Routes, Route, Navigate } from 'react-router';
import { Layout } from './components/ui/Layout.jsx';
import Home from './pages/Home.jsx';
import Attiva from './pages/Attiva.jsx';
import Impostazioni from './pages/Impostazioni.jsx';
import Inventario from './pages/Inventario.jsx';
import Catalogo from './pages/Catalogo.jsx';
import Spesa from './pages/Spesa.jsx';
import Ricette from './pages/Ricette.jsx';
import RicettaDettaglio from './pages/RicettaDettaglio.jsx';
import RicettaForm from './pages/RicettaForm.jsx';
import Cucina from './pages/Cucina.jsx';
import RicettaImport from './pages/RicettaImport.jsx';
import Planner from './pages/Planner.jsx';
import Finanze from './pages/Finanze.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/attiva" element={<Attiva />} />
      <Route path="/ricette/:id/cucina" element={<Cucina />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="casa" element={<Inventario key="casa" area="casa" title="Casa" subtitle="Pulizia, bagno, lavanderia, farmacia e tutto il non-cibo." />} />
        <Route path="dispensa" element={<Inventario key="cibo" area="cibo" title="Dispensa" subtitle="Frigo, freezer e dispensa: lotti e scadenze." />} />
        <Route path="spesa" element={<Spesa />} />
        <Route path="catalogo" element={<Catalogo />} />
        <Route path="ricette" element={<Ricette />} />
        <Route path="ricette/nuova" element={<RicettaForm key="nuova" />} />
        <Route path="ricette/importa" element={<RicettaImport />} />
        <Route path="planner" element={<Planner />} />
        <Route path="ricette/:id" element={<RicettaDettaglio />} />
        <Route path="ricette/:id/modifica" element={<RicettaForm key="modifica" />} />
        <Route path="finanze" element={<Finanze />} />
        <Route path="impostazioni" element={<Impostazioni />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
