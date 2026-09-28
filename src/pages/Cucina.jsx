import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { X, ChevronLeft, ChevronRight, ListChecks, Timer, Pause, Play, RotateCcw, ChefHat, Sun } from 'lucide-react';
import { useRecipes } from '../hooks/useData.js';
import { Photo } from '../components/recipes.jsx';
import { fmtAmount } from '../db/recipes.js';
import { fmtQty } from '../db/logic.js';
import { useWakeLock } from '../hooks/useWakeLock.js';

// Un solo timer (niente timer multipli, da piano). Continua tra un passaggio e l'altro.
function useTimer() {
  const [t, setT] = useState(null); // { total, endAt, left, paused, step }
  const [ring, setRing] = useState(false);
  const audio = useRef(null);
  useEffect(() => {
    if (!t || t.paused) return;
    const h = setInterval(() => {
      const left = Math.max(0, Math.round((t.endAt - Date.now()) / 1000));
      setT((x) => x && { ...x, left });
      if (left === 0) {
        clearInterval(h);
        setRing(true);
      }
    }, 250);
    return () => clearInterval(h);
  }, [t?.endAt, t?.paused]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => audio.current?.close().catch(() => {}), []);
  useEffect(() => {
    if (!ring) return;
    // bip ripetuto + vibrazione finche' non si ferma
    const ctx = audio.current;
    ctx?.resume?.().catch(() => {});
    const beep = () => {
      navigator.vibrate?.([300, 150, 300]);
      if (!ctx) return;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.25, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      o.connect(g).connect(ctx.destination);
      o.start();
      o.stop(ctx.currentTime + 0.6);
    };
    beep();
    const h = setInterval(beep, 1500);
    return () => clearInterval(h);
  }, [ring]);
  return {
    t,
    ring,
    start: (min, step) => {
      setRing(false);
      // l'audio va creato durante un tocco, altrimenti Android lo blocca
      try {
        audio.current ||= new (window.AudioContext || window.webkitAudioContext)();
        audio.current.resume?.();
      } catch {
        /* audio non disponibile */
      }
      const total = Math.round(min * 60);
      setT({ total, left: total, endAt: Date.now() + total * 1000, paused: false, step });
    },
    toggle: () => setT((x) => (x.paused ? { ...x, paused: false, endAt: Date.now() + x.left * 1000 } : { ...x, paused: true })),
    stop: () => {
      setRing(false);
      setT(null);
    },
  };
}

const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function Cucina() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const rec = useRecipes();
  const [i, setI] = useState(0);
  const [showIng, setShowIng] = useState(false);
  const wake = useWakeLock();
  const timer = useTimer();

  if (!rec) return null;
  const recipe = rec.byId[id];
  if (!recipe) return <Navigate to="/ricette" replace />;
  const steps = rec.steps[id] || [];
  const ings = rec.ings[id] || [];
  const servings = Number(params.get('porzioni')) || recipe.servings;
  const scale = servings / (recipe.servings || 1);
  const step = steps[i];
  const last = i === steps.length - 1;

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg-base" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex items-center gap-2 px-4 py-3 border-b border-bg-border bg-bg-surface">
        <button type="button" aria-label="Esci" onClick={() => nav(`/ricette/${id}`)} className="w-11 h-11 rounded-md bg-bg-elevated border border-bg-border flex items-center justify-center">
          <X size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-bold truncate">{recipe.title}</div>
          <div className="text-xs text-text-muted flex items-center gap-2">
            Passo {Math.min(i + 1, steps.length)} di {steps.length} · {fmtQty(servings)} porz.
            {wake && (
              <span className="inline-flex items-center gap-0.5 text-brand">
                <Sun size={12} /> schermo acceso
              </span>
            )}
          </div>
        </div>
        <button type="button" aria-label="Ingredienti" onClick={() => setShowIng((v) => !v)} className={`w-11 h-11 rounded-md border flex items-center justify-center ${showIng ? 'bg-brand text-brand-on border-brand' : 'bg-bg-elevated border-bg-border'}`}>
          <ListChecks size={20} />
        </button>
      </header>

      <div className="h-1.5 bg-bg-elevated">
        <div className="h-full bg-brand transition-all" style={{ width: `${steps.length ? ((i + 1) / steps.length) * 100 : 0}%` }} />
      </div>

      <main className="flex-1 overflow-y-auto">
        {showIng ? (
          <ul className="max-w-3xl mx-auto px-5 py-5 divide-y divide-bg-border text-xl">
            {ings.map((g) => (
              <li key={g.id} className="flex justify-between gap-3 py-3">
                <span>
                  {g.text}
                  {g.optional ? <span className="text-text-muted text-sm"> · facoltativo</span> : null}
                </span>
                <span className="font-bold tabular-nums shrink-0">{g.qty != null || g.unit ? fmtAmount(g.qty != null ? g.qty * scale : null, g.unit) : ''}</span>
              </li>
            ))}
          </ul>
        ) : step ? (
          <div className="max-w-3xl mx-auto px-5 py-6 md:py-10 space-y-6 md:grid md:grid-cols-[1fr_auto] md:gap-8 md:space-y-0">
            <p className="text-2xl md:text-3xl leading-relaxed whitespace-pre-line">{step.text}</p>
            <div className="space-y-4">
              {step.photo_key ? <Photo id={step.photo_key} className="w-full md:w-80 aspect-video rounded-lg" icon={false} /> : null}
              {step.timer_min && (!timer.t || timer.t.step !== i) ? (
                <button type="button" onClick={() => timer.start(step.timer_min, i)} className="w-full md:w-80 inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-brand-on font-bold text-xl py-4">
                  <Timer size={24} /> Avvia {fmtQty(step.timer_min)} min
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="text-center py-20 text-text-muted">Nessun passaggio.</div>
        )}
      </main>

      {timer.t && (
        <div className={`mx-4 mb-3 rounded-lg border px-4 py-3 flex items-center gap-3 ${timer.ring ? 'bg-brand-accent text-white border-brand-accent animate-pulse' : 'bg-bg-surface border-bg-border'}`}>
          <Timer size={22} />
          <div className="flex-1">
            <div className="text-3xl font-bold tabular-nums">{timer.ring ? 'Tempo!' : mmss(timer.t.left)}</div>
            <div className="text-xs opacity-80">passo {timer.t.step + 1}</div>
          </div>
          {!timer.ring && (
            <button type="button" aria-label={timer.t.paused ? 'Riprendi' : 'Pausa'} onClick={timer.toggle} className="w-12 h-12 rounded-md bg-bg-elevated border border-bg-border flex items-center justify-center text-text-primary">
              {timer.t.paused ? <Play size={20} /> : <Pause size={20} />}
            </button>
          )}
          {!timer.ring && (
            <button type="button" aria-label="Ricomincia" onClick={() => timer.start(timer.t.total / 60, timer.t.step)} className="w-12 h-12 rounded-md bg-bg-elevated border border-bg-border flex items-center justify-center text-text-primary">
              <RotateCcw size={20} />
            </button>
          )}
          <button type="button" aria-label="Ferma timer" onClick={timer.stop} className={`h-12 px-4 rounded-md font-bold ${timer.ring ? 'bg-white text-brand-accent' : 'bg-bg-elevated border border-bg-border text-text-primary'}`}>
            {timer.ring ? 'OK' : <X size={20} />}
          </button>
        </div>
      )}

      <footer className="grid grid-cols-2 gap-3 px-4 pb-4 pt-1">
        <button type="button" disabled={i === 0 || showIng} onClick={() => setI((x) => x - 1)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-bg-elevated border border-bg-border py-5 text-lg font-semibold disabled:opacity-30">
          <ChevronLeft size={24} /> Indietro
        </button>
        {last || !steps.length ? (
          <button type="button" onClick={() => nav(`/ricette/${id}?cucinato=1&porzioni=${servings}${params.get('piano') ? `&piano=${params.get('piano')}` : ''}`)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-positive text-white py-5 text-lg font-bold">
            <ChefHat size={24} /> Fatto!
          </button>
        ) : (
          <button type="button" disabled={showIng} onClick={() => setI((x) => x + 1)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-brand text-brand-on py-5 text-lg font-bold disabled:opacity-30">
            Avanti <ChevronRight size={24} />
          </button>
        )}
      </footer>
    </div>
  );
}
