import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Plus, Search, Clock, BookOpen, Download, Leaf, CalendarDays, Link2, ChevronRight, Sparkles } from 'lucide-react';
import { recipeSeason, monthName } from '../db/season.js';
import { useData, useRecipes } from '../hooks/useData.js';
import { Button, Tabs, Empty, Select } from '../components/ui/kit.jsx';
import { Photo, SubstitutionsPanel } from '../components/recipes.jsx';
import { recipeStatus, parseList, DIET_TAGS, DIFFICULTY } from '../db/recipes.js';
import { countUnlinked } from '../db/linker.js';
import { autoTags, cleanTags, TIMES, COURSE_MAIN, BASES, DIFF_LABEL, FEATURE_GROUPS, COMPUTED_FEATURES, FEATURE_LABEL, featuresOf, foodLabel } from '../db/tags.js';
import { expiringSet, urgentOf, recipeCost, nutritionOf } from '../db/insights.js';
import { euro } from '../db/logic.js';
import { rankRecipes, recipeAsDish } from '../db/meals.js';
import { GOAL_BY_ID } from '../db/variety.js';

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
  const [sort, setSort] = useState('consigliate');
  const [params, setParams] = useSearchParams();
  const goal = GOAL_BY_ID[params.get('obiettivo')];
  const [fTags, setFTags] = useState([]);
  const [fBase, setFBase] = useState('');
  const [fFeat, setFFeat] = useState([]);
  const [showFeat, setShowFeat] = useState(false);
  const month = new Date().getMonth() + 1;

  const rows = useMemo(() => {
    if (!data || !rec) return [];
    const exp = expiringSet(data);
    const ranked = Object.fromEntries(rankRecipes(rec, data).map((x) => [x.r.id, x]));
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
        rank: ranked[r.id],
      };
    }).map((x) => ({ ...x, feats: featuresOf(x.r, { kcal: x.kcal, cost: x.cost }) }));
  }, [data, rec, month]);

  if (!data || !rec) return null;
  const s = q.trim().toLowerCase();
  const baseMatch = (auto) => [auto.main, auto.second, auto.third].some((f) => f && (fBase.includes('|') ? f.value === fBase : f.group === fBase));
  const list = rows.filter(({ r, st, diet: d, tags, season: inSeason, auto, feats }) => {
    if (season && !inSeason) return false;
    if (goal?.match && !goal.match(recipeAsDish(r))) return false;
    if (fCourse && auto.courseGroup !== fCourse) return false;
    if (fBase && !baseMatch(auto)) return false;
    if (fTime && auto.time !== fTime) return false;
    if (fFeat.length && !fFeat.every((f) => feats.has(f))) return false;
    if (fDiff && auto.difficulty?.value !== fDiff) return false; // valori facile/media/difficile
    if (fTags.length && !fTags.every((t) => tags.includes(t))) return false;
    if (tab === 'ok' && !st.feasible) return false;
    if (tab === 'fav' && Number(r.rating) !== 5) return false;
    if (diet.length && !diet.every((t) => d.includes(t))) return false;
    if (s) {
      const hay = [r.title, ...tags, ...(rec.ings[r.id] || []).map((i) => i.text)].join(' ').toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
  const SORTS = {
    consigliate: (a, b) => (b.rank?.total ?? -1) - (a.rank?.total ?? -1) || a.r.title.localeCompare(b.r.title, 'it'),
    scade: (a, b) => b.urgent.length - a.urgent.length || b.st.feasible - a.st.feasible || a.r.title.localeCompare(b.r.title, 'it'),
    // prima le ricette con tutti i prezzi noti, poi quelle parziali (il costo e' un minimo)
    costo: (a, b) => (a.cost.known ? (a.cost.unknown.length ? 1 : 0) : 2) - (b.cost.known ? (b.cost.unknown.length ? 1 : 0) : 2) || a.cost.total - b.cost.total || a.r.title.localeCompare(b.r.title, 'it'),
    kcal: (a, b) => (a.kcal ?? Infinity) - (b.kcal ?? Infinity),
    nome: (a, b) => a.r.title.localeCompare(b.r.title, 'it'),
  };
  list.sort(SORTS[sort]);
  const unlinked = countUnlinked(rec, data);
  const tagFreq = {};
  for (const x of rows) for (const t of x.tags) tagFreq[t] = (tagFreq[t] || 0) + 1;
  const topTags = Object.entries(tagFreq).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t]) => t);
  const unclassified = rows.filter((x) => !x.r.main_food || !x.feats.size).length;
  const activeFilters = fFeat.length + diet.length + (season ? 1 : 0);
  const counts = { all: rows.length, ok: rows.filter((x) => x.st.feasible).length, fav: rows.filter((x) => Number(x.r.rating) === 5).length };

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
          { value: 'fav', label: '★★★★★ Preferite', count: counts.fav },
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

      {goal && tab !== 'subs' && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 px-4 py-2 text-sm">
          <span>Obiettivo della settimana: <b>{goal.label}</b></span>
          <button type="button" className="text-brand font-semibold" onClick={() => setParams({})}>Tutte</button>
        </div>
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
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordina">
              <option value="consigliate">Consigliate</option>
              <option value="scade">Prima ciò che scade</option>
              <option value="costo">Più economiche</option>
              <option value="kcal">Meno calorie</option>
              <option value="nome">Nome</option>
            </Select>
            <Select value={fCourse} onChange={(e) => setFCourse(e.target.value)} aria-label="Portata">
              <option value="">Portata</option>
              {[...COURSE_MAIN, 'Altro'].map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
            <Select value={fBase} onChange={(e) => setFBase(e.target.value)} aria-label="Base">
              <option value="">Base</option>
              {BASES.map((b) => (
                <optgroup key={b.id} label={b.id}>
                  <option value={b.id}>{b.id} (tutto)</option>
                  {b.subs.map((x) => <option key={x} value={`${b.id}|${x}`}>{`${b.id} · ${x}`}</option>)}
                </optgroup>
              ))}
            </Select>
            <Select value={fTime} onChange={(e) => setFTime(e.target.value)} aria-label="Tempo">
              <option value="">Tempo</option>
              {TIMES.map((t) => <option key={t.v} value={t.v}>{`${t.v} (${t.hint})`}</option>)}
            </Select>
            <Select value={fDiff} onChange={(e) => setFDiff(e.target.value)} aria-label="Difficoltà">
              <option value="">Difficoltà</option>
              {DIFFICULTY.map((d) => <option key={d} value={d}>{DIFF_LABEL[d]}</option>)}
            </Select>
          </div>
          <button type="button" onClick={() => setShowFeat((v) => !v)} className="text-sm font-semibold text-brand">
            Caratteristiche{activeFilters ? ` (${activeFilters})` : ''} {showFeat ? '▴' : '▾'}
          </button>
          {showFeat && (
          <div className="space-y-2 rounded-lg border border-bg-border bg-bg-surface p-3">
            {[{ id: 'calc', label: 'Calcolate (1 porzione)', items: COMPUTED_FEATURES }, ...FEATURE_GROUPS].map((g) => (
              <div key={g.id} className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] uppercase tracking-wider text-text-muted w-full">{g.label}</span>
                {g.items.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setFFeat((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))}
                    className={`rounded-full px-2.5 py-0.5 text-xs border ${fFeat.includes(id) ? 'bg-brand text-brand-on border-brand' : 'border-bg-border text-text-secondary'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider text-text-muted w-full">Dieta e stagione</span>
            <button
              type="button"
              onClick={() => setSeason((v) => !v)}
              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium border ${season ? 'bg-positive text-white border-positive' : 'border-positive/50 text-positive'}`}
            >
              <Leaf size={12} /> di stagione ({monthName(month)})
            </button>
            {DIET_TAGS.filter((t) => t !== 'veloce' && t !== 'leggero').map((t) => (
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
          </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {[...new Set([...fTags, ...topTags])].map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setFTags((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]))}
                className={`rounded-full px-2.5 py-0.5 text-xs border ${fTags.includes(t) ? 'bg-brand text-brand-on border-brand' : 'border-bg-border text-text-secondary'}`}
              >
                #{t}
              </button>
            ))}
            <Link to="/ricette/tag" className="inline-flex items-center gap-1 text-xs font-semibold text-brand">
              <Sparkles size={12} /> {unclassified ? `Classifica con AI (${unclassified} da fare)` : 'Classifica con AI'}
            </Link>
          </div>

          {list.length === 0 ? (
            <Empty icon={BookOpen}>{rows.length === 0 ? 'Nessuna ricetta. Crea con + o importa (link, testo, foto, file GZ).' : 'Nessuna ricetta con questi filtri.'}</Empty>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {list.map(({ r, st, diet: d, season: inSeason, auto, urgent, cost, kcal, feats, rank }) => {
                return (
                  <Link key={r.id} to={`/ricette/${r.id}`} className="flex sm:flex-col gap-3 sm:gap-0 rounded-lg border border-bg-border bg-bg-surface shadow-card overflow-hidden hover:border-brand transition-colors">
                    <Photo id={r.photo_key} className="w-24 h-24 sm:w-full sm:h-36 shrink-0" />
                    <div className="flex-1 min-w-0 py-2 pr-3 sm:p-3 space-y-1">
                      <div className="font-semibold leading-snug line-clamp-2">
                        {r.title}
                        {r.rating ? <span className="ml-1.5 text-xs text-brand font-normal">★{r.rating}</span> : null}
                      </div>
                      {sort === 'consigliate' && rank && (
                        <div className="text-[11px] text-text-muted line-clamp-1">
                          {rank.total >= 0 ? <><b className="text-brand">{rank.total}</b> · {rank.reasons.slice(0, 3).join(' · ')}</> : <span>esclusa: {rank.excluded}</span>}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
                        {auto.course && <span className="font-semibold text-text-secondary">{auto.course.value}</span>}
                        {auto.main && <span className="text-text-secondary">{foodLabel(auto.main.value)}</span>}
                        {auto.time && (
                          <span className="inline-flex items-center gap-1">
                            <Clock size={12} /> {auto.time}
                          </span>
                        )}
                        {auto.difficulty && <span>{auto.difficulty.label}</span>}
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
                        {[...d.filter((t) => t !== 'leggero' && t !== 'veloce'), ...[...feats].map((f) => FEATURE_LABEL[f])].slice(0, 3).map((t) => (
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
