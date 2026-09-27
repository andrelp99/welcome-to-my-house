import Dexie from 'dexie';

// Copia locale completa dei dati: l'app legge/scrive sempre qui, il sync allinea col server.
export const db = new Dexie('welcome-house');

db.version(1).stores({
  locations: 'id',
  categories: 'id',
  stores: 'id',
  products: 'id, name, area, category_id',
  receipts: 'id, date, store_id',
  purchase_lines: 'id, product_id, receipt_id',
  stock_lots: 'id, product_id, location_id',
  shopping_items: 'id, product_id',
  extra_expenses: 'id',
  budgets: 'id',
  outbox: '++seq, [table+id]', // modifiche da inviare
  history: '++hid, at', // cronologia locale per "annulla"
  meta: 'key',
});

// F2: ricettario. files = foto locali (blob), inviate al server da photos.js (non passano dal sync).
db.version(2).stores({
  recipes: 'id, title',
  recipe_ingredients: 'id, recipe_id, product_id',
  recipe_steps: 'id, recipe_id',
  substitutions: 'id, product_id',
  events: 'id, type, date, product_id, recipe_id',
  files: 'id, uploaded',
});

// F3: memoria riga scontrino -> prodotto
db.version(3).stores({
  receipt_aliases: 'id, product_id',
});

// F4: planner
db.version(4).stores({
  meal_plan: 'id, date, recipe_id',
});

export const SYNC_TABLES = [
  'locations', 'categories', 'stores', 'products', 'receipts',
  'purchase_lines', 'stock_lots', 'shopping_items', 'extra_expenses', 'budgets',
  'recipes', 'recipe_ingredients', 'recipe_steps', 'substitutions', 'events', 'receipt_aliases',
  'meal_plan',
];

export const alive = (r) => r && !r.deleted;

export async function getMeta(key, fallback = null) {
  const r = await db.meta.get(key);
  return r ? r.value : fallback;
}
export function setMeta(key, value) {
  return db.meta.put({ key, value });
}

export function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
