import { parseList } from './recipes.js';

// Tag automatici delle ricette: portata, tempo, difficolta'. Calcolati al volo (nessun dato da migrare);
// la portata si puo' fissare a mano (recipes.course), la difficolta' pure (recipes.difficulty).

export const COURSES = ['Antipasto', 'Primo', 'Secondo', 'Contorno', 'Piatto unico', 'Dolce', 'Salsa e sugo', 'Pane e lievitati', 'Colazione', 'Bevanda'];

const COURSE_RULES = [
  [/piatt[oi] unic/, 'Piatto unico'],
  [/antipast|aperitiv|finger|stuzzich/, 'Antipasto'],
  [/\bprim[oi]\b|primi piatti|risott|pasta|zupp|minestr|vellutat/, 'Primo'],
  [/\bsecond[oi]\b|secondi piatti/, 'Secondo'],
  [/contorn|insalat/, 'Contorno'],
  [/dolc|dessert|tort[ae]\b|biscott|budin|gelat|crostat|tiramis/, 'Dolce'],
  [/sals[ae]|sug[oh]i?\b|pesto|condiment/, 'Salsa e sugo'],
  [/lievitat|\bpane\b|pizz|focacc|piadin/, 'Pane e lievitati'],
  [/colazion|pancake|brioche/, 'Colazione'],
  [/bevand|cocktail|drink|frullat|smoothie/, 'Bevanda'],
];

const low = (s) => String(s || '').toLowerCase();

// Portata: scelta a mano, altrimenti dedotta dai tag (categoria GZ) e poi dal titolo.
export function courseOf(r) {
  if (r.course) return { value: r.course, auto: false };
  for (const src of [parseList(r.tags).join(' | '), r.title]) {
    const s = low(src);
    for (const [re, c] of COURSE_RULES) if (re.test(s)) return { value: c, auto: true };
  }
  return null;
}

// Tempo totale (preparazione + cottura + riposo).
export const TIMES = [
  { v: 'Breve', max: 30, hint: '≤ 30′' },
  { v: 'Medio', max: 60, hint: '30–60′' },
  { v: 'Lungo', max: Infinity, hint: '> 60′' },
];
export function totalMin(r) {
  return (Number(r.prep_min) || 0) + (Number(r.cook_min) || 0) + (Number(r.rest_min) || 0);
}
export function timeOf(r) {
  const t = totalMin(r);
  if (!t) return null;
  return TIMES.find((x) => t <= x.max).v;
}

// Difficolta': quella scritta, altrimenti stimata da ingredienti, passaggi e tempo attivo.
export function difficultyOf(r, ings = [], steps = []) {
  if (r.difficulty) return { value: r.difficulty, label: DIFF_LABEL[r.difficulty] || r.difficulty, auto: false };
  const n = ings.filter((i) => !i.optional).length;
  const active = (Number(r.prep_min) || 0) + (Number(r.cook_min) || 0);
  if (!n && !steps.length) return null;
  let score = 0;
  if (n > 8) score++;
  if (n > 13) score++;
  if (steps.length > 5) score++;
  if (steps.length > 9) score++;
  if (active > 60) score++;
  if (active > 120) score++;
  const value = score <= 1 ? 'facile' : score <= 3 ? 'media' : 'difficile';
  return { value, label: DIFF_LABEL[value], auto: true };
}

// Tag "spazzatura" degli export (keywords SEO) e doppioni dei tag automatici.
const JUNK = new Set(['ricetta', 'ricette', 'cucina', 'cucinare', 'recipe', 'recipes', 'giallozafferano', 'facile', 'media', 'difficile', 'veloce']);
// Tag della 0.10 (AI a tag liberi) ora coperti da base e caratteristiche: nascosti per non duplicare.
const OLD_AI = new Set(['pollo', 'manzo', 'maiale', 'vitello', 'agnello', 'pesce', 'crostacei', 'molluschi', 'uova', 'formaggi', 'legumi', 'verdure', 'funghi', 'patate', 'pasta', 'riso', 'cereali',
  'al forno', 'in padella', 'alla griglia', 'fritto', 'bollito', 'al vapore', 'in umido', 'crudo', 'slow cooking', 'tutti i giorni', 'cena con ospiti', 'festa', 'schiscetta', 'meal prep', 'estate', 'inverno',
  'leggero', 'sostanzioso', 'piccante', 'comfort food', 'economico', 'per bambini']);
export function cleanTags(tags, title) {
  const t = low(title).trim();
  return parseList(tags).filter((x) => {
    const s = low(x);
    if (JUNK.has(s) || OLD_AI.has(s) || s === t || (t && t.includes(s) && s.split(' ').length > 2)) return false;
    return !COURSE_RULES.some(([re]) => re.test(s) && /piatti|^antipasti$|^contorni$|^dolci$|^salse/.test(s));
  });
}

// Difficolta': valori salvati facile/media/difficile, mostrati cosi'.
export const DIFF_LABEL = { facile: 'Semplice', media: 'Media', difficile: 'Complessa' };

// Portata: 6 principali + "Altro" (salse, pane, colazione, bevande).
export const COURSE_MAIN = ['Antipasto', 'Primo', 'Secondo', 'Contorno', 'Piatto unico', 'Dolce'];
export const courseGroup = (v) => (!v ? null : COURSE_MAIN.includes(v) ? v : 'Altro');

// Base: alimento principale (+ secondario facoltativo), salvato come "Gruppo" o "Gruppo|sotto".
export const BASES = [
  { id: 'Carne', subs: ['bianca', 'rossa', 'maiale', 'salumi'] },
  { id: 'Pesce', subs: ['pesce', 'crostacei', 'molluschi'] },
  { id: 'Uova', subs: [] },
  { id: 'Latticini', subs: ['formaggi', 'ricotta', 'yogurt'] },
  { id: 'Proteine', subs: ['legumi', 'tofu e seitan', 'altre'] },
  { id: 'Carboidrati', subs: ['pasta', 'riso', 'cereali', 'pane e impasti', 'patate'] },
  { id: 'Verdure', subs: ['ortaggi', 'funghi', 'frutta'] },
];
export const BASE_VALUES = BASES.flatMap((b) => [b.id, ...b.subs.map((x) => `${b.id}|${x}`)]);
export function parseFood(v) {
  if (!v) return null;
  const [group, sub] = String(v).split('|');
  return BASES.some((b) => b.id === group) ? { group, sub: sub || null, value: v } : null;
}
export const foodLabel = (v) => {
  const f = parseFood(v);
  return f ? (f.sub ? `${f.group} · ${f.sub}` : f.group) : null;
};

// Caratteristiche: piu' di una per ricetta. Le "calcolate" non si salvano: si ricavano da kcal, costo, riposo.
export const FEATURE_GROUPS = [
  { id: 'conservazione', label: 'Conservazione', items: [['congela', '❄ si congela bene'], ['frigo', 'dura 2–3 gg in frigo'], ['subito', 'da mangiare subito'], ['mealprep', 'meal prep']] },
  { id: 'servizio', label: 'Come si mangia', items: [['freddo', 'freddo'], ['tiepido', 'tiepido / ambiente'], ['caldo', 'caldo'], ['crudo', 'crudo (senza cottura)']] },
  { id: 'cottura', label: 'Cottura', items: [['forno', 'forno'], ['padella', 'padella'], ['griglia', 'griglia'], ['fritto', 'fritto'], ['bollito', 'bollito / vapore'], ['umido', 'in umido / lenta']] },
  { id: 'praticita', label: 'Praticità', items: [['schiscetta', 'da portare via'], ['unapentola', 'una sola pentola'], ['anticipo', 'si prepara in anticipo']] },
  { id: 'profilo', label: 'Profilo', items: [['proteico', 'proteico'], ['sostanzioso', 'sostanzioso'], ['piccante', 'piccante']] },
  { id: 'occasione', label: 'Occasione', items: [['quotidiano', 'tutti i giorni'], ['ospiti', 'ospiti'], ['festa', 'festa'], ['estate', 'estate'], ['inverno', 'inverno']] },
];
export const COMPUTED_FEATURES = [['leggero', 'leggero (≤ 500 kcal/porz.)'], ['economico', 'economico (≤ 2 €/porz.)'], ['riposo', 'richiede riposo']];
export const FEATURE_IDS = FEATURE_GROUPS.flatMap((g) => g.items.map(([id]) => id));
export const FEATURE_LABEL = Object.fromEntries([...FEATURE_GROUPS.flatMap((g) => g.items), ...COMPUTED_FEATURES]);
export const LIGHT_KCAL = 500;
export const CHEAP_EUR = 2;
export const REST_MIN = 30;

// Caratteristiche di una ricetta: salvate + calcolate (sempre su 1 porzione).
// kcal = per porzione; cost = { total, known, unknown } per 1 porzione.
export function featuresOf(r, { kcal = null, cost = null } = {}) {
  const out = new Set(parseList(r.features).filter((x) => FEATURE_IDS.includes(x)));
  if (kcal != null && kcal <= LIGHT_KCAL) out.add('leggero');
  if (cost && cost.known > 0 && !cost.unknown.length && cost.total <= CHEAP_EUR) out.add('economico');
  if ((Number(r.rest_min) || 0) >= REST_MIN) out.add('riposo');
  return out;
}

export function autoTags(r, ings, steps) {
  const course = courseOf(r);
  return {
    course,
    courseGroup: courseGroup(course?.value),
    time: timeOf(r),
    difficulty: difficultyOf(r, ings, steps),
    main: parseFood(r.main_food),
    second: parseFood(r.second_food),
  };
}
