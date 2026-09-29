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

export const TIMES = [
  { v: '≤ 15′', max: 15 },
  { v: '≤ 30′', max: 30 },
  { v: '≤ 1 h', max: 60 },
  { v: '> 1 h', max: Infinity },
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
  if (r.difficulty) return { value: r.difficulty, auto: false };
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
  return { value: score <= 1 ? 'facile' : score <= 3 ? 'media' : 'difficile', auto: true };
}

// Tag "spazzatura" degli export (keywords SEO) e doppioni dei tag automatici.
const JUNK = new Set(['ricetta', 'ricette', 'cucina', 'cucinare', 'recipe', 'recipes', 'giallozafferano', 'facile', 'media', 'difficile', 'veloce']);
export function cleanTags(tags, title) {
  const t = low(title).trim();
  return parseList(tags).filter((x) => {
    const s = low(x);
    if (JUNK.has(s) || s === t || (t && t.includes(s) && s.split(' ').length > 2)) return false;
    return !COURSE_RULES.some(([re]) => re.test(s) && /piatti|^antipasti$|^contorni$|^dolci$|^salse/.test(s));
  });
}

export function autoTags(r, ings, steps) {
  return { course: courseOf(r), time: timeOf(r), difficulty: difficultyOf(r, ings, steps) };
}
