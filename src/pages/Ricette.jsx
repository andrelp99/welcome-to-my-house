import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Plus, Search, Clock, Star, BookOpen, Download, Leaf, CalendarDays, Link2, ChevronRight } from 'lucide-react';
import { recipeSeason, monthName } from '../db/season.js';
import { useData, useRecipes } from '../hooks/useData.js';
import { Button, Tabs, Empty, Select } from '../components/ui/kit.jsx';
import { Photo, SubstitutionsPanel } from '../components/recipes.jsx';
import { recipeStatus, parseList, DIET_TAGS, DIFFICULTY } from '../db/recipes.js';
import { countUnlinked } from '../db/linker.js';
import { autoTags, cleanTags, COURSES, TIMES } from '../db/tags.js';
import { expiringSet, urgentOf, recipeCost, nutritionOf } from '../db/insights.js';
import { euro } from '../db/logic.js';

export default function Ricette() {
  const data = useData();
  const rec = useRecipes();
  const nav = useNavigate();
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [diet, setDiet] = useState([]);
  const [season, setSeason] = useState(false);
  const [fCourse, setFCourse] = useState('');
  const [fTime, setFTime] = useState('');
  const [fDiff, setFDiff] = useState('');
  const [sort, setSort] = useState('scade');
  const month = new Date().getMonth() + 1;

  const rows = useMemo(() => {
    if (!data || !rec) return [];
    const exp = expiringSet(data);
    return rec.list.map((r) => {
      const ings = rec.ings[r.id] || [];
      const scale = 1 / (r.servings || 1);
      return {
        r,
        st: recipeStatus(ings, scale, data, rec.subs),
        diet: parseList(r.diet_tags),
        tags: cleanTags(r.tags, r.title),
        auto: autoTags(r, ings, rec.steps[r.id] || []),
        season: recipeSeason(ings, month).seasonal,
        urgent: urgentOf(ings, exp, data),
        cost: recipeCost(ings, scale, data),
        kcal: nutritionOf(r)?.kcal ?? null,
      };
    });
  }, [data, rec, month]);

  if (!data || !rec) return null;
  const s = q.trim().toLowerCase();
  const list = rows.filter(({ r, st, diet: d, tags, season: inSeason, auto }) => {
    if (season && !inSeason) return false;
    if (fCourse && auto.course?.value !== fCourse) return false;
    if (fTime && TIMES.findIndex((x) => x.v === auto.time) > TIMES.findIndex((x) => x.v === fTime)) return false;
    if (fTime && !auto.time) return false;
    if (fDiff && auto.difficulty?.value !== fDiff) return false;
    if (tab === 'ok' && !st.feasible) return false;
    if (tab === 'fav' && !r.favorite) return false;
    if (diet.length && !diet.every((t) => d.includes(t))) return false;
    if (s) {
      const hay = [r.title, ...tags, ...(rec.ings[r.id] || []).map((i) => i.text)].join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
  const SORTS = {
    scade: (a, b) => b.urgent.length - a.urgent.length || b.st.feasible - a.st.feasible || a.r.title.localeCompare(b.r.title, 'it'),
    // prima le ricette con tutti i prezzi noti, poi quelle parziali (il costo e' un minimo)
    costo: (a, b) => (a.cost.known ? (a.cost.unknown.length ? 1 : 0) : 2) - (b.cost.known ? (b.cost.unknown.length ? 1 : 0) : 2) || a.cost.total - b.cost.total || a.r.title.localeCompare(b.r.title, 'it'),
    kcal: (a, b) => (a.kcal ?? Infinity) - (b.kcal ?? Infinity),
    nome: (a, b) => a.r.title.localeCompare(b.r.title, 'it'),
  };
  list.sort(SORTS[sort]);
  const unlinked = countUnlinked(rec, data);
  const counts = { all: rows.length, ok: rows.filter((x) => x.st.feasible).length, fav: rows.filter((x) => x.r.favorite).length };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Ricettario</h1>
          <p className="text-text-secondary text-sm">Dosi per 1 porzione, confrontate con la dispensa. <span className="text-warning">*</span> = con sostituti.</p>
        </div>
        {tab !== 'subs' && (
          <div className="flex gap-2 shrink-0">
            <Button variant="ghost" aria-label="Planner" onClick={() => nav('/planner')}>
              <CalendarDays size={18} /> <span className="hidden sm:inline">Planner</span>
            </Button>
            <Button variant="ghost" aria-label="Importa ricette" onClick={() => nav('/ricette/importa')}>
              <Download size={18} /> <span className="hidden sm:inline">Importa</span>
            </Button>
            <Button aria-label="Nuova ricetta" onClick={() => nav('/ricette/nuova')}>
              <Plus size={18} /> <span className="hidden sm:inline">Nuova</span>
            </Button>
          </div>
        )}
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'all', label: 'Tutte', count: counts.all },
          { value: 'ok', label: 'Fattibili', count: counts.ok },
          { value: 'fav', label: '★ Preferite', count: counts.fav },
          { value: 'subs', label: 'Sostituti' },
        ]}
      />

      {tab !== 'subs' && unlinked > 0 && (
        <Link to="/ricette/collega" className="flex items-center gap-3 rounded-lg border border-brand/50 bg-brand/10 px-4 py-3 hover:border-brand">
          <Link2 size={18} className="text-brand shrink-0" />
          <span className="flex-1 text-sm">
            <b>{unlinked} ingredienti</b> non collegati alla dispensa: le ricette non sanno cosa hai in casa.
          </span>
          <span className="text-brand text-sm font-semibold inline-flex items-center">Collega <ChevronRight size={16} /></span>
        </Link>
      )}

      {tab === 'subs' ? (
        <SubstitutionsPanel data={data} rec={rec} />
      ) : (
        <>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Cerca per nome, tag o ingrediente…"
              className="w-full rounded-md bg-bg-elevated border border-bg-border pl-9 pr-3 py-2.5 placeholder:text-text-muted focus:outline-none focus:border-brand"
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordina">
              <option value="scade">Prima ciò che scade</option>
              <option value="costo">Più economiche</option>
              <option value="kcal">Meno calorie</option>
              <option value="nome">Nome</option>
            </Select>
            <Select value={fCourse} onChange={(e) => setFCourse(e.target.value)} aria-label="Portata">
              <option value="">Portata</option>
              {COURSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select value={fTime} onChange={(e) => setFTime(e.target.value)} aria-label="Tempo">
              <option value="">Tempo</option>
              {TIMES.slice(0, 3).map((t) => <option key={t.v} value={t.v}>{t.v}</option>)}
            </Select>
            <Select value={fDiff} onChange={(e) => setFDiff(e.target.value)} aria-label="Difficoltà">
              <option value="">Difficoltà</option>
              {DIFFICULTY.map((d) => <option key={d} value={d}>{d}</option>)}
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSeason((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border ${season ? 'bg-positive text-white border-positive' : 'border-positive/50 text-positive'}`}
            >
              <Leaf size={12} /> di stagione ({monthName(month)})
            </button>
            {DIET_TAGS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setDiet((d) => (d.includes(t) ? d.filter((x) => x !== t) : [...d, t]))}
                className={`rounded-full px-3 py-1 text-xs font-medium border ${diet.includes(t) ? 'bg-brand text-brand-on border-brand' : 'border-bg-border text-text-secondary'}`}
              >
                {t}
              </button>
            ))}
          </div>

          {list.length === 0 ? (
            <Empty icon={BookOpen}>{rows.length === 0 ? 'Nessuna ricetta. Crea con + o importa (link, testo, foto, file GZ).' : 'Nessuna ricetta con questi filtri.'}</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map(({ r, st, diet: d, season: inSeason, auto, urgent, cost, kcal }) => {
                return (
                  <Link key={r.id} to={`/ricette/${r.id}`} className="flex sm:flex-col gap-3 sm:gap-0 rounded-lg border border-bg-border bg-bg-surface shadow-card overflow-hidden hover:border-brand transition-colors">
                    <Photo id={r.photo_key} className="w-24 h-24 sm:w-full sm:h-36 shrink-0" />
                    <div className="flex-1 min-w-0 py-2 pr-3 sm:p-3 space-y-1">
                      <div className="font-semibold leading-snug line-clamp-2">
                        {r.favorite ? <Star size={14} className="inline -mt-1 mr-1 fill-brand text-brand" /> : null}
                        {r.title}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                        {auto.course && <span className="font-semibold text-text-secondary">{auto.course.value}</span>}
                        {auto.time && (
                          <span className="inline-flex items-center gap-1">
                            <Clock size={12} /> {auto.time}
                          </span>
                        )}
                        {auto.difficulty && <span>{auto.difficulty.value}</span>}
                        {cost.known > 0 && <span title={cost.unknown.length ? `senza prezzo: ${cost.unknown.join(', ')}` : 'costo stimato per porzione'}>{euro(cost.total)}{cost.unknown.length ? '+' : ''}</span>}
                        {kcal != null && <span>{Math.round(kcal)} kcal</span>}
                        {r.cooked_count ? <span>cucinata {r.cooked_count}×</span> : null}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <StatusChip st={st} />
                        {urgent.length > 0 && (
                          <span title={`in scadenza: ${urgent.join(', ')}`} className="rounded-full bg-warning/15 text-warning border border-warning/40 px-2 py-0.5 text-[11px] font-semibold">
                            usa {urgent.length === 1 ? urgent[0] : `${urgent.length} in scadenza`}
                          </span>
                        )}
                        {inSeason && <Leaf size={14} className="text-positive self-center" aria-label="di stagione" />}
                        {d.slice(0, 2).map((t) => (
                          <span key={t} className="rounded-full border border-bg-border px-2 py-0.5 text-[11px] text-text-secondary">{t}</span>
                        ))}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function StatusChip({ st }) {
  if (st.feasible)
    return (
      <span className="rounded-full bg-positive/15 text-positive border border-positive/40 px-2 py-0.5 text-[11px] font-semibold">
        fattibile{st.withSub ? <span className="text-warning" title="con sostituti">*</span> : ''}
      </span>
    );
  if (st.missing)
    return <span className="rounded-full bg-negative/15 text-negative border border-negative/40 px-2 py-0.5 text-[11px] font-semibold">manca{st.missing === 1 ? '' : 'no'} {st.missing}</span>;
  return <span className="rounded-full border border-bg-border px-2 py-0.5 text-[11px] text-text-muted">da collegare</span>;
}
