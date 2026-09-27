import { NavLink, Outlet, Link } from 'react-router';
import { Home, SprayCan, Refrigerator, ShoppingCart, BookOpen, PiggyBank, Settings, CalendarDays } from 'lucide-react';
import { ThemeToggle } from './ThemeToggle.jsx';
import { useSyncState, useToast } from '../../hooks/useData.js';

function SyncDot() {
  const s = useSyncState();
  const cls = { ok: 'bg-positive', syncing: 'bg-brand animate-pulse', offline: 'bg-warning', error: 'bg-negative', 'no-key': 'bg-negative', 'bad-key': 'bg-negative' }[s.status] || 'bg-bg-border';
  const title = s.pending ? `${s.status} · ${s.pending} in coda` : s.status;
  return <span title={`Sync: ${title}`} className={`inline-block w-2.5 h-2.5 rounded-full ${cls}`} />;
}

function Toast() {
  const [t, close] = useToast();
  if (!t) return null;
  return (
    <div className="fixed z-50 left-1/2 -translate-x-1/2 bottom-24 md:bottom-6 flex items-center gap-4 rounded-md bg-text-primary text-bg-base px-4 py-3 text-sm shadow-elevated max-w-[92vw]">
      <span>{t.msg}</span>
      {t.action && (
        <button type="button" className="font-bold text-brand-light uppercase text-xs" onClick={() => { t.action.run(); close(); }}>
          {t.action.label}
        </button>
      )}
    </div>
  );
}

export const NAV = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/casa', label: 'Casa', icon: SprayCan },
  { to: '/dispensa', label: 'Dispensa', icon: Refrigerator },
  { to: '/spesa', label: 'Spesa', icon: ShoppingCart },
  { to: '/ricette', label: 'Ricette', icon: BookOpen },
  { to: '/planner', label: 'Planner', icon: CalendarDays, side: true }, // sul telefono: da Home e Ricette
  { to: '/finanze', label: 'Finanze', icon: PiggyBank },
];

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <img src="/icons/icon.svg" alt="" className="w-8 h-8 rounded-md" />
      <span className="font-bold text-sm leading-tight">
        Welcome to
        <br />
        <span className="text-brand">My House</span>
      </span>
      <SyncDot />
    </Link>
  );
}

export function Layout() {
  return (
    <div className="min-h-full md:flex">
      {/* Sidebar tablet/PC */}
      <aside className="print:hidden hidden md:flex md:flex-col w-60 shrink-0 min-h-screen bg-bg-surface border-r border-bg-border">
        <div className="px-5 py-5 border-b border-bg-border">
          <Logo />
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-brand-dim text-text-primary border-l-4 border-brand pl-2'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-bg-border flex items-center justify-between">
          <NavLink
            to="/impostazioni"
            className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-text-secondary hover:bg-bg-hover hover:text-text-primary"
          >
            <Settings size={18} /> Impostazioni
          </NavLink>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Topbar telefono */}
        <header className="print:hidden md:hidden sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-bg-surface/95 backdrop-blur border-b border-bg-border">
          <Logo />
          <div className="flex items-center gap-2">
            <Link
              to="/impostazioni"
              aria-label="Impostazioni"
              className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-bg-elevated border border-bg-border text-text-secondary"
            >
              <Settings size={18} />
            </Link>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-5 pb-28 md:pb-8 print:p-0 print:max-w-none">
          <Outlet />
        </main>

        {/* Barra in basso telefono */}
        <nav
          className="print:hidden md:hidden fixed bottom-0 inset-x-0 z-20 grid grid-cols-6 bg-bg-surface border-t border-bg-border"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV.filter((n) => !n.side).map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                  isActive ? 'text-brand' : 'text-text-muted'
                }`
              }
            >
              <Icon size={22} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Toast />
    </div>
  );
}
