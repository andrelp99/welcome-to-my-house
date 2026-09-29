# Welcome to My House

PWA personale per gestire casa, dispensa, lista della spesa, ricettario e prospetto finanziario.
Gira interamente sul piano gratuito Cloudflare: un solo Worker serve sia l'app (static assets) sia le API.

- Frontend: React 19 + react-router 7 + Vite 8 + Tailwind 3 + vite-plugin-pwa (installabile su Android, share target, push)
- Dati locali: IndexedDB con Dexie 4, offline-first con sync verso il server
- API: Cloudflare Worker + Hono (TypeScript), cron ogni 30 minuti per le notifiche
- Database: Cloudflare D1 (SQLite), migrazioni in `migrations/`; foto nella tabella `files` (niente R2)
- AI: Workers AI (modelli in `wrangler.jsonc` → `vars`)
- Grafici: SVG/HTML fatti a mano, senza librerie
- Tema: scuro di default, toggle chiaro, palette giallo + rosso (token RGB in `src/index.css`)
- Config deploy: `wrangler.jsonc` è l'unica fonte di verità (D1, AI, cron, assets)

## Stato (29/09/2026)

| Fase | Contenuto | Stato |
|---|---|---|
| F0 Setup | Repo, Worker, D1, chiave dispositivo, Workers Builds, PWA | Chiusa |
| F1 MVP | Catalogo, Casa, Dispensa, Lista spesa, check-in, sync offline, annulla, backup | Chiusa |
| F2 Ricettario | Ricette, stato ingredienti, sostituti, modalità cucina, "Ho cucinato", PDF | In produzione, verifica in corso |
| F3 Import + AI | Link, share target, testo/foto, file GZ, scontrino AI | In produzione, verifica in corso |
| F4 Smart | Planner, notifiche push, stagionalità, stima per supermercato | In produzione, verifica in corso |
| F5 Finanze | Prospetto finanziario, sprechi, previsione esaurimento, report mensile | In produzione, verifica in corso |
| Extra | Collega ingredienti (memoria + regole + AI, in blocco) | Scritta, da deployare |
| Extra | Durate per luogo, confezioni a usi, alternative multiple, porzione 1, tag automatici, colori ingredienti | Scritta, da deployare (migrazione 0006) |
| Extra | Durate con AI, costo per porzione, valori nutrizionali, prima ciò che scade, annulla da ogni dispositivo, foto nel backup | Scritta, da deployare (migrazione 0007) |

Limiti noti: le modifiche fatte prima della 0.9 non compaiono nella cronologia condivisa.

Piano completo di progetto: vedi il documento "Welcome to My House — Piano di progetto".

## Accesso (niente login)

Le API sotto `/api/*` (tranne `/api/health`) richiedono l'header `X-House-Key`.
La chiave vive come secret del Worker (`HOUSE_KEY`) e si salva su ogni dispositivo
aprendo **una volta** il link di attivazione:

```
https://<nome-worker>.<tuo-subdominio>.workers.dev/attiva?k=<HOUSE_KEY>
```

Il link non va condiviso: chi lo ha può leggere e modificare i dati.

## Sviluppo locale (Windows, PowerShell)

```powershell
npm install
Copy-Item .dev.vars.example .dev.vars      # chiave locale per wrangler dev
npm run db:migrate:local                    # crea il DB locale
npm run build
npm run dev:api                             # Worker + app su http://localhost:8787
```

Per lavorare sul frontend con hot reload: `npm run dev:api` in un terminale e `npm run dev` in un altro
(Vite su http://localhost:5173, proxy `/api` → 8787). Attivazione locale:
`http://localhost:5173/attiva?k=chiave-di-sviluppo-locale`.

## Deploy

Flusso abituale (Workers Builds collegato a GitHub: ogni push su `main` fa il deploy):

```powershell
npm run db:migrate:remote   # solo se ci sono nuove migrazioni in migrations/ (prima del push)
git add -A
git commit -m "..."
git push
```

Deploy manuale, se serve: `npm run deploy` (build + wrangler deploy). Nessun secret oltre `HOUSE_KEY`:
le chiavi push (VAPID) si generano da sole al primo uso e stanno in D1.

## Struttura

```
worker/index.ts        API Hono: /api/sync, /api/files, /api/import, /api/ai, /api/push, /api/history + cron
worker/sync.ts         push/pull con rev, vince l'updated_at più recente
worker/ai.ts           interfaccia AI unica (ricetta, scontrino) con modello di riserva
worker/importer.ts     import da link (JSON-LD schema.org) e copia foto remote in D1
worker/webpush.ts      Web Push: VAPID ES256 + cifratura aes128gcm
worker/digest.ts       contenuti notifiche: scadenze, riepilogo settimana, report mensile
migrations/            schema D1: 0001_init … 0007_nutrizione_annulla
src/db/                Dexie, sync, logica dispensa, ricette, import, collega ingredienti, scontrino, planner, stagionalità, finanze, foto, push
src/pages/             Home, Casa/Dispensa (Inventario), Spesa, Ricette (+ dettaglio, editor, import, cucina), Planner, Finanze, Catalogo, Impostazioni
src/components/        ui/ (kit, layout, card), forms, recipes, charts
src/hooks/             useData, useTheme, useWakeLock
public/icons/          icona app (svg + png per PWA)
public/push-sw.js      gestione notifiche nel service worker
data/                  file locali NON versionati (es. export ricette GZ)
```

## Letture / Scritture (I/O)

### Input (letture)

| Risorsa | Tipo | Direzione | Note |
|---|---|---|---|
| `welcome-house-db` (binding `DB`) | Cloudflare D1 | read | Tutte le tabelle dell'app (luoghi, categorie, prodotti, lotti, lista spesa, scontrini, righe, spese extra, budget, ricette, ingredienti, passaggi, sostituti, eventi, alias scontrino, planner) |
| `welcome-house-db.files` | Cloudflare D1 | read | Foto ricette/passaggi (`GET /api/files/:id`) |
| `HOUSE_KEY` | Worker secret | read | Verifica della chiave dispositivo |
| `data/gz-il-mio-ricettario.json` | File locale | read | Export ricette GialloZafferano, caricato dall'app (Ricette → Importa → File); non versionato |
| Workers AI (binding `AI`) | Cloudflare Workers AI | read | Da F3: ricette da testo/foto/pagine senza dati strutturati, lettura scontrini. Modelli in `wrangler.jsonc` → `vars` |
| Pagine web e immagini ricette (es. `giallozafferano.it`) | HTTP esterno | read | Da F3: import da link (`POST /api/import/url`) e copia foto (`POST /api/files/fetch`) |
| `welcome-house-db.push_subscriptions`, `server_kv` | Cloudflare D1 | read | Da F4: dispositivi iscritti alle notifiche, chiavi VAPID, ultimo invio |

### Output (scritture)

| Risorsa | Tipo | Direzione | Note |
|---|---|---|---|
| `welcome-house-db` (binding `DB`) | Cloudflare D1 | write | Da F1: inserimenti e modifiche di tutti i dati dell'app, con `change_log` |
| `welcome-house-db.push_subscriptions`, `server_kv` | Cloudflare D1 | write | Da F4: iscrizioni push; chiavi VAPID generate al primo uso |
| Servizi push dei browser (FCM ecc.) | HTTP esterno | write | Da F4: notifiche cifrate (Web Push, VAPID) dal cron |
| `welcome-house-db.files` | Cloudflare D1 | write | Da F2: foto compresse (max ~1,9 MB, `PUT /api/files/:id`), immutabili; da F3 foto copiate dai link; da F5 cancellazione foto scontrino (`DELETE /api/files/:id`) |

Foto in D1 (non R2): nessun bucket da creare, limite free 5 GB ampiamente sufficiente.

## Sync offline-first (F1)

- L'app legge/scrive sempre su IndexedDB (Dexie, `src/db/`). Ogni modifica va in `outbox` e parte verso `POST /api/sync`.
- Il server assegna a ogni riga una `rev` crescente; i dispositivi scaricano tutto con `rev > cursore`.
- Conflitti: vince l'`updated_at` più recente (per riga). Il server registra tutto in `change_log` (`GET /api/history`).
- Annulla: cronologia locale per dispositivo, 300 voci (Impostazioni → Cronologia). Annulla tra dispositivi: non ancora fatto.
- Backup: Impostazioni → Esporta JSON / Ripristina (tutte le tabelle sincronizzate; foto escluse).

## Ricettario (F2)

- Tabelle: `recipes`, `recipe_ingredients` (collegati al catalogo `products`), `recipe_steps`, `substitutions`, `events`, `files` (migrazione `0003_recipes.sql`).
- Ingredienti: "Incolla lista" con parser (`320 g spaghetti`, `Spaghetti 320 g`, `sale q.b.`) e match automatico sul catalogo.
- Stato vs dispensa: ho / poco / manca / sostituto; conversioni g↔kg, ml↔l, cucchiaio→ml. Unità non convertibili = ho/non ho.
- "Mancanti in lista" → `shopping_items` con origine `ricetta`.
- "Ho cucinato" → scala i lotti (prima i più vicini alla scadenza), eventi `consumo` + `cucinato`, avanzi in frigo (3 gg) o freezer.
- Modalità cucina: `/ricette/:id/cucina`, Wake Lock, un timer. Export PDF = stampa del dettaglio (tema chiaro).
- Foto offline-first: blob in IndexedDB, upload al primo sync utile. Non incluse nel backup JSON.

## Import + AI (F3)

- **Link**: `POST /api/import/url` legge il JSON-LD schema.org/Recipe (GialloZafferano e molti siti, senza AI); se manca, AI sul testo della pagina.
- **Condividi da Android**: manifest `share_target` → `/ricette/importa?url|text=…` → import automatico.
- **Testo / foto**: `POST /api/ai/recipe`. **Scontrino**: `POST /api/ai/receipt` (riceve anche i nomi del catalogo per il collegamento).
- **File multiplo**: Ricette → Importa → File. Parser flessibile (`src/db/importer.js`): schema.org o chiavi italiane (nome, porzioni, ingredienti{nome,dose}, passaggi{testo,foto}…). Salta i doppioni (url o titolo): se si interrompe, si riparte dallo stesso file.
- AI dietro un'interfaccia unica (`worker/ai.ts`): modello principale + fallback in `wrangler.jsonc` (`AI_MODEL`, `AI_MODEL_FALLBACK`). L'AI propone, si conferma sempre in app.
- `receipt_aliases`: riga di scontrino → prodotto, imparata a ogni conferma (migrazione `0004_import.sql`).
- In locale `wrangler dev` usa Workers AI remoto (serve `wrangler login`).

## Collega ingredienti

- Pagina `/ricette/collega` (banner nel ricettario quando ci sono ingredienti senza prodotto). Logica in `src/db/linker.js`.
- Ingredienti raggruppati per nome normalizzato ("Rosmarino fresco" = "rosmarino"), con conteggio e ricette.
- Proposte, in ordine: **memoria** (stesso ingrediente già collegato altrove) → **regole** (`matchProduct`) → **AI** → **simile** (stesso primo termine, da verificare).
- AI: `POST /api/ai/match` (lotti da 30) → prodotto esistente del catalogo, oppure prodotto nuovo da creare (nome, categoria, unità, luogo), oppure "non serve" (acqua, ghiaccio). Proposte AI salvate sul dispositivo (`meta.link_ai`).
- Conferma singola (✓) o in blocco (seleziona → Conferma). Un'unica operazione: annullabile. I prodotti nuovi entrano nel catalogo.
- "Non serve in dispensa": `product_id = 'no-product'` (non conta come da collegare, né come mancante).
- La memoria vale anche per import e editor: un ingrediente già collegato una volta si collega da solo nelle ricette nuove.

## Smart (F4)

- **Planner** (`/planner`, tabella `meal_plan`): pranzo/cena per giorno, ricetta + porzioni o nota libera. "Genera lista" somma i fabbisogni dei pasti da oggi a domenica, toglie la dispensa e i sostituti disponibili → `shopping_items` origine `planner`. "Ho cucinato" dal planner segna il pasto fatto.
- **Notifiche push**: Web Push senza librerie (`worker/webpush.ts`: VAPID ES256 + cifratura aes128gcm). Chiavi VAPID create al primo uso in `server_kv`: nessun secret da configurare. Attivazione per dispositivo in Impostazioni → Notifiche (con invio di prova).
- **Cron** `*/30 * * * *` (`wrangler.jsonc` → `triggers`): decide in ora italiana (`worker/digest.ts`). 9:30 scadenze, solo se qualcosa entra oggi nella finestra di avviso o scade entro domani. Domenica 18:00 riepilogo: cosa scade, sotto scorta, spesa settimana vs budget, 3 ricette fattibili, pasti pianificati.
- **Stagionalità** (`src/db/season.js`): frutta e verdura del mese, filtro "di stagione" nel ricettario e nel planner (almeno un ingrediente di stagione e nessuno fuori stagione; conserve escluse).
- **Stima lista per supermercato**: ultimo prezzo pagato per catena, confrontato solo sui prodotti con prezzo noto in tutte.

## Prospetto finanziario (F5)

- Pagina `/finanze`, tutto calcolato in locale (`src/db/finance.js`) da `receipts`, `purchase_lines`, `extra_expenses`, `budgets`, `events`. Grafici leggeri senza librerie (`src/components/charts.jsx`), colori dai token del tema.
- **Panoramica**: speso del mese vs mese prima, proiezione fine mese (dal 3° giorno), risparmio offerte, cibo buttato, budget cibo/casa con proiezione, ultimi 6 mesi, anno + proiezione, indicazioni automatiche.
- **Budget**: un valore per area e mese; vale dal mese impostato in poi finché non lo cambi.
- **Spese**: per settimana, calendario, per categoria, per supermercato, movimenti. Dettaglio scontrino con foto eliminabile (`DELETE /api/files/:id`). Spese extra manuali (area cibo/casa/altro).
- **Prezzi**: storico per prodotto normalizzato (€/kg, €/l, €/pz), media, minimo, confronto tra catene; punti verdi = offerta.
- **Affari**: risparmio, migliori offerte, "dove conviene" (≥3% tra catene), prodotti spesso in offerta.
- **Sprechi**: da "Buttato" in Dispensa (evento `buttato` con valore dal prezzo della riga d'acquisto del lotto, altrimenti ultimo prezzo).
- **Eventi di consumo**: il tasto − / conta rapida e "Finito" registrano `consumo` → previsione esaurimento (ritmo ultimi 60 giorni) in Home ("Finiscono presto") e in Dispensa.
- **Report mensile push** il 1° alle 9:30 (cron esistente): speso vs budget, confronto col mese prima, risparmio, 3 affari, sprechi.
- **Lista spesa**: modalità spesa (schermo acceso, righe grandi) e condivisione come testo.

## Durate, confezioni, tag (0.8.0)

- **Durate per luogo** (prodotti cibo): `pantry_days` (dispensa), `fridge_days` (frigo), `freezer_max_months` (freezer), `open_shelf_days` (da aperto). Se è impostata almeno dispensa o frigo, i luoghi senza durata non si possono scegliere (lotto, check-in, luogo abituale, "Congela"). Scadenza del lotto proposta dal luogo (`autoExpiry` in `src/db/logic.js`), sempre modificabile.
- **Confezioni a usi**: unità `conf` + `uses_per_pack`. Le ricette scalano a usi: "2 dadi", "1 bustina", "2 uso" = usi; g/ml restano non convertibili (`toProductUnit` in `src/db/recipes.js`). Dispensa mostra "2 conf · ~20 usi", il "−" toglie 1 uso.
- **Alternative accettate**: scelta multipla dal catalogo (salvate come nomi separati da virgola).
- **Porzione standard 1**: dettaglio, cucina, "Ho cucinato", lista mancanti, planner e "Cosa cucino" partono da 1 porzione. `recipes.servings` = dosi della ricetta originale ("Dosi per").
- **Tag automatici** (`src/db/tags.js`): portata (colonna `recipes.course`, se vuota dedotta da categoria GZ/titolo), tempo totale (≤15′, ≤30′, ≤1 h, >1 h), difficoltà (scritta o stimata da ingredienti, passaggi, tempo; "~" = automatica). Filtri nel ricettario. Tag SEO degli export (ricetta, cucina…) nascosti.
- **Colori ingredienti**: verde ce l'ho, rosso manca (anche "poco"), arancio sostituto. Ricetta con sostituti = "fattibile*".
- Migrazione `0006_durate_portate.sql`: va applicata PRIMA del push (`npm run db:migrate:remote`).

## Costi, nutrizione, scadenze, annulla, backup (0.9.0)

- **Durate con AI**: Catalogo → banner → `/catalogo/durate`. `POST /api/ai/durations` (lotti da 30) propone giorni dispensa/frigo, mesi freezer, giorni da aperto, usi per confezione. Proposte in giallo, modificabili, salvate sul dispositivo (`meta.dur_ai`); si salva solo ciò che confermi.
- **Costo per porzione** (`src/db/insights.js`): ultimo prezzo pagato (`lastPrice` + `lastPriceUnit`, convertito all'unità del prodotto) × quantità della ricetta. "q.b." esclusi; "+" = alcuni prezzi mancanti. Ordina "Più economiche" (prima le ricette con tutti i prezzi).
- **Valori nutrizionali** per porzione: colonna `recipes.nutrition` (JSON: kcal, carbs, sugar, fat, satfat, protein, fiber, chol, sodium) da `nutrition` schema.org/GZ. Per le ricette già importate: Importa → File → "Aggiorna" (riempie nutrizione e portata mancanti). Ordina "Meno calorie".
- **Prima ciò che scade**: ricette che usano prodotti in scadenza (anticipo del luogo) in cima a ricettario (ordinamento di default), "Cosa cucino" e planner; badge "usa …" e avviso nel dettaglio.
- **Annulla da ogni dispositivo**: ogni operazione con etichetta ha un `op` (outbox → `/api/sync` → `change_log.op_id/label`). `GET /api/ops` = ultime operazioni di tutti i dispositivi; `POST /api/undo {op, force}` ripristina lo stato "prima" (409 se righe cambiate dopo: si conferma con "Annulla comunque"). L'annulla locale (toast) marca l'operazione come annullata anche sul server (`undoes`).
- **Foto nel backup**: Esporta JSON (versione 2) include le foto di ricette, passaggi e scontrini come data URL (toggle). Il ripristino le rimette in locale e le ricarica sul server.
- Migrazione `0007_nutrizione_annulla.sql`: va applicata PRIMA del push, insieme alla 0006.
