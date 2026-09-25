import { Hono } from 'hono';
import { push, pull, type Change } from './sync';

export type Env = {
  DB: D1Database;
  HOUSE_KEY: string;
  ASSETS: Fetcher;
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
