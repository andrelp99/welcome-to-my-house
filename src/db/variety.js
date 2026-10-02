// Varieta' a tavola: obiettivi settimanali/mensili, punteggio delle ricette "Consigliate".
// Modulo PURO (niente Dexie, niente DOM): lo usa anche il Worker per il riepilogo della domenica.

export const MEALS_ALL = [
  { id: 'colazione', label: 'Colazione', extra: true, slots: 1 },
  { id: 'pranzo', label: 'Pranzo', slots: 3 },
  { id: 'merenda', label: 'Merenda', extra: true, slots: 1 },
  { id: 'cena', label: 'Cena', slots: 3 },
];
export const PLACES = [
  { id: 'casa', label: 'Casa' },
  { id: 'schiscia', label: 'Schiscia' },
  { id: 'crema', label: 'Casa Crema' },
  { id: 'ristorante', label: 'Ristorante' },
  { id: 'lavoro', label: 'Lavoro / mensa' },
  { id: 'amici', label: 'Amici / parenti' },
  { id: 'delivery', label: 'Delivery' },
];
export const OUT_PLACES = ['ristorante', 'amici', 'delivery']; // "fuori" per gli obiettivi (la mensa no)
export const HOME_PLACES = ['casa', 'schiscia']; // cucinato da me: scala la dispensa, conta come "a casa"
export const COST_PLACES = ['ristorante', 'lavoro', 'amici', 'delivery']; // luoghi con costo del pasto

// Frequenza desiderata 🔁 → giorni tra una volta e l'altra. 0 = non propormela.
export const FREQ_DAYS = { 5: 7, 4: 14, 3: 30, 2: 75, 1: 150 };
export const FREQ_LABEL = { 5: 'ogni settimana', 4: 'ogni 2 settimane', 3: 'una volta al mese', 2: 'ogni 2–3 mesi', 1: 'raramente', 0: 'non propormela' };
export const DEFAULT_WEIGHTS = { var: 32, grad: 28, rit: 14, scad: 18, fatt: 8 };
export const WEIGHT_LABELS = { var: 'Varietà', grad: 'Gradimento', rit: 'Ritardo', scad: 'Scadenze', fatt: 'Fattibile' };

const list = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const DAY = 86400000;
export const isoDay = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const toDate = (iso) => new Date(`${iso}T12:00:00`);
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
export const addDaysIso = (iso, n) => isoDay(toDate(iso).getTime() + n * DAY);
export function weekStartIso(iso) {
  const d = toDate(iso);
  const wd = (d.getDay() + 6) % 7; // lunedi' = 0
  return isoDay(d.getTime() - wd * DAY);
}
export const mealId = (date, meal) => `ml-${date}-${meal}`;

// ── Piatto normalizzato ──
// entry = riga meal_plan; recipe = ricetta collegata (ricetta o avanzo). courseOf: funzione facoltativa per la portata dedotta.
export function toDish(entry, recipe, meal, courseOf) {
  const r = recipe || null;
  const course = r ? r.course || (courseOf ? courseOf(r)?.value : null) || null : entry.dish_course || null;
  return {
    id: entry.id,
    date: entry.date,
    meal: entry.meal,
    place: meal?.place || 'casa',
    recipe_id: entry.recipe_id || entry.leftover_of || null,
    leftover: !!entry.leftover_of,
    title: r?.title || entry.note || 'Piatto',
    course,
    main: r ? r.main_food || null : entry.dish_main || null,
    second: r ? r.second_food || null : entry.dish_second || null,
    third: r ? r.third_food || null : null,
    feats: new Set(list(r ? r.features : entry.dish_features)),
    usedExpiring: Number(entry.used_expiring) || 0,
    rating: r ? Number(r.rating) || null : null,
    item: !r && list(entry.dish_features).includes('alimento'),
    n: !r && list(entry.dish_features).includes('alimento') ? Math.max(1, Math.round(Number(entry.servings) || 1)) : 1, // alimenti: 2 frutti = 2
  };
}
const grp = (v) => (v ? String(v).split('|')[0] : null);
// ha la base: "Pesce" (gruppo) o "Carne|rossa" (sottocategoria)
export const has = (dish, key) => [dish.main, dish.second, dish.third].some((v) => v && (key.includes('|') ? v === key : grp(v) === key));
const isVeg = (d) => has(d, 'Verdure|ortaggi') || has(d, 'Verdure|funghi') || (has(d, 'Verdure') && !has(d, 'Verdure|frutta')) || d.course === 'Contorno';
const isMeat = (d) => has(d, 'Carne');

// ── Alimenti singoli (frutta, verdura, dolci, snack…) aggiunti a un pasto ──
// Salvati come piatto con dish_features "alimento": contano negli obiettivi come la loro categoria.
export const ITEM_KINDS = [
  { id: 'frutta', label: 'Frutta', course: 'Frutta', main: 'Verdure|frutta', cat: 'cat-frutta' },
  { id: 'verdura', label: 'Verdura', course: 'Contorno', main: 'Verdure|ortaggi', cat: 'cat-verdura' },
  { id: 'dolce', label: 'Dolce', course: 'Dolce', main: null, cat: 'cat-colazione' },
  { id: 'snack', label: 'Snack', course: 'Snack', main: null, cat: 'cat-colazione' },
  { id: 'latticini', label: 'Latticini', course: 'Latticini', main: 'Latticini|yogurt', cat: 'cat-latte' },
  { id: 'pane', label: 'Pane / cracker', course: 'Pane e lievitati', main: null, cat: 'cat-pane' },
  { id: 'altro', label: 'Altro', course: null, main: null, cat: null },
];
export const ITEM_BY_ID = Object.fromEntries(ITEM_KINDS.map((k) => [k.id, k]));
export const itemKindOfCourse = (c) => ITEM_KINDS.find((k) => k.course === c && k.id !== 'altro') || ITEM_BY_ID.altro;
// Tipo dedotto dal prodotto (categoria + nome)
export function itemKindOf(p) {
  if (!p) return 'frutta';
  const n = String(p.name || '').toLowerCase();
  const c = p.category_id;
  if (c === 'cat-frutta') return /mandorl|noci|nocciol|pistacch|arachid|anacard|frutta secca/.test(n) ? 'snack' : 'frutta';
  if (c === 'cat-verdura') return 'verdura';
  if (c === 'cat-latte' || c === 'cat-formaggi') return 'latticini';
  if (c === 'cat-pane') return /biscott|brioche|cornett|torta/.test(n) ? 'dolce' : 'pane';
  if (c === 'cat-colazione') return /cracker|patatin|grissin|tarall|salatin|pop ?corn|mandorl|noci|arachid|barrett|gallett|chips/.test(n) ? 'snack' : 'dolce';
  if (/gelat|cioccol|biscott|torta|budin|merendin/.test(n)) return 'dolce';
  return 'altro';
}

// ── Obiettivi ──
// match(dish) = il piatto conta (usato anche per capire se una ricetta "aiuta" o "sfora").
// count(ctx) per quelli che non contano piatti (pasti, giorni, ricette, eventi).
const perDish = (match) => ({ match, count: (c) => c.dishes.filter(match).reduce((t, d) => t + (d.n || 1), 0) });
export const GOAL_DEFS = [
  { id: 'pesce', label: 'Pesce', period: 'week', min: 2, group: 'Proteine', ...perDish((d) => has(d, 'Pesce')) },
  { id: 'legumi', label: 'Legumi', period: 'week', min: 1, group: 'Proteine', ...perDish((d) => has(d, 'Proteine|legumi')) },
  { id: 'bianca', label: 'Carne bianca', period: 'week', min: 2, group: 'Proteine', ...perDish((d) => has(d, 'Carne|bianca')) },
  { id: 'rossa', label: 'Carne rossa', period: 'week', max: 2, group: 'Proteine', ...perDish((d) => has(d, 'Carne|rossa') || has(d, 'Carne|maiale')) },
  { id: 'salumi', label: 'Salumi', period: 'week', max: 2, group: 'Proteine', ...perDish((d) => has(d, 'Carne|salumi')) },
  { id: 'carne', label: 'Carne in totale', period: 'week', max: 5, group: 'Proteine', ...perDish(isMeat) },
  { id: 'uova', label: 'Uova', period: 'week', max: 2, group: 'Proteine', ...perDish((d) => has(d, 'Uova')) },
  { id: 'senzacarne', label: 'Giorni senza carne', period: 'week', min: 2, unit: 'giorni', group: 'Proteine', count: (c) => c.days.filter((day) => day.dishes.length && !day.dishes.some(isMeat)).length },
  { id: 'verdure', label: 'Verdure', period: 'week', min: 7, unit: 'pasti', group: 'Verdure e carboidrati', match: isVeg, count: (c) => c.mealsWithDishes.filter((m) => m.dishes.some(isVeg)).length },
  { id: 'verdure2', label: 'Verdura a pranzo e a cena', period: 'week', min: 3, unit: 'giorni', group: 'Verdure e carboidrati', count: (c) => c.days.filter((day) => ['pranzo', 'cena'].every((m) => day.dishes.some((d) => d.meal === m && isVeg(d)))).length },
  { id: 'pasta', label: 'Pasta', period: 'week', min: 3, max: 6, group: 'Verdure e carboidrati', ...perDish((d) => has(d, 'Carboidrati|pasta')) },
  { id: 'riso', label: 'Riso / risotto', period: 'week', min: 1, group: 'Verdure e carboidrati', ...perDish((d) => has(d, 'Carboidrati|riso')) },
  { id: 'patate', label: 'Patate', period: 'week', max: 3, group: 'Verdure e carboidrati', ...perDish((d) => has(d, 'Carboidrati|patate')) },
  { id: 'pizza', label: 'Pizza, pane e impasti', period: 'week', max: 2, group: 'Verdure e carboidrati', ...perDish((d) => has(d, 'Carboidrati|pane e impasti')) },
  { id: 'unici', label: 'Piatti unici', period: 'week', min: 1, group: 'Verdure e carboidrati', ...perDish((d) => d.course === 'Piatto unico') },
  { id: 'frutta', label: 'Frutta', period: 'week', min: 5, group: 'Frutta', ...perDish((d) => has(d, 'Verdure|frutta')) },
  { id: 'giornifrutta', label: 'Giorni con frutta', period: 'week', min: 4, unit: 'giorni', group: 'Frutta', count: (c) => c.days.filter((day) => day.dishes.some((d) => has(d, 'Verdure|frutta'))).length },
  { id: 'fritto', label: 'Fritto', period: 'week', max: 1, group: 'Stile e fuori casa', ...perDish((d) => d.feats.has('fritto')) },
  { id: 'fuori', label: 'Pasti fuori', period: 'week', max: 3, unit: 'pasti', group: 'Stile e fuori casa', count: (c) => c.realMeals.filter((m) => OUT_PLACES.includes(m.place)).length },
  { id: 'delivery', label: 'Delivery', period: 'week', max: 2, unit: 'pasti', group: 'Stile e fuori casa', count: (c) => c.realMeals.filter((m) => m.place === 'delivery').length },
  { id: 'casa', label: 'Pasti cucinati a casa', period: 'week', min: 8, unit: 'pasti', group: 'Stile e fuori casa', count: (c) => c.realMeals.filter((m) => HOME_PLACES.includes(m.place) && (m.meal === 'pranzo' || m.meal === 'cena')).length },
  { id: 'scadenze', label: 'Ricette con cose in scadenza', period: 'week', min: 2, group: 'Anti-spreco', count: (c) => c.dishes.filter((d) => d.usedExpiring > 0).length },
  { id: 'buttati', label: 'Prodotti buttati', period: 'week', max: 1, unit: 'prodotti', group: 'Anti-spreco', count: (c) => new Set(c.events.filter((e) => e.type === 'buttato').map((e) => `${e.product_id}|${e.date}`)).size },
  { id: 'diverse', label: 'Ricette diverse', period: 'month', min: 15, unit: 'ricette', group: 'Scoperta', count: (c) => new Set(c.dishes.filter((d) => d.recipe_id && !d.leftover).map((d) => d.recipe_id)).size },
  { id: 'nuove', label: 'Ricette nuove', period: 'month', min: 2, unit: 'ricette', group: 'Scoperta', count: (c) => [...c.firstDone.entries()].filter(([, date]) => date >= c.from && date <= c.to).length },
  {
    id: 'stessa', label: 'Stessa ricetta', period: 'month', max: 3, unit: 'volte (max)', group: 'Scoperta',
    count: (c) => {
      const n = {};
      for (const d of c.dishes) if (d.recipe_id && !d.leftover) n[d.recipe_id] = (n[d.recipe_id] || 0) + 1;
      return Math.max(0, ...Object.values(n));
    },
  },
  { id: 'top5', label: 'Ricette ★★★★★', period: 'month', min: 4, group: 'Scoperta', ...perDish((d) => !d.leftover && d.rating === 5) },
  { id: 'recuperate', label: 'Ricette recuperate', period: 'month', min: 3, group: 'Scoperta', count: (c) => c.dishes.filter((d) => c.recovered.has(d.id)).length },
];
export const GOAL_BY_ID = Object.fromEntries(GOAL_DEFS.map((g) => [g.id, g]));

// Configurazione salvata (settings "goals"): { id: { on, min, max } }. Senza configurazione: tutti attivi coi default.
export function goalConfig(saved) {
  return GOAL_DEFS.map((g) => {
    const s = saved?.[g.id] || {};
    const pick = (k) => (k in s ? (s[k] === '' || s[k] == null ? null : Number(s[k])) : g[k] ?? null);
    return { ...g, on: s.on ?? true, min: pick('min'), max: pick('max') };
  });
}
export const ruleLabel = (g) => (g.min != null && g.max != null ? `${g.min}–${g.max}` : g.max != null ? `≤ ${g.max}` : g.min != null ? `≥ ${g.min}` : '—');

// ── Contesto di un periodo ──
// all = tutti i piatti fatti (storico, per "nuove" e "recuperate"); mealsById = righe meals; events = eventi dispensa.
export function periodContext({ all, mealsById, events = [], recipesById = {}, from, to }) {
  const dishes = all.filter((d) => d.date >= from && d.date <= to);
  const byMeal = new Map();
  for (const d of dishes) {
    const k = `${d.date}|${d.meal}`;
    if (!byMeal.has(k)) byMeal.set(k, { date: d.date, meal: d.meal, place: mealsById[mealId(d.date, d.meal)]?.place || 'casa', dishes: [] });
    byMeal.get(k).dishes.push(d);
  }
  const days = [];
  for (let x = from; x <= to; x = addDaysIso(x, 1)) days.push({ date: x, dishes: dishes.filter((d) => d.date === x) });
  // prima volta per ricetta e ricette "recuperate" (fatte quando erano in ritardo)
  const firstDone = new Map();
  const recovered = new Set();
  const last = new Map();
  for (const d of [...all].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!d.recipe_id || d.leftover) continue;
    if (!firstDone.has(d.recipe_id)) firstDone.set(d.recipe_id, d.date);
    const prev = last.get(d.recipe_id);
    const interval = FREQ_DAYS[Number(recipesById[d.recipe_id]?.want_freq) || 3];
    if (prev && interval && daysBetween(prev, d.date) >= interval) recovered.add(d.id);
    last.set(d.recipe_id, d.date);
  }
  const mealsWithDishes = [...byMeal.values()];
  return { from, to, dishes, days, mealsWithDishes, realMeals: mealsWithDishes.filter((m) => m.dishes.some((d) => !d.item)), events: events.filter((e) => e.date >= from && e.date <= to), firstDone, recovered };
}

// Valuta gli obiettivi attivi del periodo. today serve a capire quanto del periodo e' passato.
export function evaluate(goals, ctx, today) {
  const len = daysBetween(ctx.from, ctx.to) + 1;
  const elapsed = Math.min(1, Math.max(0, (daysBetween(ctx.from, today) + 1) / len));
  const rows = goals.filter((g) => g.on).map((g) => {
    const have = g.count(ctx);
    let status;
    if (g.max != null && have > g.max) status = 'over';
    else if (g.min != null && have < g.min) status = 'todo';
    else if (g.max != null && g.min == null && have === g.max) status = 'limit';
    else status = 'ok';
    // quota "in linea" per il punteggio: i minimi pesati sul tempo passato
    let part = status === 'over' ? 0 : 1;
    if (status === 'todo') {
      const expected = g.min * elapsed;
      part = expected < 0.5 ? 1 : Math.min(1, have / expected);
    }
    return { ...g, have, status, part, missing: status === 'todo' ? g.min - have : 0 };
  });
  const score = rows.length ? Math.round((100 * rows.reduce((s, r) => s + r.part, 0)) / rows.length) : 100;
  return { rows, score, okCount: rows.filter((r) => r.status === 'ok' || r.status === 'limit').length };
}

// ── Punteggio "Consigliate" ──
// ctx: { today, recentDishes (ultimi 3 gg + oggi), weekRows (evaluate della settimana), lastDone: Map(recipe_id -> data), weights }
// info: { st (recipeStatus), urgent (n. ingredienti in scadenza), dish (toDish della ricetta come piatto ipotetico) }
export function scoreRecipe(r, info, ctx) {
  const w = { ...DEFAULT_WEIGHTS, ...(ctx.weights || {}) };
  const freq = r.want_freq == null ? 3 : Number(r.want_freq);
  const reasons = [];
  if (freq === 0) return { excluded: 'non propormela', total: -1, parts: {}, reasons };
  const interval = FREQ_DAYS[freq] || 30;
  const last = ctx.lastDone.get(r.id) || null;
  const since = last ? daysBetween(last, ctx.today) : null;
  if (since != null && since < interval / 2) return { excluded: `fatta ${since === 0 ? 'oggi' : since === 1 ? 'ieri' : `${since} gg fa`}`, total: -1, parts: {}, reasons };

  // varieta'
  const d = info.dish;
  let v = 0.7;
  const helps = ctx.weekRows.filter((g) => g.status === 'todo' && g.match && g.match(d));
  if (helps.length) {
    v += 0.3;
    reasons.push(`aiuta ${helps.map((g) => `${g.label.toLowerCase()} (${g.have}/${g.min})`).join(', ')}`);
  }
  const overs = ctx.weekRows.filter((g) => g.max != null && g.match && g.match(d) && g.have + 1 > g.max);
  if (overs.length) {
    v -= 0.6;
    reasons.push(`sforerebbe ${overs.map((g) => g.label.toLowerCase()).join(', ')}`);
  }
  const yesterday = addDaysIso(ctx.today, -1);
  const mg = grp(d.main);
  if (mg && ctx.recentDishes.some((x) => x.date >= yesterday && x.date < ctx.today && [x.main, x.second, x.third].some((v2) => grp(v2) === mg))) {
    v -= 0.25;
    reasons.push(`${mg.toLowerCase()} ieri`);
  }
  if (d.main && d.main.includes('|') && ctx.recentDishes.some((x) => x.date >= addDaysIso(ctx.today, -2) && [x.main, x.second, x.third].includes(d.main))) {
    v -= 0.45;
    reasons.push(`${d.main.split('|')[1]} negli ultimi 2 giorni`);
  }
  if (d.feats.has('fritto') && ctx.recentDishes.some((x) => x.feats.has('fritto'))) {
    v -= 0.3;
    reasons.push('fritto di recente');
  }
  v = Math.max(0, Math.min(1, v));

  const rating = Number(r.rating) || 3;
  const grad = (rating - 1) / 4;
  if (r.rating) reasons.push(`★${rating}`);
  let rit = 0.5;
  if (since != null) {
    rit = Math.max(0, Math.min(1, (since / interval - 0.5) / 1));
    if (since >= interval) reasons.push(`non la fai da ${since} gg`);
  } else reasons.push('mai fatta');
  const scad = Math.min(info.urgent || 0, 2) / 2;
  if (info.urgent) reasons.push(`usa ${info.urgent} in scadenza`);
  const st = info.st;
  const fatt = st?.feasible ? (st.withSub ? 0.75 : 1) : st?.missing === 1 ? 0.4 : 0;
  if (st?.missing === 1) reasons.push('manca 1 ingrediente');

  const parts = { var: v, grad, rit, scad, fatt };
  const sum = Object.values(w).reduce((a, b) => a + b, 0) || 1;
  const total = Math.round((100 * Object.entries(parts).reduce((s, [k, x]) => s + x * (w[k] || 0), 0)) / sum);
  return { total, parts, reasons, since };
}
