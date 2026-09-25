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
| `welcome-house-db` (binding `DB`) | Cloudflare D1 | read | Tutte le tabelle dell'app (luoghi, categorie, prodotti, lotti, lista spesa, scontrini, budget) |
| `HOUSE_KEY` | Worker secret | read | Verifica della chiave dispositivo |
| `data/gz-il-mio-ricettario.json` | File locale | read | Export ricette GialloZafferano, usato una tantum per l'import (F3); non versionato |

### Output (scritture)

| Risorsa | Tipo | Direzione | Note |
|---|---|---|---|
| `welcome-house-db` (binding `DB`) | Cloudflare D1 | write | Da F1: inserimenti e modifiche di tutti i dati dell'app, con `change_log` |

In F0 le API sono in sola lettura (`/api/ping`). R2 (foto) e Workers AI verranno aggiunti nelle fasi F2–F3 e
documentati qui.

## Sync offline-first (F1)

- L'app legge/scrive sempre su IndexedDB (Dexie, `src/db/`). Ogni modifica va in `outbox` e parte verso `POST /api/sync`.
- Il server assegna a ogni riga una `rev` crescente; i dispositivi scaricano tutto con `rev > cursore`.
- Conflitti: vince l'`updated_at` più recente (per riga). Il server registra tutto in `change_log` (`GET /api/history`).
- Annulla: cronologia locale per dispositivo (Impostazioni → Cronologia).
- Backup: Impostazioni → Esporta JSON / Ripristina.
