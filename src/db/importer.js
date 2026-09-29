import { apiFetch } from '../api/client.js';
import { uuid } from './db.js';
import { save } from './repo.js';
import { courseOf, cleanTags, COURSES } from './tags.js';
import { parseIngredientLine, autoLink, normUnit, detectTimer, joinList, parseList } from './recipes.js';

// Bozza ricetta = formato unico per editor e import:
// { title, servings, prep_min, cook_min, rest_min, difficulty, tags, notes, source_url, photo_key, photo_url,
//   ingredients: [{ text, qty, unit, grp, optional }], steps: [{ text, timer_min, photo_key, photo_url }] }

// ── utilita' ──
const pick = (o, keys) => {
  for (const k of keys) if (o?.[k] != null && o[k] !== '') return o[k];
  return undefined;
};
const strip = (s) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

// "PT1H30M" / "15 min" / "1 ora e 20 minuti" / 15 -> minuti
export function toMinutes(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v).trim();
  const iso = s.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso && /\d/.test(s)) return (Number(iso[1] || 0) * 1440) + Number(iso[2] || 0) * 60 + Number(iso[3] || 0) + (Number(iso[4] || 0) >= 30 ? 1 : 0) || null;
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*(?:h|or[ae])/i);
  const m = s.match(/(\d+)\s*(?:m|min)/i);
  if (h || m) return Math.round((h ? Number(h[1].replace(',', '.')) * 60 : 0) + (m ? Number(m[1]) : 0)) || null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toServings(v) {
  if (Array.isArray(v)) v = v.find((x) => /\d/.test(String(x))) ?? v[0];
  if (v == null) return null;
  const m = String(v).match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) : null;
}

function toDifficulty(v) {
  const s = String(v ?? '').toLowerCase();
  if (!s) return null;
  if (s.includes('diffic')) return 'difficile';
  if (s.includes('medi')) return 'media';
  if (s.includes('facil') || s.includes('easy')) return 'facile';
  return null;
}

function imageUrl(v) {
  if (!v) return null;
  if (typeof v === 'string') return /^https?:\/\//.test(v) ? v : null;
  if (Array.isArray(v)) {
    for (const x of v) {
      const u = imageUrl(x);
      if (u) return u;
    }
    return null;
  }
  return imageUrl(v.url || v.contentUrl || v.src || v['@id']);
}

function listOf(v) {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') return v.split(/\n+/);
  return [v];
}

function tagsOf(...vals) {
  const out = [];
  for (const v of vals) for (const x of listOf(v)) out.push(...String(typeof x === 'object' ? x?.name ?? '' : x).split(','));
  return joinList(out.map((t) => strip(t).toLowerCase()).filter((t) => t && t.length < 30)).split(', ').filter(Boolean).slice(0, 6).join(', ');
}

// Ingrediente: stringa ("Spaghetti 320 g") o oggetto ({ nome, dose } / { name, quantity, unit })
function ingredientOf(x, grp) {
  if (x == null) return null;
  if (typeof x === 'string') {
    const p = parseIngredientLine(strip(x));
    return p && { ...p, grp, optional: /facoltativ/i.test(x) ? 1 : 0 };
  }
  const name = strip(pick(x, ['nome', 'name', 'ingrediente', 'text', 'testo']));
  if (!name) return null;
  const qtyRaw = pick(x, ['quantita', 'quantità', 'quantity', 'qty', 'amount']);
  const unit = pick(x, ['unita', 'unità', 'unit']);
  const dose = strip(pick(x, ['dose', 'dosi', 'quantita_testo', 'misura']) ?? '');
  let parsed;
  if (qtyRaw != null && !Number.isNaN(Number(String(qtyRaw).replace(',', '.')))) parsed = { text: name, qty: Number(String(qtyRaw).replace(',', '.')), unit: normUnit(unit) };
  else parsed = parseIngredientLine(`${name} ${dose || (qtyRaw != null ? `${qtyRaw} ${unit || ''}` : '')}`.trim()) || { text: name, qty: null, unit: '' };
  if (!parsed.text) parsed.text = name;
  return { ...parsed, grp: strip(pick(x, ['gruppo', 'group', 'sezione'])) || grp, optional: x.optional || x.facoltativo ? 1 : 0 };
}

function ingredientsOf(v) {
  const out = [];
  for (const x of listOf(v)) {
    // gruppi: { nome/gruppo: "Per la salsa", ingredienti: [...] }
    const inner = x && typeof x === 'object' && pick(x, ['ingredienti', 'ingredients', 'items']);
    if (Array.isArray(inner)) {
      const g = strip(pick(x, ['gruppo', 'group', 'nome', 'name', 'titolo']));
      for (const y of inner) {
        const i = ingredientOf(y, g || null);
        if (i) out.push(i);
      }
    } else {
      const i = ingredientOf(x, null);
      if (i && i.text) out.push(i);
    }
  }
  return out;
}

function stepsOf(v) {
  const out = [];
  const push = (text, img) => {
    const t = strip(text).replace(/^\d+[.)]\s*/, '');
    if (t) out.push({ text: t, timer_min: detectTimer(t), photo_url: imageUrl(img) });
  };
  for (const x of listOf(v)) {
    if (x == null) continue;
    if (typeof x === 'string') {
      push(x);
      continue;
    }
    const inner = x.itemListElement || x.steps || x.passaggi;
    if (Array.isArray(inner)) {
      for (const y of inner) typeof y === 'string' ? push(y) : push(pick(y, ['text', 'testo', 'descrizione', 'name']), pick(y, ['image', 'foto', 'immagine', 'img', 'photo']));
      continue;
    }
    push(pick(x, ['text', 'testo', 'descrizione', 'description', 'name']), pick(x, ['image', 'foto', 'immagine', 'img', 'photo', 'foto_url']));
  }
  return out;
}

// Valori nutrizionali per porzione (schema.org NutritionInformation o chiavi italiane) -> JSON compatto.
const NUTRI = {
  kcal: ['calories', 'calorie', 'kcal', 'energia'],
  carbs: ['carbohydrateContent', 'carboidrati'],
  sugar: ['sugarContent', 'zuccheri'],
  fat: ['fatContent', 'grassi'],
  satfat: ['saturatedFatContent', 'grassi_saturi'],
  protein: ['proteinContent', 'proteine'],
  fiber: ['fiberContent', 'fibre'],
  sodium: ['sodiumContent', 'sodio'],
  chol: ['cholesterolContent', 'colesterolo'],
};
export function nutritionOf(v) {
  if (!v || typeof v !== 'object') return null;
  const out = {};
  for (const [k, keys] of Object.entries(NUTRI)) {
    const raw = pick(v, keys);
    const m = raw != null && String(raw).match(/(\d+(?:[.,]\d+)?)/);
    if (m) out[k] = Math.round(Number(m[1].replace(',', '.')) * 10) / 10;
  }
  return out.kcal != null ? JSON.stringify(out) : null;
}

// schema.org/Recipe o oggetto "simile" (export GZ con chiavi in italiano/inglese) -> bozza
export function draftFromAny(o, fallbackUrl = null) {
  const notes = [
    strip(pick(o, ['description', 'descrizione'])),
    ...['consigli', 'conservazione', 'tips', 'note', 'notes'].map((k) => (o[k] ? `${k[0].toUpperCase()}${k.slice(1)}: ${listOf(o[k]).map((x) => strip(typeof x === 'object' ? x.text || x.testo || '' : x)).join(' ')}` : '')),
    pick(o, ['costo', 'cost', 'estimatedCost']) ? `Costo: ${strip(typeof o.costo === 'object' ? o.costo?.value : pick(o, ['costo', 'cost', 'estimatedCost']))}` : '',
  ].filter(Boolean);
  const total = toMinutes(pick(o, ['totalTime', 'tempo_totale']));
  let prep = toMinutes(pick(o, ['prepTime', 'preparazione', 'tempo_preparazione', 'prep_time', 'prep_min']));
  const cook = toMinutes(pick(o, ['cookTime', 'cottura', 'tempo_cottura', 'cook_time', 'cook_min']));
  if (prep == null && total != null && cook == null) prep = total;
  const url = pick(o, ['url', 'link', 'source_url', 'mainEntityOfPage']);
  const title = strip(pick(o, ['name', 'nome', 'titolo', 'title', 'headline'])) || 'Ricetta senza titolo';
  const category = tagsOf(pick(o, ['recipeCategory', 'categoria', 'category', 'portata']));
  return {
    title,
    course: courseOf({ tags: category, title: '' })?.value || null,
    nutrition: nutritionOf(pick(o, ['nutrition', 'valori_nutrizionali', 'nutrizione'])),
    servings: toServings(pick(o, ['recipeYield', 'porzioni', 'servings', 'dosi', 'yield', 'dosi_per'])) || 1,
    prep_min: prep,
    cook_min: cook,
    rest_min: toMinutes(pick(o, ['riposo', 'tempo_riposo', 'rest_min'])),
    difficulty: toDifficulty(pick(o, ['difficolta', 'difficoltà', 'difficulty'])),
    tags: cleanTags(tagsOf(pick(o, ['keywords', 'tag', 'tags'])), title).join(', '),
    notes: notes.join('\n\n') || null,
    source_url: typeof url === 'string' ? url : typeof url === 'object' ? url?.['@id'] || fallbackUrl : fallbackUrl,
    photo_url: imageUrl(pick(o, ['image', 'foto', 'immagine', 'foto_principale', 'photo', 'img', 'thumbnailUrl'])),
    ingredients: ingredientsOf(pick(o, ['recipeIngredient', 'ingredienti', 'ingredients'])),
    steps: stepsOf(pick(o, ['recipeInstructions', 'passaggi', 'istruzioni', 'steps', 'procedimento', 'preparazione_passaggi'])),
  };
}

// Bozza prodotta dall'AI (forma definita in worker/ai.ts)
export function draftFromAi(d, url = null) {
  return {
    title: strip(d?.title) || 'Ricetta',
    servings: Number(d?.servings) || 1,
    prep_min: toMinutes(d?.prep_min),
    cook_min: toMinutes(d?.cook_min),
    rest_min: toMinutes(d?.rest_min),
    difficulty: toDifficulty(d?.difficulty),
    course: COURSES.includes(d?.course) ? d.course : null,
    tags: cleanTags(tagsOf(d?.tags), d?.title).join(', '),
    notes: d?.notes ? strip(d.notes) : null,
    source_url: url,
    ingredients: (d?.ingredients || [])
      .map((i) => (typeof i === 'string' ? ingredientOf(i, null) : { text: strip(i.text), qty: i.qty == null || i.qty === '' ? null : Number(i.qty), unit: normUnit(i.unit), grp: i.group || null, optional: i.optional ? 1 : 0 }))
      .filter((i) => i?.text),
    steps: (d?.steps || []).map((s) => (typeof s === 'string' ? { text: s } : s)).map((s) => ({ text: strip(s.text), timer_min: s.timer_min ?? detectTimer(s.text) })).filter((s) => s.text),
  };
}

// File JSON multiplo: array, { recipes | ricette | items | data: [] } o oggetto indicizzato.
export function parseImportFile(json) {
  let arr = Array.isArray(json) ? json : pick(json, ['recipes', 'ricette', 'items', 'data', 'ricettario']);
  if (!Array.isArray(arr) && json && typeof json === 'object') arr = json['@graph'] || Object.values(json).filter((v) => v && typeof v === 'object' && !Array.isArray(v));
  if (!Array.isArray(arr)) throw new Error('Formato non riconosciuto');
  return arr
    .filter((o) => o && typeof o === 'object')
    .map((o) => draftFromAny(o))
    .filter((d) => d.ingredients.length || d.steps.length);
}

// ── API ──
export async function importFromUrl(url) {
  const res = await apiFetch('/api/import/url', { method: 'POST', body: JSON.stringify({ url }) });
  return res.source === 'schema' ? { draft: draftFromAny(res.recipe, res.url), via: 'dati strutturati' } : { draft: draftFromAi(res.draft, res.url), via: 'AI' };
}

export async function recipeFromAi({ text, images }) {
  const res = await apiFetch('/api/ai/recipe', { method: 'POST', body: JSON.stringify({ text, images }) });
  return draftFromAi(res.draft);
}

export async function fetchPhoto(url) {
  if (!url) return null;
  try {
    const r = await apiFetch('/api/files/fetch', { method: 'POST', body: JSON.stringify({ url }) });
    return r.id;
  } catch {
    return null;
  }
}

// Scarica le foto della bozza (principale + passaggi) nel server; ritorna la bozza con photo_key.
export async function materializePhotos(draft, { steps = true, onStep } = {}) {
  const d = { ...draft, steps: draft.steps.map((s) => ({ ...s })) };
  if (d.photo_url && !d.photo_key) d.photo_key = await fetchPhoto(d.photo_url);
  if (d.photo_url) onStep?.();
  if (steps)
    for (const s of d.steps) {
      if (s.photo_url && !s.photo_key) s.photo_key = await fetchPhoto(s.photo_url);
      if (s.photo_url) onStep?.();
    }
  return d;
}

export const normTitle = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Righe da salvare per una bozza (ricetta + ingredienti collegati al catalogo + passaggi).
export function draftToOps(draft, products, learned) {
  const rid = uuid();
  const ops = [
    {
      table: 'recipes',
      row: {
        id: rid,
        title: draft.title,
        servings: draft.servings || 1,
        prep_min: draft.prep_min ?? null,
        cook_min: draft.cook_min ?? null,
        rest_min: draft.rest_min ?? null,
        difficulty: draft.difficulty || null,
        course: draft.course || null,
        nutrition: draft.nutrition || null,
        tags: draft.tags || null,
        diet_tags: joinList(parseList(draft.diet_tags)) || null,
        photo_key: draft.photo_key || null,
        source_url: draft.source_url || null,
        notes: draft.notes || null,
        favorite: 0,
        cooked_count: 0,
      },
    },
  ];
  draft.ingredients.forEach((i, n) => {
    ops.push({ table: 'recipe_ingredients', row: { id: uuid(), recipe_id: rid, product_id: autoLink(i.text, products, learned), text: i.text, qty: i.qty ?? null, unit: i.unit || null, optional: i.optional ? 1 : 0, grp: i.grp || null, sort: n } });
  });
  draft.steps.forEach((s, n) => {
    ops.push({ table: 'recipe_steps', row: { id: uuid(), recipe_id: rid, text: s.text, timer_min: s.timer_min ?? null, photo_key: s.photo_key || null, sort: n } });
  });
  return { rid, ops };
}

export async function saveDrafts(drafts, products, label, learned) {
  const all = drafts.map((d) => draftToOps(d, products, learned));
  const ops = all.flatMap((x) => x.ops);
  await save(ops, label);
  return all.map((x) => x.rid);
}
