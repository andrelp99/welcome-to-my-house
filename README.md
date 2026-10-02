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
migrations/            schema D1: 0001_init … 0010_diario_varieta
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
- **Cron** `*/30 * * * *` (`wrangler.jsonc` → `triggers`): decide in ora italiana (`worker/digest.ts`). 9:30 scadenze, solo se qualcosa entra oggi nella finestra di avviso o scade entro domani. Domenica 20:00 riepilogo (da 0.12 anche diario: varietà, pasti fuori, pasti da registrare): cosa scade, sotto scorta, spesa settimana vs budget, 3 ricette fattibili, pasti pianificati.
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

## Usi, superflui, tag AI (0.10.0)

- **Porzioni/usi per unità** per ogni prodotto (`products.uses_per_pack` = usi per 1 unità; per g/ml si mostra e si chiede "per 100 g/ml"). Dispensa: "0,5 kg · ~6 usi", il "−" toglie 1 uso. Ricette: "2 porzioni/dosi/usi" = usi; "q.b." di un prodotto a usi = 1 uso per ricetta intera.
- **Usi già fatti**: modifica lotto → "Usi già fatti" (unità iniziate contano piene: 1,3 conf da 10 usi = 13 rimasti su 20) → cambia la quantità del lotto.
- **Categorie a utilizzo** (`categories.by_use`, migrazione 0008): Catalogo → Durate e porzioni → "Categorie a utilizzo" (AI + tocco per cambiare → Salva). I prodotti di queste categorie senza usi finiscono tra i "da completare"; `POST /api/ai/durations` propone gli usi per tutti.
- **Alternative / sostituti**: il selettore propone prima i prodotti della stessa categoria (`ProductPicker prefer`).
- **Ingredienti superflui**: nel dettaglio ricetta, icona occhio su ogni ingrediente (= `optional`). Grigio, non conta come presente/mancante, non va in lista, non si scala con "Ho cucinato", fuori da costo, scadenze e "Collega".
- **Tag con AI**: `/ricette/tag`, `POST /api/ai/tags` (15 ricette per chiamata): ingrediente principale, cottura, occasione, carattere, cucina (+ portata se manca). Tocca un tag per scartarlo, poi Conferma. Proposte in `meta.tag_ai`. Nel ricettario: filtro per tag (i più usati) e link "Tag con AI".
- Migrazione `0008_categorie_a_uso.sql`: PRIMA del push.

## Classificazione ricette (0.11.0)

Sostituisce i tag AI liberi della 0.10 (quei tag ora sono nascosti per non duplicare). Vocabolario in `src/db/tags.js`.

- **Tempo** (preparazione + cottura + riposo): Breve ≤ 30′ · Medio 30–60′ · Lungo > 60′. Calcolato.
- **Difficoltà**: Semplice · Media · Complessa (salvate come facile/media/difficile). AI o a mano; senza valore: stima automatica ("~").
- **Portata**: Antipasto · Primo · Secondo · Contorno · Piatto unico · Dolce · Altro (salse e sughi, pane e lievitati, colazione, bevande).
- **Base**: `recipes.main_food` (principale) + `recipes.second_food` (facoltativo), valori "Gruppo" o "Gruppo|sotto": Carne (bianca, rossa, maiale, salumi), Pesce (pesce, crostacei, molluschi), Uova, Latticini (formaggi, ricotta, yogurt), Proteine (legumi, tofu e seitan, altre), Carboidrati (pasta, riso, cereali, pane e impasti, patate), Verdure (ortaggi, funghi, frutta).
- **Caratteristiche** (`recipes.features`, id separati da virgola): conservazione, come si mangia, cottura, praticità, profilo, occasione. Calcolate e non salvate (sempre su 1 porzione): leggero ≤ 500 kcal, economico ≤ 2 € (solo con tutti i prezzi noti), richiede riposo ≥ 30′. Dieta resta in `diet_tags`.
- **AI**: `/ricette/tag` ("Classifica ricette"), `POST /api/ai/classify` (12 ricette per chiamata, valori validati sul server), proposte in `meta.cls_ai`, compila solo i campi vuoti, tutto modificabile (▾), conferma in blocco.
- **Ricettario**: filtri Portata, Base (gruppo o sotto, principale o secondario), Tempo, Difficoltà + pannello "Caratteristiche". Editor ricetta: base, secondario, caratteristiche.
- **Catalogo**: pulsante fisso "Durate e porzioni".
- Migrazione `0009_classificazione.sql`: PRIMA del push.

## Terzo alimento delle ricette (0.15.0)

- `recipes.third_food` (migrazione `0013`), facoltativo come il secondario: compare nel modulo ricetta e in Classifica con AI solo se c'è il secondario; l'AI lo propone raramente (piatti con tre componenti importanti).
- Conta negli obiettivi, nei filtri per base del ricettario, nella varietà delle Consigliate e nelle analisi, come principale e secondario.
- **+ ingredienti** su un piatto già mangiato (Casa/Schiscia), dal planner o da Consumi → Giorno: scegli prodotti e quantità, scala la dispensa con la data del piatto (prima i lotti che scadono), li lega al piatto (`events.plan_id`), aggiorna il costo reale della cottura e il costo per porzione dell'avanzo. Togliendo "mangiato" tornano in dispensa anche questi.
- Storico retroattivo: i piatti del diario leggono sempre la ricetta attuale (titolo, portata, alimenti, caratteristiche, stelle), quindi modificare una ricetta aggiorna subito obiettivi, dashboard e analisi di tutte le settimane passate. Restano invece come registrati ingredienti consumati e costi (sono ciò che è stato davvero usato).

## Ingredienti per pasto e consumi (0.14.0)

- **Ho cucinato ovunque**: ✓ nel planner, "Cosa ho mangiato → Ricettario", proposte segnate fatte e pagina ricetta aprono lo stesso pannello (`src/components/cook.jsx`, `src/db/cook.js`). Scala solo con luogo **Casa** o **Schiscia**; **Casa Crema**, fuori e mensa vanno solo nel diario.
  - Rapido "Come da ricetta" oppure "Modifica": quantità, spunte, alternative (sostituti + stessa categoria in casa), "+ ingrediente", per i mancanti "usato comunque / finito → lista spesa / non usato".
  - Porzioni cucinate (default 1) e mangiate: la differenza diventa avanzo con costo per porzione (`stock_lots.unit_cost`).
  - Dose tua: dalle ultime 2 volte uguali (per porzione). Giorni passati: eventi con la data del pasto.
  - Togli ✓ o elimina il piatto → "Rimetto in dispensa?": ripristina i lotti originali (`events.lot_id`), toglie l'avanzo creato.
  - Scritto a mano: fino a 10 ingredienti con quantità, ★ max 2 = base per gli obiettivi.
- **Conta rapida**: un calo chiede usati / buttati / correzione (`events.type = 'rettifica'`, non conta).
- **Dispensa → Consumi** (`src/pages/Consumi.jsx`, `src/db/consumi.js`): Giorno (pasto per pasto, quota mangiata), Periodo (tabella, categorie, costo per pasto casa/schiscia/fuori, costo reale ricette, top e dormienti, CSV), Prodotti (uso medio, finisce tra, prezzi, storico), Bilancio (comprato/usato/buttato, % spreco). Costo del giorno anche nel planner accanto alla data.
- Valore = prezzo del lotto usato, altrimenti ultimo prezzo convertito nell'unità giusta. Eventi vecchi senza lotto: ricalcolati dall'ultimo prezzo.
- Notifica domenica: "Ingredienti usati X € · buttati Y €".
- **Scontrino AI salvato**: appena letto diventa una bozza (`settings` id `scontrino-…`, sincronizzata). Chiudendo con X o "Dopo" resta in Spesa ("Scontrino da confermare · Riprendi / Elimina") con tutte le modifiche fatte; sparisce solo con Registra o Elimina. Niente nuova lettura AI.
- **Nuovo prodotto → Dispensa cibo o Casa**: scelta in cima al modulo; per i nuovi la propone dal nome (detersivi, shampoo, carta, farmaci, sacchi…), con categoria e luogo di casa.
- Migrazione `0012`: `events.plan_id/lot_id`, `stock_lots.unit_cost/plan_id`, `meal_plan.cooked/scaled`. Obiettivo "Pasti a casa" conta anche la Schiscia.

## Alimenti nei pasti e preferite ★5 (0.13.0)

- **Alimento** (tab in Aggiungi piatto / Cosa ho mangiato): frutta, verdura, dolce, snack, latticini, pane/cracker, altro. Dalla dispensa (scala la quantità: 1 uso, 1 pz, 100 g o 125 ml per porzione, modificabile) o scritto libero. Salvato in `meal_plan` con `dish_features = 'alimento'`, `note` = nome, `dish_course` = tipo, `dish_main` = "conta come", `servings` = quanti, `dish_ings` = prodotto.
- Obiettivi: gli alimenti contano per la loro base (frutta → Frutta e Giorni con frutta; verdura → Verdure, anche a pranzo e a cena); "2 mele" = 2. Un pasto con soli alimenti non conta come pasto a casa/fuori/delivery.
- **Preferite** = ricette con ★★★★★ (gradimento). Tolto il toggle "Preferita". Migrazione `0011` converte le vecchie preferite senza voto in ★5.

## Diario pasti e varietà (0.12.0)

- **Diario**: ogni riga `meal_plan` è un piatto; `done = 1` = mangiato. Tipi di piatto: ricetta (`recipe_id`), avanzo (`leftover_of`), scritto a mano (`note` + `dish_course`, `dish_main`, `dish_second`, `dish_features`, `dish_ings` fino a 3 prodotti). `auto = 1` = proposta di "Riempi". `used_expiring` = ingredienti in scadenza usati.
- **Pasti** (`meals`, id `ml-AAAA-MM-GG-pasto`): luogo (casa, ristorante, lavoro/mensa, amici/parenti, delivery) e costo; costo fuori casa → `extra_expenses` categoria "ristoranti" (id `ex-<pasto>`). Colazione e merenda facoltative (Planner → toggle, salvato in `settings.planner`).
- **Ho cucinato**: scala la dispensa + scrive nel diario (pasto dall'ora, modificabile; segna fatto il pianificato invece di duplicare) + "Com'era?" (stelle). Tutto in una sola operazione annullabile. **Avanzi**: "Mangiato" in dispensa o nel modale Aggiungi piatto → −1 porzione + piatto nel diario.
- **Stelle** (`recipes.rating` 1–5) e **frequenza** (`recipes.want_freq` 1–5, 0 = non propormela; 5 = 7 gg, 4 = 14, 3 = 30, 2 = 75, 1 = 150). Nel dettaglio ricetta, con storico (volte, ultima, elenco).
- **Obiettivi** (`src/db/variety.js`, puro: lo usa anche il Worker): 23 settimanali + 5 mensili, modificabili (Planner → ⚙ in Varietà), salvati in `settings.goals`. Dashboard settimana/mese nel planner con 8 caselle al giorno.
- **Consigliate** (`scoreRecipe`): varietà / gradimento / ritardo / scadenze / fattibile, pesi in Impostazioni → Proposte ricette (`settings.weights`, default 32/28/14/18/8). Escluse "non propormela" e le ricette fatte da meno di metà intervallo. Usato da Home, ricettario (ordinamento predefinito), Aggiungi piatto, Riempi.
- **Riempi con proposte**: giorni e pasti scelti, solo vuoti, varietà rispettata anche tra le proposte (niente contorni/antipasti/dolci a pranzo e cena), ricetta cambiabile per slot, "Togli proposte" sui giorni scelti.
- **Analisi** (planner): andamento varietà, basi del mese, calendario pasti, casa/fuori/delivery, costo a porzione, gradimento, tempo in cucina, serie e record, anti-spreco.
- **Finanze → Abitudini** (`src/db/habits.js`): frequenza spesa, giorni, negozi, "quando l'ho preso l'ultima volta", più comprati, dove va la spesa, previsti, non più comprati, fuori lista (`purchase_lines.from_list`, dai check-in 0.12), comprato e buttato, categorie mese per mese.
- **Domenica 20:00**: riepilogo con varietà, obiettivi mancati/sforati, pasti fuori, pasti da registrare (pranzo/cena, esclusa la cena di domenica).
- Migrazione `0010_diario_varieta.sql`: PRIMA del push.
