import { Link } from 'react-router';
import { format } from 'date-fns';
import { it } from 'date-fns/locale';
import { AlarmClock, ShieldCheck, ShoppingCart, ChefHat, KeyRound, WifiOff } from 'lucide-react';
import { Card } from '../components/ui/Card.jsx';
import { ExpiryBadge, LEVEL_DOT } from '../components/ui/kit.jsx';
import { useData, useSyncState, useRecipes } from '../hooks/useData.js';
import { recipeStatus } from '../db/recipes.js';
import { lotStatus, LEVEL_ORDER, belowStock, fmtQty, minStock, euro } from '../db/logic.js';

export default function Home() {
  const data = useData();
  const rec = useRecipes();
  const sync = useSyncState();
  const oggi = format(new Date(), 'EEEE d MMMM', { locale: it });

  const warn = data
    ? data.lots
        .map((lot) => {
          const p = data.products[lot.product_id];
          return { lot, p, st: lotStatus(lot, p, data.locations[lot.location_id]) };
        })
        .filter((x) => x.st.level === 'expired' || x.st.level === 'soon')
        .sort((a, b) => LEVEL_ORDER[a.st.level] - LEVEL_ORDER[b.st.level] || a.st.days - b.st.days)
    : [];
  const below = data ? belowStock(data) : [];
  const spesaEst = data ? data.shopping.reduce((s, x) => s + (data.lastPrice[x.product_id] ?? 0) * (x.qty || 1), 0) : 0;
  const expired = warn.filter((w) => w.st.level === 'expired').length;
  // Ricette fattibili, prima quelle che usano cose in scadenza
  const expiring = new Set(warn.map((w) => w.p.id));
  const cook =
    data && rec
      ? rec.list
          .map((r) => {
            const ings = rec.ings[r.id] || [];
            return { r, st: recipeStatus(ings, 1, data, rec.subs), urgent: ings.filter((i) => expiring.has(i.product_id)).length };
          })
          .filter((x) => x.st.feasible)
          .sort((a, b) => b.urgent - a.urgent || (a.r.last_cooked_at || '').localeCompare(b.r.last_cooked_at || ''))
          .slice(0, 3)
      : [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-text-muted text-sm first-letter:uppercase">{oggi}</p>
        <h1 className="text-2xl md:text-3xl font-bold">
          Bentornato a <span className="text-brand">casa</span>
        </h1>
      </div>

      {(sync.status === 'no-key' || sync.status === 'bad-key') && (
        <div className="flex items-center gap-2 rounded-md border border-brand-accent/40 bg-bg-surface px-4 py-3 text-sm font-medium text-brand-accent">
          <KeyRound size={18} /> {sync.status === 'no-key' ? 'Dispositivo non attivato: apri il link di attivazione' : 'Chiave non valida: riapri il link di attivazione'}
        </div>
      )}
      {sync.status === 'offline' && (
        <div className="flex items-center gap-2 rounded-md border border-warning/40 bg-bg-surface px-4 py-3 text-sm font-medium text-warning">
          <WifiOff size={18} /> Offline: lavori in locale, sincronizzo appena torna la rete{sync.pending ? ` (${sync.pending} in coda)` : ''}.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title={`In scadenza${warn.length ? ` · ${warn.length}` : ''}`} icon={AlarmClock} accent="accent" className="sm:row-span-2">
          {warn.length === 0 ? (
            <p className="text-positive text-sm font-medium">● Tutto in ordine, niente in scadenza.</p>
          ) : (
            <>
              {expired > 0 && <p className="text-negative text-sm font-semibold mb-2">{expired} scadut{expired === 1 ? 'o' : 'i'}: controlla e togli.</p>}
              <ul className="space-y-2">
                {warn.slice(0, 10).map(({ lot, p, st }) => (
                  <li key={lot.id} className="flex items-center gap-2 text-sm">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${LEVEL_DOT[st.level]}`} />
                    <Link to={p.area === 'cibo' ? '/dispensa' : '/casa'} className="flex-1 min-w-0 truncate">
                      {p.name} <span className="text-text-muted">· {fmtQty(lot.qty)} {lot.unit} · {data.locations[lot.location_id]?.name}</span>
                    </Link>
                    <ExpiryBadge status={st} />
                  </li>
                ))}
              </ul>
              {warn.length > 10 && <Link to="/dispensa" className="block mt-3 text-brand text-sm font-semibold">Altri {warn.length - 10} →</Link>}
            </>
          )}
        </Card>

        <Card title={`Essenziali sotto scorta${below.length ? ` · ${below.length}` : ''}`} icon={ShieldCheck}>
          {below.length === 0 ? (
            <p className="text-text-secondary text-sm">
              {data && Object.values(data.products).some((p) => p.essential) ? 'Scorte ok.' : 'Nessun essenziale: segnali con 🛡 nel catalogo.'}
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {below.slice(0, 6).map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  <span className="text-brand-accent tabular-nums shrink-0">
                    {fmtQty(data.stock[p.id] || 0)}/{fmtQty(minStock(p, data.categories))} {p.default_unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Lista spesa" icon={ShoppingCart}>
          <p className="text-sm text-text-secondary mb-2">
            {data?.shopping.length || 0} voci{spesaEst > 0 ? ` · stima ${euro(spesaEst)}` : ''}
          </p>
          <Link to="/spesa" className="text-brand font-semibold text-sm">Apri la lista →</Link>
        </Card>

        <Card title="Cosa cucino oggi?" icon={ChefHat} accent="accent">
          {cook.length === 0 ? (
            <p className="text-text-secondary text-sm">{rec?.list.length ? 'Nessuna ricetta fattibile con quello che hai.' : 'Ancora nessuna ricetta.'}</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {cook.map(({ r, urgent }) => (
                <li key={r.id}>
                  <Link to={`/ricette/${r.id}`} className="flex justify-between gap-2">
                    <span className="truncate font-medium">{r.title}</span>
                    {urgent > 0 && <span className="text-brand-accent text-xs shrink-0">usa {urgent} in scadenza</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/ricette" className="block mt-3 text-brand font-semibold text-sm">Ricettario →</Link>
        </Card>
      </div>
    </div>
  );
}
