import { Hono } from 'hono';
import { push, pull, type Change } from './sync';
import { extract } from './ai';
import { fetchPage, recipeFromHtml, htmlToText, fetchImageToFiles, MAX_FILE } from './importer';

export type Env = {
  DB: D1Database;
  HOUSE_KEY: string;
  ASSETS: Fetcher;
  AI: Ai;
  AI_MODEL?: string;
  AI_MODEL_FALLBACK?: string;
};

const app = new Hono<{ Bindings: Env }>().basePath('/api');

// Pubblico: serve solo a sapere se il Worker risponde.
app.get('/health', (c) => c.json({ ok: true, app: 'welcome-to-my-house' }));

// Tutto il resto richiede la chiave dispositivo (niente login, vedi README).
app.use('*', async (c, next) => {
  const expected = c.env.HOUSE_KEY;
  const got = c.req.header('X-House-Key') ?? '';
  if (!expected || !safeEqual(got, expected)) {
    return c.json({ error: 'Chiave dispositivo non valida' }, 401);
  }
  await next();
});

// Verifica chiave + database raggiungibile.
app.get('/ping', async (c) => {
  const row = await c.env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM locations) AS locations, (SELECT COUNT(*) FROM categories) AS categories'
  ).first<{ locations: number; categories: number }>();
  return c.json({ ok: true, db: row });
});

// Sync: invia modifiche locali e ricevi quelle nuove (rev > since).
app.post('/sync', async (c) => {
  const body = await c.req.json<{ since?: number; changes?: Change[]; device?: string }>().catch(() => null);
  if (!body) return c.json({ error: 'JSON non valido' }, 400);
  const device = String(body.device ?? 'sconosciuto').slice(0, 60);
  const pushed = await push(c.env.DB, body.changes ?? [], device);
  const since = Number.isFinite(Number(body.since)) ? Number(body.since) : -1;
  const pulled = await pull(c.env.DB, since);
  return c.json({ pushed, ...pulled });
});

// Foto (ricette, passaggi). Immutabili: id generato dal client, salvate in D1 (tabella files).
const FILE_ID = /^[A-Za-z0-9_-]{8,80}$/;

app.put('/files/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return c.json({ error: 'id non valido' }, 400);
  const mime = (c.req.header('Content-Type') || '').split(';')[0];
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return c.json({ error: 'Formato non supportato' }, 415);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ error: 'File vuoto' }, 400);
  if (buf.byteLength > MAX_FILE) return c.json({ error: 'Foto troppo grande' }, 413);
  await c.env.DB.prepare('INSERT OR IGNORE INTO files (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, mime, buf.byteLength, buf, Date.now())
    .run();
  return c.json({ ok: true, id, size: buf.byteLength });
});

app.get('/files/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return c.json({ error: 'id non valido' }, 400);
  const row = await c.env.DB.prepare('SELECT mime, data FROM files WHERE id = ?').bind(id).first<{ mime: string; data: ArrayBuffer | number[] }>();
  if (!row) return c.json({ error: 'Foto non trovata' }, 404);
  const bytes = row.data instanceof ArrayBuffer ? new Uint8Array(row.data) : new Uint8Array(row.data);
  return new Response(bytes, {
    headers: { 'Content-Type': row.mime, 'Cache-Control': 'private, max-age=31536000, immutable' },
  });
});

// Copia in D1 un'immagine remota (foto ricette importate). Ritorna la photo_key.
app.post('/files/fetch', async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null);
  if (!body?.url) return c.json({ error: 'url mancante' }, 400);
  try {
    return c.json(await fetchImageToFiles(c.env.DB, body.url));
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
});

// Import da link: schema.org/Recipe se presente (niente AI), altrimenti AI sul testo della pagina.
app.post('/import/url', async (c) => {
  const body = await c.req.json<{ url?: string }>().catch(() => null);
  if (!body?.url) return c.json({ error: 'url mancante' }, 400);
  let page;
  try {
    page = await fetchPage(body.url);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 422);
  }
  const recipe = recipeFromHtml(page.html);
  if (recipe) return c.json({ source: 'schema', url: page.finalUrl, recipe });
  const text = htmlToText(page.html);
  if (text.length < 200) return c.json({ error: 'Nessuna ricetta trovata nella pagina' }, 422);
  try {
    const { model, data } = await extract(c.env, 'recipe', { text: `Pagina: ${page.title}\n\n${text}` });
    return c.json({ source: 'ai', model, url: page.finalUrl, draft: data });
  } catch (e) {
    return c.json({ error: `AI: ${(e as Error).message}` }, 502);
  }
});

// Ricetta da testo incollato o da foto (libro, quaderno).
app.post('/ai/recipe', async (c) => {
  const body = await c.req.json<{ text?: string; images?: string[] }>().catch(() => null);
  if (!body?.text && !body?.images?.length) return c.json({ error: 'Testo o foto mancanti' }, 400);
  if (JSON.stringify(body).length > 8 * MAX_FILE) return c.json({ error: 'Troppo grande' }, 413);
  try {
    const { model, data } = await extract(c.env, 'recipe', { text: body.text, images: body.images?.slice(0, 4) });
    return c.json({ source: 'ai', model, draft: data });
  } catch (e) {
    return c.json({ error: `AI: ${(e as Error).message}` }, 502);
  }
});

// Scontrino: foto -> righe (nome, catalogo, quantita', prezzi, sconti), punto vendita, data.
app.post('/ai/receipt', async (c) => {
  const body = await c.req.json<{ images?: string[]; catalog?: string[]; stores?: string[] }>().catch(() => null);
  if (!body?.images?.length) return c.json({ error: 'Foto mancante' }, 400);
  if (JSON.stringify(body).length > 8 * MAX_FILE) return c.json({ error: 'Troppo grande' }, 413);
  const extra = [
    body.catalog?.length ? `Catalogo prodotti (usa questi nomi per "catalog"): ${body.catalog.slice(0, 600).join(' | ')}` : '',
    body.stores?.length ? `Supermercati noti: ${body.stores.slice(0, 50).join(' | ')}` : '',
  ].filter(Boolean).join('\n');
  try {
    const { model, data } = await extract(c.env, 'receipt', { images: body.images.slice(0, 3), extra });
    return c.json({ model, receipt: data });
  } catch (e) {
    return c.json({ error: `AI: ${(e as Error).message}` }, 502);
  }
});

// Cronologia modifiche (tutti i dispositivi).
app.get('/history', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
  const { results } = await c.env.DB.prepare(
    'SELECT id, table_name, row_id, before_json, after_json, device, at FROM change_log ORDER BY at DESC LIMIT ?'
  )
    .bind(limit)
    .all();
  return c.json({ items: results });
});

app.notFound((c) => c.json({ error: 'Endpoint non trovato' }, 404));
app.onError((err, c) => {
  console.error(JSON.stringify({ level: 'error', msg: err.message, path: c.req.path }));
  return c.json({ error: 'Errore interno' }, 500);
});

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default app;
