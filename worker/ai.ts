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
 "course": "Antipasto"|"Primo"|"Secondo"|"Contorno"|"Piatto unico"|"Dolce"|"Salsa e sugo"|"Pane e lievitati"|"Colazione"|"Bevanda"|null,
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

  match: `Sei un assistente che collega ingredienti di ricette italiane ai prodotti di una dispensa di casa.
Ricevi un catalogo prodotti (nomi esatti), le categorie disponibili (id: nome) e una lista numerata di ingredienti.
Rispondi SOLO con JSON valido con questa forma:
{ "items": [{"n": number, "catalog": string|null, "new": {"name": string, "category_id": string, "unit": "g"|"kg"|"ml"|"l"|"pz"|"conf", "location": "frigo"|"freezer"|"dispensa"}|null, "skip": boolean}] }
Un elemento per ogni ingrediente, stesso "n".
Regole:
- "catalog" = il nome ESATTO di un prodotto del catalogo se e' lo stesso alimento che si compra (es. "Pecorino romano DOP da grattugiare" -> "Pecorino"; "Pomodorini datterini" -> "Pomodorini"; "Cosce di pollo" -> "Pollo" solo se non esiste un prodotto piu' specifico). Non collegare alimenti diversi (burro != margarina, brodo vegetale != dado, se non c'e' il dado).
- Se nessun prodotto del catalogo va bene, "catalog" null e "new" = prodotto generico da creare: nome breve e comprabile al supermercato, senza quantita', marche o preparazioni (es. "rosmarino tritato" -> "Rosmarino"; "sedano 1 costa" -> "Sedano"); category_id tra quelli forniti; unit = come si conta in casa (g per spezie/erbe/formaggi/farine, ml per liquidi, pz per frutta/verdura a pezzi, conf per confezioni); location = dove si tiene.
- "skip" true solo per cose che non si comprano o non si tengono in dispensa (acqua del rubinetto, ghiaccio, acqua di cottura, "q.b." senza alimento): allora catalog e new null.
- Non inventare prodotti nel catalogo.`,

  durations: `Sei un esperto di conservazione degli alimenti in una casa italiana.
Ricevi una lista numerata di prodotti alimentari (nome, categoria, unita').
Per ciascuno indica quanto dura DA QUANDO ENTRA IN CASA (confezione integra, come si compra di solito al supermercato):
Rispondi SOLO con JSON valido:
{ "items": [{"n": number, "pantry_days": number|null, "fridge_days": number|null, "freezer_months": number|null, "open_days": number|null, "uses_per_pack": number|null}] }
Regole:
- pantry_days = giorni a temperatura ambiente (dispensa); null se NON si conserva fuori frigo (latte fresco, carne, pesce, formaggi freschi, verdura a foglia...).
- fridge_days = giorni in frigo; null se in frigo non ha senso (pasta secca, farina, zucchero, scatolame chiuso, spezie).
- freezer_months = mesi in freezer; null se non si congela bene (uova intere, insalata, latte UHT, pasta secca, scatolame).
- open_days = giorni dopo l'apertura della confezione (in frigo se serve); null se non cambia (spezie, sale, pasta secca).
- uses_per_pack = porzioni/usi tipici per UNITA' del prodotto: per unita' g o ml indica gli usi per 100 g/ml (parmigiano 100 g = 10 usi, olio 100 ml = 7 usi); per kg/l per 1 kg/l (pasta 1 kg = 12 porzioni, latte 1 l = 5 usi); per pz/conf per 1 pezzo/confezione (dado 10, bustine lievito 3, vasetto pesto 3, uova 1 pz = 1).
  Obbligatorio per spezie, erbe, salse, condimenti, dadi, lievito, sale, zucchero (si usano a dosi); per il resto indicalo se sensato, altrimenti null.
- Valori prudenti, numeri interi, un elemento per ogni prodotto con lo stesso "n". Non inventare prodotti.`,

  substitutes: `Sei un cuoco italiano esperto che aiuta a sostituire ingredienti mancanti con quello che c'e' in dispensa.
Ricevi un catalogo di prodotti di casa (nomi esatti) e una lista numerata di ingredienti.
Per ogni ingrediente proponi da 0 a 3 sostituti SCELTI SOLO dal catalogo (nome esatto), che in cucina funzionano davvero al suo posto nella maggior parte delle ricette (es. burro -> olio extravergine con ratio 0.8; panna -> latte con nota "con una noce di burro"; parmigiano -> grana; pancetta -> guanciale; brodo vegetale -> dado).
Non proporre lo stesso prodotto, ne' alimenti con ruolo diverso (pasta != riso, zucchero != sale). Se non c'e' un sostituto sensato, lista vuota.
ratio = quantita' di sostituto per 1 unita' di ingrediente (1 = stessa quantita').
Rispondi SOLO con JSON valido: { "items": [{"n": number, "subs": [{"name": string, "ratio": number, "note": string|null}]}] }`,

  categories: `Sei un assistente per la gestione di una dispensa di casa italiana.
Ricevi categorie di prodotti alimentari (id, nome, esempi di prodotti).
Decidi se ogni categoria e' "a utilizzo": i suoi prodotti si consumano a piccole dosi/usi ripetuti da una confezione (spezie, sale, salse, condimenti, olio, aceto, dadi, lievito, caffe'...) invece che a quantita' intere pesate per ricetta (carne, pasta, verdura, frutta, latte...).
Rispondi SOLO con JSON valido: { "items": [{"id": string, "by_use": boolean}] } con un elemento per ogni categoria ricevuta.`,

  classify: `Sei un assistente che classifica ricette italiane per aiutare a scegliere cosa cucinare.
Ricevi ricette numerate (titolo, portata attuale, minuti totali, minuti di riposo, n. passaggi, ingredienti).
Per ciascuna rispondi usando SOLO questi valori:
- course: "Antipasto"|"Primo"|"Secondo"|"Contorno"|"Piatto unico"|"Dolce"|"Salsa e sugo"|"Pane e lievitati"|"Colazione"|"Bevanda"
- difficulty: "facile"|"media"|"difficile" (tecnica richiesta, numero di passaggi, precisione)
- main: alimento PRINCIPALE, "Gruppo" o "Gruppo|sotto" tra:
  Carne|bianca, Carne|rossa, Carne|maiale, Carne|salumi, Pesce|pesce, Pesce|crostacei, Pesce|molluschi, Uova,
  Latticini|formaggi, Latticini|ricotta, Latticini|yogurt, Proteine|legumi, Proteine|tofu e seitan, Proteine|altre,
  Carboidrati|pasta, Carboidrati|riso, Carboidrati|cereali, Carboidrati|pane e impasti, Carboidrati|patate,
  Verdure|ortaggi, Verdure|funghi, Verdure|frutta
- second: alimento secondario importante con gli stessi valori, oppure null (solo se davvero caratterizza il piatto, es. pasta e fagioli: main Carboidrati|pasta, second Proteine|legumi)
- third: terzo alimento con gli stessi valori, oppure null (raro: solo piatti con tre componenti importanti, es. pasta salsiccia e funghi)
- features: da 2 a 6 tra: congela (si congela bene), frigo (dura 2-3 giorni in frigo), subito (da mangiare subito), mealprep,
  freddo, tiepido, caldo, crudo (senza cottura), forno, padella, griglia, fritto, bollito (anche vapore), umido (cottura lenta/in umido),
  schiscetta (da portare via), unapentola, anticipo (si prepara in anticipo), proteico, sostanzioso, piccante,
  quotidiano (tutti i giorni), ospiti, festa, estate, inverno
- diet: tra "senza glutine", "senza lattosio" solo se certo dagli ingredienti, altrimenti []
Rispondi SOLO con JSON valido: { "items": [{"n": number, "course": string, "difficulty": string, "main": string, "second": string|null, "third": string|null, "features": string[], "diet": string[]}] }
Un elemento per ogni ricetta con lo stesso "n". Non inventare valori fuori elenco.`,
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
