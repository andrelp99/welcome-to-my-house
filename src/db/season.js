// Frutta e verdura di stagione in Italia, mese per mese (indicativo, Nord Italia).

const S = {
  1: 'arance, mandarini, clementine, kiwi, mele, pere, pompelmi, limoni | broccoli, cavolfiore, cavolo nero, verza, cavoletti di bruxelles, carciofi, cardi, finocchi, porri, radicchio, sedano, spinaci, zucca, cime di rapa, catalogna, topinambur, bietole, carote',
  2: 'arance, mandarini, clementine, kiwi, mele, pere, pompelmi, limoni | broccoli, cavolfiore, cavolo nero, verza, cavoletti di bruxelles, carciofi, finocchi, porri, radicchio, sedano, spinaci, cime di rapa, bietole, carote, topinambur',
  3: 'arance, kiwi, limoni, mele, pere | asparagi, carciofi, bietole, broccoli, cavolfiore, cipollotti, finocchi, lattuga, porri, radicchio, rucola, spinaci, carote',
  4: 'arance, kiwi, limoni, mele, fragole | asparagi, carciofi, piselli, fave, lattuga, rucola, spinaci, ravanelli, cipollotti, bietole, carote',
  5: 'fragole, ciliegie, nespole, limoni | asparagi, piselli, fave, zucchine, lattuga, rucola, ravanelli, fagiolini, carote, cetrioli, carciofi, cipollotti',
  6: 'albicocche, ciliegie, fragole, pesche, susine, melone, anguria, nespole | zucchine, fagiolini, pomodori, melanzane, peperoni, cetrioli, lattuga, rucola, basilico, fiori di zucca, patate, carote',
  7: 'albicocche, pesche, susine, melone, anguria, fichi, more, mirtilli, lamponi | pomodori, melanzane, peperoni, zucchine, fagiolini, cetrioli, basilico, lattuga, fiori di zucca, patate, mais',
  8: 'pesche, susine, melone, anguria, fichi, uva, more, mirtilli, lamponi, pere | pomodori, melanzane, peperoni, zucchine, fagiolini, cetrioli, basilico, patate, mais',
  9: 'uva, fichi, pere, mele, susine, pesche, melograno | pomodori, melanzane, peperoni, zucchine, fagiolini, funghi, zucca, porri, spinaci, bietole, broccoli',
  10: 'uva, mele, pere, cachi, melograno, castagne, kiwi, noci | zucca, funghi, broccoli, cavolfiore, verza, porri, radicchio, spinaci, finocchi, bietole, carote, sedano, cime di rapa',
  11: 'mele, pere, cachi, kiwi, mandarini, clementine, arance, melograno, castagne, noci | zucca, broccoli, cavolfiore, cavolo nero, verza, cavoletti di bruxelles, carciofi, cardi, finocchi, porri, radicchio, spinaci, cime di rapa, topinambur',
  12: 'arance, mandarini, clementine, kiwi, mele, pere, cachi, pompelmi, limoni | broccoli, cavolfiore, cavolo nero, verza, cavoletti di bruxelles, carciofi, cardi, finocchi, porri, radicchio, spinaci, zucca, cime di rapa, catalogna',
};

export const SEASON = Object.fromEntries(
  Object.entries(S).map(([m, v]) => {
    const [fruit, veg] = v.split('|').map((x) => x.split(',').map((s) => s.trim()).filter(Boolean));
    return [m, { fruit, veg }];
  })
);

const STOP = new Set(['di', 'd', 'del', 'della', 'dei', 'delle', 'la', 'il', 'le', 'i', 'e']);
const tok = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z ]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .map((w) => (w.length > 3 ? w.replace(/[aeio]$/, '') : w));

const ALL = [...new Set(Object.values(SEASON).flatMap((x) => [...x.fruit, ...x.veg]))].map((name) => ({ name, t: tok(name) }));
// Ingredienti conservati: non contano per la stagione
const PRESERVED = /passat|pelat|concentrat|polpa|secch|essiccat|surgel|scatol|sciropp|marmellat|confettur|succo|conserv|sott.?olio|sottaceto|in polvere|scorza|buccia/i;

export const monthName = (m) => ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'][m - 1];

function produceOf(text) {
  if (PRESERVED.test(text)) return null;
  const set = new Set(tok(text));
  // il nome piu' specifico vince ("cavolo nero" prima di "cavolo")
  let best = null;
  for (const p of ALL) if (p.t.every((w) => set.has(w)) && (!best || p.t.length > best.t.length)) best = p;
  return best?.name || null;
}

// { inSeason: [...], outSeason: [...] } per gli ingredienti di una ricetta
export function recipeSeason(ings, month = new Date().getMonth() + 1) {
  const now = new Set([...SEASON[month].fruit, ...SEASON[month].veg]);
  const inSeason = new Set();
  const outSeason = new Set();
  for (const i of ings) {
    const p = produceOf(i.text);
    if (!p) continue;
    (now.has(p) ? inSeason : outSeason).add(p);
  }
  return { inSeason: [...inSeason], outSeason: [...outSeason], seasonal: inSeason.size > 0 && outSeason.size === 0 };
}
