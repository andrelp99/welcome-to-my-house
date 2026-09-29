# Welcome to My House — decisioni e stato (agg. 2026-09-29, 0.12)

Doc completo: https://claude.ai/code/artifact/90dba295-701b-4040-81e0-b78035e877ec

## Stato
- F0, F1 chiuse. F2–F5 in produzione (verifica in corso). 145 ricette GZ importate.
- 0.7–0.11 in produzione (migrazioni remote 0001 … 0009).
- 0.12.0 diario pasti, pasti fuori, stelle/frequenza, obiettivi varietà + dashboard + analisi, Consigliate, Riempi, Abitudini, recap domenica: file nella cartella, da deployare. Migrazione nuova 0010 PRIMA del push.

## Verifiche aperte (Andrea)
- F2: 10 ricette caricate e cucinate
- F3: scontrino reale ≤ 2 correzioni; import link GZ da server Cloudflare (possibile 403)
- F4: settimana pianificata + notifica ricevuta su ogni device (Impostazioni → Notifiche → Attiva)
- F5: budget cibo/casa, primo mese di dati
- 0.9.0: Catalogo → Durate → Proponi con AI → conferma; Importa → File GZ → Aggiorna (nutrizione); prova annulla da un altro dispositivo; backup con foto
- 0.8.0: impostare durate (dispensa/frigo/freezer) e usi per confezione sui prodotti usati; controllare portata/difficoltà auto
- Collega: 451 ingredienti GZ (230 diversi) da collegare con AI → rivedere proposte (unità/categoria prodotti nuovi)

## Verifiche 0.12
- Stelle sulle ricette preferite; Ho cucinato → diario; Cosa ho mangiato (anche fuori, con costo); Riempi con proposte; controlla obiettivi (⚙) e pesi (Impostazioni)

## Verifiche 0.11
- Ricette → Classifica con AI → Proponi → rivedi (▾) → Conferma

## Verifiche 0.10
- Durate e porzioni → Categorie a utilizzo (AI → Salva) → Proponi con AI → Conferma
- segnare superflui dove serve

## Residui / da fare
- Nessun residuo tecnico aperto. Cronologia condivisa solo da 0.9 in poi

## Come lavoriamo
- Claude scrive nel clone del repo (build + test: wrangler dev + D1 locale + Playwright) → copia i file cambiati direttamente nella cartella (o zip)
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
- Ricette: porzione standard 1 ovunque (servings = dosi originali). Confezioni: ricetta scala a usi ("2 dadi" = 2 usi). Durate: una per luogo, vuoto = non ci va
- Avvisi: anticipo frigo 3gg, dispensa 7, freezer 14, farmacia 30
- Tema default SCURO, palette giallo + rosso
