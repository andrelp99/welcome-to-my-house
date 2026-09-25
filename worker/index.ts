import { Hono } from 'hono';

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
