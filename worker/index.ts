import { Hono } from 'hono';
import { push, pull, recentOps, undoOp, type Change } from './sync';
import { extract } from './ai';
import { fetchPage, recipeFromHtml, htmlToText, fetchImageToFiles, MAX_FILE } from './importer';
import { getVapid, sendPush, type PushMsg, type Sub } from './webpush';
import { romeNow, dailyMessage, weeklyMessage, monthlyMessage } from './digest';

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

app.delete('/files/:id', async (c) => {
  const id = c.req.param('id');
  if (!FILE_ID.test(id)) return c.json({ error: 'id non valido' }, 400);
  await c.env.DB.prepare('DELETE FROM files WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
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

// Abbinamento ingredienti -> catalogo (proposte; Andrea conferma nella schermata "Collega ingredienti").
app.post('/ai/match', async (c) => {
  const body = await c.req.json<{ items?: string[]; catalog?: string[]; categories?: { id: string; name: string }[] }>().catch(() => null);
  const items = (body?.items || []).map((s) => String(s).slice(0, 120)).slice(0, 40);
  if (!items.length) return c.json({ error: 'Nessun ingrediente' }, 400);
  const catalog = (body?.catalog || []).map((s) => String(s).slice(0, 80)).slice(0, 1500);
  const cats = (body?.categories || []).slice(0, 60).map((x) => `${String(x.id).slice(0, 40)}: ${String(x.name).slice(0, 60)}`);
  const extra = [`Catalogo: ${catalog.join(' | ') || '(vuoto)'}`, `Categorie: ${cats.join(' | ')}`].join('\n');
  const text = `Ingredienti:\n${items.map((t, n) => `${n + 1}. ${t}`).join('\n')}`;
  try {
    const { model, data } = await extract(c.env, 'match', { text, extra });
    const raw = Array.isArray((data as any)?.items) ? (data as any).items : [];
    // normalizza: n 1-based -> indice 0-based, un risultato per ingrediente
    const out = items.map((t, i) => {
      const r = raw.find((x: any) => Number(x?.n) === i + 1) || raw[i] || {};
      return {
        text: t,
        catalog: typeof r.catalog === 'string' && r.catalog.trim() ? r.catalog.trim() : null,
        new: r.new && typeof r.new.name === 'string' && r.new.name.trim() ? { name: r.new.name.trim(), category_id: String(r.new.category_id || ''), unit: String(r.new.unit || ''), location: String(r.new.location || '') } : null,
        skip: !!r.skip,
      };
    });
    return c.json({ model, items: out });
  } catch (e) {
    return c.json({ error: `AI: ${(e as Error).message}` }, 502);
  }
});

// Durate di conservazione proposte (dispensa / frigo / freezer / da aperto / usi per confezione).
app.post('/ai/durations', async (c) => {
  const body = await c.req.json<{ items?: { name?: string; category?: string; unit?: string }[] }>().catch(() => null);
  const items = (body?.items || []).slice(0, 40).map((x) => ({ name: String(x?.name || '').slice(0, 80), category: String(x?.category || '').slice(0, 60), unit: String(x?.unit || '').slice(0, 10) }));
  if (!items.length || items.some((x) => !x.name)) return c.json({ error: 'Nessun prodotto' }, 400);
  const text = `Prodotti:\n${items.map((x, n) => `${n + 1}. ${x.name} (${x.category || '—'}, ${x.unit || '—'})`).join('\n')}`;
  const int = (v: unknown, max: number) => {
    const n = Number(v);
    return v == null || v === '' || !Number.isFinite(n) || n <= 0 ? null : Math.min(Math.round(n), max);
  };
  try {
    const { model, data } = await extract(c.env, 'durations', { text });
    const raw = Array.isArray((data as any)?.items) ? (data as any).items : [];
    const out = items.map((x, i) => {
      const r = raw.find((y: any) => Number(y?.n) === i + 1) || raw[i] || {};
      return {
        name: x.name,
        pantry_days: int(r.pantry_days, 3650),
        fridge_days: int(r.fridge_days, 365),
        freezer_months: int(r.freezer_months, 24),
        open_days: int(r.open_days, 730),
        uses_per_pack: (() => {
          const n = Number(r.uses_per_pack);
          return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n * 10) / 10, 1000) : null;
        })(),
      };
    });
    return c.json({ model, items: out });
  } catch (e) {
    return c.json({ error: `AI: ${(e as Error).message}` }, 502);
  }
});

// Categorie "a utilizzo" (spezie, salse...): proposta AI, conferma in app.
// Sostituti dal catalogo di casa per ingredienti che non ne hanno (max 30 per chiamata).
app.post('/ai/substitutes', async (c) => {
  const body = await c.req.json<{ items?: { name?: string; category?: string }[]; catalog?: string[] }>().catch(() => null);
  const items = (body?.items || []).slice(0, 30).map((x) => ({ name: String(x?.name || '').slice(0, 80), category: String(x?.category || '').slice(0, 60) }));
  const catalog = [...new Set((body?.catalog || []).map((x) => String(x).slice(0, 80)))].slice(0, 600);
  if (!items.length || items.some((x) => !x.name) || !catalog.length) return c.json({ error: 'Niente da proporre' }, 400);
  const byLower = new Map(catalog.map((n) => [n.toLowerCase(), n]));
  const text = `Catalogo: ${catalog.join(' | ')}\n\nIngredienti:\n${items.map((x, n) => `${n + 1}. ${x.name} (${x.category || '—'})`).join('\n')}`;
  try {
    const { model, data } = await extract(c.env, 'substitutes', { text });
    const raw = Array.isArray((data as any)?.items) ? (data as any).items : [];
    const out = items.map((x, i) => {
      const r = raw.find((y: any) => Number(y?.n) === i + 1) || raw[i] || {};
      const subs = (Array.isArray(r.subs) ? r.subs : [])
        .map((s: any) => {
          const name = byLower.get(String(s?.name || '').toLowerCase().trim());
          const ratio = Number(s?.ratio);
          return name && name.toLowerCase() !== x.name.toLowerCase() ? { name, ratio: Number.isFinite(ratio) && ratio > 0 ? Math.min(Math.round(ratio * 100) / 100, 10) : 1, note: s?.note ? String(s.note).slice(0, 80) : null } : null;
        })
        .filter(Boolean)
        .slice(0, 3);
      return { name: x.name, subs };
    });
    return c.json({ model, items: out });
  } catch (e) {
    return c.json({ error: `AI: ${(e as Error).message}` }, 502);
  }
});

app.post('/ai/categories', async (c) => {
  const body = await c.req.json<{ items?: { id?: string; name?: string; examples?: string[] }[] }>().catch(() => null);
  const items = (body?.items || []).slice(0, 60).map((x) => ({ id: String(x?.id || '').slice(0, 40), name: String(x?.name || '').slice(0, 60), examples: (x?.examples || []).slice(0, 8).map((e) => String(e).slice(0, 40)) }));
  if (!items.length) return c.json({ error: 'Nessuna categoria' }, 400);
  const text = items.map((x) => `- ${x.id}: ${x.name} (es. ${x.examples.join(', ') || '—'})`).join('\n');
  try {
    const { model, data } = await extract(c.env, 'categories', { text });
    const raw = Array.isArray((data as any)?.items) ? (data as any).items : [];
    return c.json({ model, items: items.map((x) => ({ id: x.id, by_use: !!raw.find((r: any) => r?.id === x.id)?.by_use })) });
  } catch (e) {
    return c.json({ error: `AI: ${(e as Error).message}` }, 502);
  }
});

// Classificazione ricette (max 12 per chiamata): portata, difficolta', alimento principale/secondario, caratteristiche.
const CLS = {
  course: ['Antipasto', 'Primo', 'Secondo', 'Contorno', 'Piatto unico', 'Dolce', 'Salsa e sugo', 'Pane e lievitati', 'Colazione', 'Bevanda'],
  difficulty: ['facile', 'media', 'difficile'],
  food: ['Carne', 'Carne|bianca', 'Carne|rossa', 'Carne|maiale', 'Carne|salumi', 'Pesce', 'Pesce|pesce', 'Pesce|crostacei', 'Pesce|molluschi', 'Uova', 'Latticini', 'Latticini|formaggi', 'Latticini|ricotta', 'Latticini|yogurt', 'Proteine', 'Proteine|legumi', 'Proteine|tofu e seitan', 'Proteine|altre', 'Carboidrati', 'Carboidrati|pasta', 'Carboidrati|riso', 'Carboidrati|cereali', 'Carboidrati|pane e impasti', 'Carboidrati|patate', 'Verdure', 'Verdure|ortaggi', 'Verdure|funghi', 'Verdure|frutta'],
  features: ['congela', 'frigo', 'subito', 'mealprep', 'freddo', 'tiepido', 'caldo', 'crudo', 'forno', 'padella', 'griglia', 'fritto', 'bollito', 'umido', 'schiscetta', 'unapentola', 'anticipo', 'proteico', 'sostanzioso', 'piccante', 'quotidiano', 'ospiti', 'festa', 'estate', 'inverno'],
  diet: ['senza glutine', 'senza lattosio'],
};
const pickOne = (v: unknown, list: string[]) => {
  const s = String(v ?? '').trim();
  return list.find((x) => x.toLowerCase() === s.toLowerCase()) ?? null;
};
app.post('/ai/classify', async (c) => {
  const body = await c.req.json<{ items?: { title?: string; course?: string; minutes?: number; rest?: number; steps?: number; ingredients?: string[] }[] }>().catch(() => null);
  const items = (body?.items || []).slice(0, 12).map((x) => ({
    title: String(x?.title || '').slice(0, 100),
    course: String(x?.course || '').slice(0, 30),
    minutes: Number(x?.minutes) || null,
    rest: Number(x?.rest) || 0,
    steps: Number(x?.steps) || 0,
    ingredients: (x?.ingredients || []).slice(0, 18).map((i) => String(i).slice(0, 40)),
  }));
  if (!items.length || items.some((x) => !x.title)) return c.json({ error: 'Nessuna ricetta' }, 400);
  const text = items
    .map((x, n) => `${n + 1}. ${x.title} | portata: ${x.course || '—'} | minuti totali: ${x.minutes ?? '—'} | riposo: ${x.rest} | passaggi: ${x.steps} | ingredienti: ${x.ingredients.join(', ')}`)
    .join('\n');
  try {
    const { model, data } = await extract(c.env, 'classify', { text });
    const raw = Array.isArray((data as any)?.items) ? (data as any).items : [];
    const out = items.map((x, i) => {
      const r = raw.find((y: any) => Number(y?.n) === i + 1) || raw[i] || {};
      const main = pickOne(r.main, CLS.food);
      const second = pickOne(r.second, CLS.food);
      const third = pickOne(r.third, CLS.food);
      const list = (v: unknown, allowed: string[]) => [...new Set((Array.isArray(v) ? v : []).map((f) => pickOne(f, allowed)).filter((f): f is string => !!f))];
      return {
        title: x.title,
        course: pickOne(r.course, CLS.course),
        difficulty: pickOne(r.difficulty, CLS.difficulty),
        main,
        second: second && second !== main ? second : null,
        third: third && second && third !== main && third !== second ? third : null,
        features: list(r.features, CLS.features).slice(0, 8),
        diet: list(r.diet, CLS.diet),
      };
    });
    return c.json({ model, items: out });
  } catch (e) {
    return c.json({ error: `AI: ${(e as Error).message}` }, 502);
  }
});

// ── Notifiche push ──
async function subId(endpoint: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
type SubRow = Sub & { prefs: string | null; fails: number };
const prefsOf = (r: { prefs: string | null }) => ({ daily: true, weekly: true, monthly: true, ...(r.prefs ? JSON.parse(r.prefs) : {}) });

app.get('/push/key', async (c) => c.json({ publicKey: (await getVapid(c.env.DB)).publicKey }));

app.post('/push/subscribe', async (c) => {
  const b = await c.req.json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string }; device?: string; prefs?: object }>().catch(() => null);
  if (!b?.endpoint || !b.keys?.p256dh || !b.keys?.auth || !/^https:\/\//.test(b.endpoint)) return c.json({ error: 'Sottoscrizione non valida' }, 400);
  const id = await subId(b.endpoint);
  await c.env.DB.prepare(
    `INSERT INTO push_subscriptions (id, endpoint, p256dh, auth, device, prefs, created_at, fails) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)
     ON CONFLICT(id) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device, prefs = COALESCE(excluded.prefs, push_subscriptions.prefs), fails = 0`
  )
    .bind(id, b.endpoint, b.keys.p256dh, b.keys.auth, b.device ?? null, b.prefs ? JSON.stringify(b.prefs) : null, Date.now())
    .run();
  return c.json({ ok: true, id });
});

app.post('/push/unsubscribe', async (c) => {
  const b = await c.req.json<{ endpoint?: string }>().catch(() => null);
  if (b?.endpoint) await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(await subId(b.endpoint)).run();
  return c.json({ ok: true });
});

app.post('/push/status', async (c) => {
  const b = await c.req.json<{ endpoint?: string }>().catch(() => null);
  const row = b?.endpoint ? await c.env.DB.prepare('SELECT prefs FROM push_subscriptions WHERE id = ?').bind(await subId(b.endpoint)).first<{ prefs: string | null }>() : null;
  const n = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>();
  return c.json({ subscribed: !!row, prefs: row ? prefsOf(row) : null, devices: n?.n ?? 0 });
});

app.post('/push/prefs', async (c) => {
  const b = await c.req.json<{ endpoint?: string; prefs?: object }>().catch(() => null);
  if (!b?.endpoint || !b.prefs) return c.json({ error: 'Dati mancanti' }, 400);
  await c.env.DB.prepare('UPDATE push_subscriptions SET prefs = ? WHERE id = ?').bind(JSON.stringify(b.prefs), await subId(b.endpoint)).run();
  return c.json({ ok: true });
});

// Prova su questo dispositivo, oppure anteprima di una notifica vera (daily/weekly) inviata subito.
app.post('/push/test', async (c) => {
  const b = await c.req.json<{ endpoint?: string; kind?: 'test' | 'daily' | 'weekly' | 'monthly' }>().catch(() => null);
  if (!b?.endpoint) return c.json({ error: 'endpoint mancante' }, 400);
  const sub = await c.env.DB.prepare('SELECT * FROM push_subscriptions WHERE id = ?').bind(await subId(b.endpoint)).first<SubRow>();
  if (!sub) return c.json({ error: 'Dispositivo non iscritto' }, 404);
  const now = romeNow();
  const msg =
    b.kind === 'daily'
      ? (await dailyMessage(c.env.DB, now.date)) ?? { title: 'Scadenze', body: 'Niente in scadenza oggi 👍', url: '/dispensa' }
      : b.kind === 'weekly'
        ? await weeklyMessage(c.env.DB, now.date, now.month)
        : b.kind === 'monthly'
          ? await monthlyMessage(c.env.DB, now.month)
          : { title: 'Notifiche attive ✅', body: 'Welcome to My House ti avviserà qui.', url: '/' };
  const r = await sendPush(c.env.DB, sub, msg);
  if (r === 'gone') await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(sub.id).run();
  return r === true ? c.json({ ok: true, msg }) : c.json({ error: r === 'gone' ? 'Iscrizione scaduta: riattiva' : 'Invio non riuscito' }, 502);
});

async function broadcast(env: Env, kind: 'daily' | 'weekly' | 'monthly', msg: PushMsg) {
  const subs = (await env.DB.prepare('SELECT * FROM push_subscriptions').all<SubRow>()).results.filter((s) => prefsOf(s)[kind] !== false);
  let sent = 0;
  for (const s of subs) {
    const r = await sendPush(env.DB, s, msg).catch(() => false as const);
    if (r === true) {
      sent++;
      await env.DB.prepare('UPDATE push_subscriptions SET last_ok = ?, fails = 0 WHERE id = ?').bind(Date.now(), s.id).run();
    } else if (r === 'gone' || s.fails >= 20) await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(s.id).run();
    else await env.DB.prepare('UPDATE push_subscriptions SET fails = fails + 1 WHERE id = ?').bind(s.id).run();
  }
  return sent;
}

// Una volta per data e tipo, anche se il cron scatta due volte.
async function once(env: Env, key: string, value: string) {
  const r = await env.DB.prepare('INSERT INTO server_kv (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = ?2 WHERE v <> ?2').bind(key, value).run();
  return (r.meta.changes ?? 0) > 0;
}

// Cron ogni 30 minuti; decide in ora italiana: 9:30 scadenze, 1° del mese 9:30 report, domenica 20:00 riepilogo + diario.
async function scheduled(_e: ScheduledController, env: Env) {
  const now = romeNow();
  if (now.hour === 9 && now.minute >= 30 && (await once(env, 'last_daily', now.date))) {
    const msg = await dailyMessage(env.DB, now.date);
    if (msg) console.log(JSON.stringify({ level: 'info', msg: 'push scadenze', sent: await broadcast(env, 'daily', msg) }));
  }
  if (now.day === 1 && now.hour === 9 && now.minute >= 30 && (await once(env, 'last_monthly', now.month))) {
    const msg = await monthlyMessage(env.DB, now.month);
    console.log(JSON.stringify({ level: 'info', msg: 'push report mensile', sent: await broadcast(env, 'monthly', msg) }));
  }
  if (now.weekday === 'Sun' && now.hour === 20 && now.minute < 30 && (await once(env, 'last_weekly', now.date))) {
    const msg = await weeklyMessage(env.DB, now.date, now.month);
    console.log(JSON.stringify({ level: 'info', msg: 'push settimana', sent: await broadcast(env, 'weekly', msg) }));
  }
}

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

// Operazioni recenti di tutti i dispositivi + annulla.
app.get('/ops', async (c) => {
  const limit = Math.min(Number(c.req.query('limit')) || 40, 200);
  return c.json({ items: await recentOps(c.env.DB, limit) });
});
app.post('/undo', async (c) => {
  const b = await c.req.json<{ op?: string; force?: boolean; device?: string }>().catch(() => null);
  if (!b?.op) return c.json({ error: 'Operazione mancante' }, 400);
  const r = await undoOp(c.env.DB, String(b.op), String(b.device ?? 'sconosciuto').slice(0, 60), !!b.force);
  if ('error' in r) return c.json({ error: r.error }, 404);
  if (!('ok' in r)) return c.json({ conflicts: r.conflicts }, 409);
  return c.json(r);
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

export default {
  fetch: app.fetch,
  scheduled: (e: ScheduledController, env: Env, ctx: ExecutionContext) => ctx.waitUntil(scheduled(e, env)),
} satisfies ExportedHandler<Env>;
