# Welcome to My House — decisioni e stato (agg. 2026-09-28)

Doc completo: https://claude.ai/code/artifact/90dba295-701b-4040-81e0-b78035e877ec

## Stato
- F0, F1 chiuse. F2 ricettario, F3 import + AI, F4 planner + push in produzione (verifica in corso). F5 finanze scritta, da deployare (zip F5-finanze, nessuna migrazione).
- Versione app: 0.6.0 (Impostazioni → Versione).
- Migrazioni applicate in remoto: 0001_init, 0002_sync_seed, 0003_recipes, 0004_import, 0005_planner_push.

## Verifiche aperte (Andrea)
- F2: 10 ricette caricate e cucinate
- F3: import 145 ricette da data/gz-il-mio-ricettario.json (anteprima: se "0 ingr." adattare parser); scontrino reale ≤ 2 correzioni; import link GZ da server Cloudflare (possibile 403)
- F4: settimana pianificata + notifica ricevuta su ogni device (Impostazioni → Notifiche → Attiva)
- F5: budget cibo/casa, primo mese di dati

## Residui / da fare
- Annulla tra dispositivi (oggi cronologia locale, 300 voci; base in change_log server)
- Foto nel backup JSON (oggi escluse)
- Match ingredienti con AI quando le regole non bastano (oggi collegamento a mano)

## Come lavoriamo
- Claude scrive nel clone del repo (build + test: wrangler dev + D1 locale + Playwright) → zip con i soli file cambiati
- Andrea: estrae lo zip nella root (C:\Users\andre\Whole House App), toglie lo zip, `npm run db:migrate:remote` se c'è una migrazione nuova, poi `git add -A` → commit → push. Push su main = deploy (Workers Builds)
- Nessuna dipendenza npm aggiunta dopo F1 (niente npm install)
- NON fare git dal VM; node_modules non installare dal VM nella cartella

## Architettura (scelte effettive)
- React 19 + react-router 7 + Vite 8 + Tailwind 3 + vite-plugin-pwa + Dexie 4; Worker Hono; wrangler 4
- D1 welcome-house-db, id d29fd7aa-3a1d-417b-afc0-6dd91c984f26, binding DB
- Foto: D1 tabella files (NO R2). Offline-first: blob in IndexedDB, upload a parte, fuori dal sync
- AI: Workers AI, modello @cf/qwen/qwen3.8-27b, fallback mistral-small-3.1 (vars in wrangler.jsonc). Interfaccia unica worker/ai.ts. L'AI propone, Andrea conferma
- Push: Web Push senza librerie (worker/webpush.ts), chiavi VAPID generate al primo uso in D1 (server_kv). Cron */30, ora italiana: 9:30 scadenze (solo se serve), domenica 18:00 riepilogo, 1° del mese 9:30 report
- Grafici: SVG/HTML fatti a mano (src/components/charts.jsx), niente Recharts
- Sync: outbox → POST /api/sync (push LWW su updated_at + pull rev > cursore, pagine 500). GET /api/history = change_log
- Accesso: nessun login, header X-House-Key; secret HOUSE_KEY (mai in chat/repo). Attivazione device: /attiva?k=CHIAVE

## F0 (chiusa)
- App: https://welcome-to-my-house.andrealucinipaioni.workers.dev
- Repo: https://github.com/andrelp99/welcome-to-my-house (pubblico, main)
- Cartella locale: C:\Users\andre\Whole House App. data/ gitignored: data/gz-il-mio-ricettario.json (145 ricette GZ)
- Egress: cloud/VM NON raggiungono *.workers.dev → verifiche via browser

## Funzioni per fase (sintesi)
- F1: catalogo, Casa/Farmacia, Dispensa (lotti, scadenze, freezer, conta rapida), preferiti/essenziali, lista spesa, check-in, annulla, backup JSON
- F2: ricette con foto, stato ingredienti vs dispensa, sostituti, tag dieta, mancanti in lista, porzioni, modalità cucina (wake lock, 1 timer), "Ho cucinato" + avanzi, PDF (stampa)
- F3: import link (JSON-LD, poi AI), share target Android, testo/foto AI, file JSON multiplo riprendibile, scontrino AI + receipt_aliases
- F4: planner pranzo/cena → lista, push, stagionalità, "Cosa cucino" (anche "manca 1"), stima lista per supermercato
- F5: /finanze (panoramica, spese, prezzi, affari, sprechi), budget, spese extra, eventi consumo/buttato, previsione esaurimento, report mensile, modalità spesa + condividi lista, foto scontrino eliminabile

## Decisioni
- Nome "Welcome to My House". Solo Andrea, sync telefono + tablet Android + PC. NO login
- Aree: Casa (non-cibo, con Farmacia), Dispensa (lotti, scadenze, freezer), Ricettario; Lista spesa trasversale
- Luoghi: frigo, freezer, dispensa cibo, dispensa bagno, dispensa soggiorno, farmacia, altro
- Supermercati: Tigros, Iperal, Esselunga — catena + punto vendita. NO reparti
- Prezzi: pagato + pieno/sconto. Tutto modificabile, annulla + cronologia
- Preferiti (stella → spesa base), Essenziali (scorta per prodotto, default categoria)
- NO barcode, reparti, promemoria casa, scorciatoie Android, liste per negozio, timer multipli, vocale, QR, prezzo-soglia
- Ricette: porzioni default 1
- Avvisi: anticipo frigo 3gg, dispensa 7, freezer 14, farmacia 30
- Tema default SCURO, palette giallo + rosso
