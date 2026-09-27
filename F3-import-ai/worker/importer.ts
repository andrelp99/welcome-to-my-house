// Import ricette da link: prima i dati strutturati schema.org/Recipe (JSON-LD), poi l'AI sul testo della pagina.

const UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';
const MAX_HTML = 3_000_000;
export const MAX_FILE = 1_900_000; // limite riga D1 = 2 MB

export function checkUrl(u: string): URL {
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    throw new Error('Link non valido');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Link non valido');
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1)/.test(url.hostname)) throw new Error('Link non valido');
  return url;
}

function isRecipe(o: any): boolean {
  const t = o?.['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
}

function findRecipe(node: any, depth = 0): any {
  if (!node || depth > 6) return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findRecipe(n, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof node !== 'object') return null;
  if (isRecipe(node)) return node;
  for (const k of ['@graph', 'mainEntity', 'itemListElement', 'item']) {
    const r = findRecipe(node[k], depth + 1);
    if (r) return r;
  }
  return null;
}

export function recipeFromHtml(html: string): any {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const r = findRecipe(JSON.parse(m[1].trim()));
      if (r) return r;
    } catch {
      /* JSON-LD rotto: prova il prossimo */
    }
  }
  return null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

export async function fetchPage(u: string) {
  const url = checkUrl(u);
  const res = await fetch(url.toString(), { headers: { 'User-Agent': UA, Accept: 'text/html,*/*', 'Accept-Language': 'it-IT,it;q=0.9' }, redirect: 'follow' });
  if (!res.ok) throw new Error(`Il sito ha risposto ${res.status}`);
  const html = (await res.text()).slice(0, MAX_HTML);
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
  return { html, title, finalUrl: res.url || url.toString() };
}

async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Scarica un'immagine remota e la salva in D1. id deterministico dall'URL = niente doppioni.
export async function fetchImageToFiles(db: D1Database, u: string): Promise<{ id: string; cached: boolean }> {
  const url = checkUrl(u);
  const id = `ph-u${await sha(url.toString())}`;
  const exists = await db.prepare('SELECT 1 AS x FROM files WHERE id = ?').bind(id).first();
  if (exists) return { id, cached: true };
  const res = await fetch(url.toString(), { headers: { 'User-Agent': UA, Accept: 'image/avif,image/webp,image/jpeg,image/*' } });
  if (!res.ok) throw new Error(`Immagine: HTTP ${res.status}`);
  const mime = (res.headers.get('Content-Type') || '').split(';')[0].trim();
  if (!/^image\/(jpeg|png|webp|avif|gif)$/.test(mime)) throw new Error('Non è un\'immagine');
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0 || buf.byteLength > MAX_FILE) throw new Error('Immagine troppo grande');
  await db.prepare('INSERT OR IGNORE INTO files (id, mime, size, data, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, mime, buf.byteLength, buf, Date.now())
    .run();
  return { id, cached: false };
}
