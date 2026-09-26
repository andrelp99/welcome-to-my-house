# Welcome to My House

PWA personale per gestire casa, dispensa, lista della spesa, ricettario e prospetto finanziario.
Gira interamente sul piano gratuito Cloudflare: un solo Worker serve sia l'app (static assets) sia le API.

- Frontend: React 19 + Vite + Tailwind 3 + vite-plugin-pwa (installabile su Android)
- API: Cloudflare Worker + Hono (TypeScript)
- Database: Cloudflare D1 (SQLite), migrazioni in `migrations/`
- Tema: scuro di default, toggle chiaro, palette giallo + rosso (token RGB in `src/index.css`)
- Config deploy: `wrangler.jsonc` è l'unica fonte di verità

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

```powershell
npm run db:migrate:remote   # solo quando ci sono nuove migrazioni
npm run deploy              # build + wrangler deploy
```

Con Workers Builds collegato a GitHub, ogni push su `main` fa il deploy automatico.

## Struttura

```
worker/index.ts        API Hono (/api/health, /api/ping)
migrations/            schema D1 versionato
src/                   app React (pagine, componenti, hook tema, client API)
public/icons/          icona app (svg + png per PWA)
data/                  file locali NON versionati (es. export ricette GZ)
```

## Letture / Scritture (I/O)

### Input (letture)

| Risorsa | Tipo | Direzione | Note |
|---|---|---|---|
| `welcome-house-db` (binding `DB`) | Cloudflare D1 | read | Tutte le tabelle dell'app (luoghi, categorie, prodotti, lotti, lista spesa, scontrini, budget, ricette, sostituti, eventi) |
| `welcome-house-db.files` | Cloudflare D1 | read | Foto ricette/passaggi (`GET /api/files/:id`) |
| `HOUSE_KEY` | Worker secret | read | Verifica della chiave dispositivo |
| `data/gz-il-mio-ricettario.json` | File locale | read | Export ricette GialloZafferano, usato una tantum per l'import (F3); non versionato |

### Output (scritture)

| Risorsa | Tipo | Direzione | Note |
|---|---|---|---|
| `welcome-house-db` (binding `DB`) | Cloudflare D1 | write | Da F1: inserimenti e modifiche di tutti i dati dell'app, con `change_log` |
| `welcome-house-db.files` | Cloudflare D1 | write | Da F2: foto compresse (max ~1,9 MB, `PUT /api/files/:id`), immutabili |

Foto in D1 (non R2): nessun bucket da creare, limite free 5 GB ampiamente sufficiente. Workers AI arriva in F3.

## Sync offline-first (F1)

- L'app legge/scrive sempre su IndexedDB (Dexie, `src/db/`). Ogni modifica va in `outbox` e parte verso `POST /api/sync`.
- Il server assegna a ogni riga una `rev` crescente; i dispositivi scaricano tutto con `rev > cursore`.
- Conflitti: vince l'`updated_at` più recente (per riga). Il server registra tutto in `change_log` (`GET /api/history`).
- Annulla: cronologia locale per dispositivo (Impostazioni → Cronologia).
- Backup: Impostazioni → Esporta JSON / Ripristina.

## Ricettario (F2)

- Tabelle: `recipes`, `recipe_ingredients` (collegati al catalogo `products`), `recipe_steps`, `substitutions`, `events`, `files` (migrazione `0003_recipes.sql`).
- Ingredienti: "Incolla lista" con parser (`320 g spaghetti`, `Spaghetti 320 g`, `sale q.b.`) e match automatico sul catalogo.
- Stato vs dispensa: ho / poco / manca / sostituto; conversioni g↔kg, ml↔l, cucchiaio→ml. Unità non convertibili = ho/non ho.
- "Mancanti in lista" → `shopping_items` con origine `ricetta`.
- "Ho cucinato" → scala i lotti (prima i più vicini alla scadenza), eventi `consumo` + `cucinato`, avanzi in frigo (3 gg) o freezer.
- Modalità cucina: `/ricette/:id/cucina`, Wake Lock, un timer. Export PDF = stampa del dettaglio (tema chiaro).
- Foto offline-first: blob in IndexedDB, upload al primo sync utile. Non incluse nel backup JSON.
