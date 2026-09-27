// Interfaccia AI unica: ai.extract(tipo, input). Cambiare modello/provider = toccare solo questo file (o le vars).
// L'AI propone, Andrea conferma: niente entra nei dati senza revisione nell'app.

export type AiEnv = { AI: Ai; AI_MODEL?: string; AI_MODEL_FALLBACK?: string };

const DEFAULT_MODEL = '@cf/qwen/qwen3.8-27b'; // vision + JSON (OpenAI-compatibile)
const DEFAULT_FALLBACK = '@cf/mistralai/mistral-small-3.1-24b-instruct';

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

const RECIPE_SCHEMA = `{
 "title": string,
 "servings": number|null,
 "prep_min": number|null, "cook_min": number|null, "rest_min": number|null,
 "difficulty": "facile"|"media"|"difficile"|null,
 "tags": string[],
 "ingredients": [{"text": string, "qty": number|null, "unit": string|null, "group": string|null, "optional": boolean}],
 "steps": [{"text": string, "timer_min": number|null}],
 "notes": string|null
}`;

const PROMPTS = {
  recipe: `Sei un assistente che estrae ricette in italiano. Dal contenuto fornito estrai UNA ricetta.
Rispondi SOLO con JSON valido con questa forma:
${RECIPE_SCHEMA}
Regole: testo in italiano; "text" dell'ingrediente = solo il nome (es. "spaghetti"), quantita' in "qty" e unita' in "unit" (g, kg, ml, l, pz, cucchiaio, cucchiaino, spicchio, foglia, pizzico, q.b.);
"q.b." -> qty null, unit "q.b."; un passaggio per step, senza numerazione; timer_min solo se il passaggio indica un tempo; servings = porzioni; se un dato manca usa null. Non inventare.`,

  receipt: `Sei un assistente che legge scontrini di supermercati italiani (Tigros, Iperal, Esselunga, ecc.).
Rispondi SOLO con JSON valido con questa forma:
{
 "chain": string|null, "branch": string|null, "date": "YYYY-MM-DD"|null, "total": number|null,
 "lines": [{"raw": string, "name": string, "catalog": string|null, "count": number, "size_qty": number|null, "size_unit": "g"|"kg"|"ml"|"l"|"pz"|null, "price_paid": number, "price_full": number|null}]
}
Regole: una riga per articolo acquistato; "raw" = testo come stampato; "name" = nome generico italiano leggibile (es. "Spaghetti Barilla");
"catalog" = il nome ESATTO dal catalogo fornito se corrisponde chiaramente, altrimenti null;
"count" = numero di pezzi (es. "2 x 1,29" -> 2); size_qty/size_unit = formato della confezione se scritto (es. "500G" -> 500, "g");
"price_paid" = totale pagato per la riga DOPO sconti; se c'e' uno sconto/offerta sulla riga (righe tipo "SCONTO", "-0,50", "OFFERTA") "price_full" = prezzo prima dello sconto, altrimenti null.
Ignora totali, resto, pagamenti, IVA, punti fedelta', sacchetti se non richiesti. Numeri con il punto decimale. Non inventare righe.`,
} as const;

export type ExtractKind = keyof typeof PROMPTS;

function parseJson(text: string): unknown {
  const t = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('Risposta AI non in JSON');
  }
}

function contentOf(out: unknown): string | object {
  const o = out as Record<string, any>;
  if (o?.choices?.[0]?.message?.content != null) return o.choices[0].message.content;
  if (o?.response != null) return o.response;
  if (typeof out === 'string') return out;
  throw new Error('Risposta AI vuota');
}

async function run(env: AiEnv, model: string, system: string, parts: Part[]) {
  const input = {
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: parts },
    ],
    max_tokens: 4096,
    temperature: 0.1,
    response_format: { type: 'json_object' },
    chat_template_kwargs: { enable_thinking: false },
  };
  const out = await (env.AI as any).run(model, input);
  const c = contentOf(out);
  return typeof c === 'object' ? c : parseJson(c);
}

// input: testo e/o immagini (data URL base64). extra = contesto aggiuntivo (es. nomi catalogo).
export async function extract(env: AiEnv, kind: ExtractKind, input: { text?: string; images?: string[]; extra?: string }) {
  if (!env.AI) throw new Error('Workers AI non configurato');
  const parts: Part[] = [];
  if (input.extra) parts.push({ type: 'text', text: input.extra });
  if (input.text) parts.push({ type: 'text', text: input.text.slice(0, 24000) });
  for (const url of input.images || []) parts.push({ type: 'image_url', image_url: { url } });
  if (!parts.length) throw new Error('Niente da analizzare');
  const models = [env.AI_MODEL || DEFAULT_MODEL, env.AI_MODEL_FALLBACK || DEFAULT_FALLBACK];
  let last: unknown;
  for (const m of models) {
    try {
      return { model: m, data: await run(env, m, PROMPTS[kind], parts) };
    } catch (e) {
      last = e;
      console.error(JSON.stringify({ level: 'warn', msg: 'ai fallita', model: m, err: String(e) }));
    }
  }
  throw last instanceof Error ? last : new Error('AI non disponibile');
}
