import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Link2, FileText, Camera, FileJson, Loader2, Check, Sparkles, ImagePlus, X } from 'lucide-react';
import { useData, useRecipes, showToast } from '../hooks/useData.js';
import { Button, IconButton, Tabs, Input, Toggle } from '../components/ui/kit.jsx';
import { importFromUrl, recipeFromAi, materializePhotos, parseImportFile, saveDrafts, normTitle } from '../db/importer.js';
import { fileToDataUrl } from '../db/photos.js';
import { undo, save } from '../db/repo.js';
import { learnedLinks } from '../db/recipes.js';

const txtArea = 'w-full rounded-md bg-bg-elevated border border-bg-border px-3 py-2.5 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand';
const firstUrl = (s) => String(s || '').match(/https?:\/\/[^\s]+/)?.[0] || '';

export default function RicettaImport() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const data = useData();
  const rec = useRecipes();
  const shared = firstUrl(params.get('url')) || firstUrl(params.get('text'));
  const sharedText = !shared ? [params.get('title'), params.get('text')].filter(Boolean).join('\n') : '';
  const [tab, setTab] = useState(sharedText ? 'text' : 'link');
  const [url, setUrl] = useState(shared);
  const [text, setText] = useState(sharedText);
  const [photos, setPhotos] = useState([]);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const auto = useRef(false);

  async function openDraft(draft, via) {
    setBusy('Scarico le foto…');
    const d = await materializePhotos(draft);
    nav('/ricette/nuova', { state: { draft: d, via } });
  }
  async function run(fn) {
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(null);
    }
  }
  const doLink = (u = url) =>
    run(async () => {
      setBusy('Leggo la pagina…');
      const { draft, via } = await importFromUrl(u.trim());
      await openDraft(draft, via);
    });
  const doText = () =>
    run(async () => {
      setBusy('L’AI legge il testo…');
      await openDraft(await recipeFromAi({ text }), 'AI da testo');
    });
  const doPhotos = () =>
    run(async () => {
      setBusy('L’AI legge le foto…');
      const images = await Promise.all(photos.map((f) => fileToDataUrl(f, 1600)));
      await openDraft(await recipeFromAi({ images }), 'AI da foto');
    });

  // Share target Android: link condiviso -> import immediato
  useEffect(() => {
    if (shared && !auto.current && data) {
      auto.current = true;
      doLink(shared);
    }
  }, [shared, data]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data || !rec) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <IconButton label="Indietro" onClick={() => nav('/ricette')}>
          <ArrowLeft size={18} />
        </IconButton>
        <h1 className="text-xl md:text-2xl font-bold">Importa ricette</h1>
      </div>

      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          setErr(null);
        }}
        tabs={[
          { value: 'link', label: 'Link' },
          { value: 'text', label: 'Testo' },
          { value: 'photo', label: 'Foto' },
          { value: 'file', label: 'File (tante)' },
        ]}
      />

      {err && <div className="rounded-md border border-negative/40 bg-negative/10 text-negative px-4 py-3 text-sm">{err}</div>}
      {busy && (
        <div className="flex items-center gap-2 rounded-md border border-bg-border bg-bg-surface px-4 py-3 text-sm">
          <Loader2 size={16} className="animate-spin text-brand" /> {busy}
        </div>
      )}

      {tab === 'link' && (
        <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
          <p className="text-sm text-text-secondary flex items-start gap-2">
            <Link2 size={16} className="mt-0.5 shrink-0" /> GialloZafferano e molti siti italiani: lettura diretta, senza AI. Altrimenti ci pensa l’AI. Più comodo: da Chrome o dall’app GZ → Condividi → My House.
          </p>
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://ricette.giallozafferano.it/…" />
          <div className="flex justify-end">
            <Button disabled={!firstUrl(url) || !!busy} onClick={() => doLink()}>Importa</Button>
          </div>
        </section>
      )}

      {tab === 'text' && (
        <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
          <p className="text-sm text-text-secondary flex items-start gap-2">
            <FileText size={16} className="mt-0.5 shrink-0" /> Incolla una ricetta (messaggio, email, appunti). L’AI la divide in ingredienti e passaggi; tu controlli prima di salvare.
          </p>
          <textarea rows={10} className={txtArea} value={text} onChange={(e) => setText(e.target.value)} placeholder="Titolo, ingredienti, procedimento…" />
          <div className="flex justify-end">
            <Button disabled={text.trim().length < 30 || !!busy} onClick={doText}>
              <Sparkles size={16} /> Estrai
            </Button>
          </div>
        </section>
      )}

      {tab === 'photo' && (
        <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
          <p className="text-sm text-text-secondary flex items-start gap-2">
            <Camera size={16} className="mt-0.5 shrink-0" /> Foto di libro o quaderno (fino a 4 pagine). Luce buona, pagina dritta.
          </p>
          <PhotoList files={photos} onChange={setPhotos} max={4} />
          <div className="flex justify-end">
            <Button disabled={!photos.length || !!busy} onClick={doPhotos}>
              <Sparkles size={16} /> Estrai
            </Button>
          </div>
        </section>
      )}

      {tab === 'file' && <BulkImport data={data} rec={rec} />}
    </div>
  );
}

export function PhotoList({ files, onChange, max = 4 }) {
  const cam = useRef();
  const gal = useRef();
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  const add = (list) => onChange([...files, ...Array.from(list || [])].slice(0, max));
  return (
    <div className="space-y-3">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {urls.map((u, i) => (
            <div key={u} className="relative">
              <img src={u} alt="" className="w-20 h-28 object-cover rounded-md border border-bg-border" />
              <button type="button" aria-label="Togli" onClick={() => onChange(files.filter((_, j) => j !== i))} className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-brand-accent text-white flex items-center justify-center">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {files.length < max && (
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => cam.current.click()}>
            <Camera size={16} /> Scatta
          </Button>
          <Button variant="ghost" onClick={() => gal.current.click()}>
            <ImagePlus size={16} /> Galleria
          </Button>
        </div>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      <input ref={gal} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
    </div>
  );
}

// Import multiplo da file JSON (export GZ o schema.org). Riprendibile: salta le ricette gia' presenti.
function BulkImport({ data, rec }) {
  const fileRef = useRef();
  const [drafts, setDrafts] = useState(null);
  const [sel, setSel] = useState(new Set());
  const [stepPhotos, setStepPhotos] = useState(true);
  const [progress, setProgress] = useState(null);
  const [err, setErr] = useState(null);

  const existing = useMemo(() => {
    const urls = new Set(rec.list.map((r) => r.source_url).filter(Boolean));
    const titles = new Set(rec.list.map((r) => normTitle(r.title)));
    return (d) => (d.source_url && urls.has(d.source_url)) || titles.has(normTitle(d.title));
  }, [rec]);

  // Ricette gia' presenti a cui mancano dati che il file ha (valori nutrizionali, portata).
  const updates = useMemo(() => {
    if (!drafts) return [];
    const byUrl = new Map(rec.list.filter((r) => r.source_url).map((r) => [r.source_url, r]));
    const byTitle = new Map(rec.list.map((r) => [normTitle(r.title), r]));
    const out = [];
    for (const d of drafts) {
      const r = (d.source_url && byUrl.get(d.source_url)) || byTitle.get(normTitle(d.title));
      if (!r) continue;
      const row = { id: r.id };
      if (!r.nutrition && d.nutrition) row.nutrition = d.nutrition;
      if (!r.course && d.course) row.course = d.course;
      if (Object.keys(row).length > 1) out.push({ table: 'recipes', row });
    }
    return out;
  }, [drafts, rec]);

  async function load(file) {
    setErr(null);
    try {
      const list = parseImportFile(JSON.parse(await file.text()));
      if (!list.length) throw new Error('Nessuna ricetta trovata nel file');
      setDrafts(list);
      setSel(new Set(list.map((d, i) => (existing(d) ? null : i)).filter((i) => i != null)));
    } catch (e) {
      setErr(`File non valido: ${e.message}`);
    } finally {
      fileRef.current.value = '';
    }
  }

  async function start() {
    const todo = drafts.map((d, i) => ({ d, i })).filter(({ i }) => sel.has(i));
    const totalPhotos = todo.reduce((s, { d }) => s + (d.photo_url ? 1 : 0) + (stepPhotos ? d.steps.filter((x) => x.photo_url).length : 0), 0);
    let done = 0;
    let photosDone = 0;
    setProgress({ done, total: todo.length, photosDone, totalPhotos });
    const batch = [];
    const flush = async () => {
      if (!batch.length) return;
      await saveDrafts(batch.splice(0), data.products, `Import ricette ${done}/${todo.length}`, learnedLinks(rec?.ings, data.products));
    };
    for (const { d, i } of todo) {
      const full = await materializePhotos(d, { steps: stepPhotos, onStep: () => setProgress((p) => ({ ...p, photosDone: ++photosDone })) });
      batch.push(full);
      done++;
      setProgress((p) => ({ ...p, done }));
      setSel((s) => {
        const n = new Set(s);
        n.delete(i);
        return n;
      });
      if (batch.length >= 10) await flush();
    }
    await flush();
    setProgress((p) => ({ ...p, finished: true }));
    showToast(`Importate ${todo.length} ricette`, { label: 'Annulla ultime', run: () => undo() });
  }

  const photoCount = drafts ? drafts.reduce((s, d, i) => s + (sel.has(i) ? (d.photo_url ? 1 : 0) + (stepPhotos ? d.steps.filter((x) => x.photo_url).length : 0) : 0), 0) : 0;

  return (
    <section className="rounded-lg border border-bg-border bg-bg-surface p-4 space-y-3">
      <p className="text-sm text-text-secondary flex items-start gap-2">
        <FileJson size={16} className="mt-0.5 shrink-0" /> File JSON con tante ricette (es. <code>data/gz-il-mio-ricettario.json</code>). Le ricette già presenti vengono saltate: se si interrompe, riparti dallo stesso file.
      </p>
      {err && <div className="text-negative text-sm">{err}</div>}
      {!drafts ? (
        <Button variant="ghost" onClick={() => fileRef.current.click()}>
          <FileJson size={16} /> Scegli file
        </Button>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              {drafts.length} ricette nel file · <b>{sel.size}</b> selezionate · {photoCount} foto
            </span>
            <div className="flex gap-3">
              <button type="button" className="text-brand font-semibold" onClick={() => setSel(new Set(drafts.map((_, i) => i).filter((i) => !existing(drafts[i]))))}>Tutte nuove</button>
              <button type="button" className="text-text-secondary" onClick={() => setSel(new Set())}>Nessuna</button>
            </div>
          </div>
          {updates.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-sm">
              <span>{updates.length} ricette già presenti senza valori nutrizionali o portata.</span>
              <Button variant="ghost" onClick={async () => { await save(updates, `Aggiornate ${updates.length} ricette dal file`); showToast(`Aggiornate ${updates.length} ricette`, { label: 'Annulla', run: () => undo() }); }}>Aggiorna</Button>
            </div>
          )}
          <Toggle checked={stepPhotos} onChange={setStepPhotos} label="Anche le foto dei passaggi" />
          <ul className="max-h-[50vh] overflow-y-auto rounded-md border border-bg-border divide-y divide-bg-border">
            {drafts.map((d, i) => {
              const dup = existing(d);
              return (
                <li key={i}>
                  <label className="flex items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-[rgb(var(--brand-primary))]"
                      checked={sel.has(i)}
                      disabled={!!progress && !progress.finished}
                      onChange={(e) =>
                        setSel((s) => {
                          const n = new Set(s);
                          e.target.checked ? n.add(i) : n.delete(i);
                          return n;
                        })
                      }
                    />
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{d.title}</span>
                      <span className="text-xs text-text-muted">
                        {d.ingredients.length} ingr. · {d.steps.length} passaggi{dup ? ' · già presente' : ''}
                      </span>
                    </span>
                    {dup && <Check size={16} className="text-positive shrink-0" />}
                  </label>
                </li>
              );
            })}
          </ul>
          {progress && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-bg-elevated overflow-hidden">
                <div className="h-full bg-brand transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }} />
              </div>
              <p className="text-xs text-text-muted">
                {progress.finished ? 'Finito. ' : ''}
                {progress.done}/{progress.total} ricette · foto {progress.photosDone}/{progress.totalPhotos}
              </p>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={!!progress && !progress.finished} onClick={() => { setDrafts(null); setProgress(null); }}>Cambia file</Button>
            <Button disabled={!sel.size || (progress && !progress.finished)} onClick={start}>Importa {sel.size}</Button>
          </div>
        </>
      )}
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files[0] && load(e.target.files[0])} />
    </section>
  );
}
