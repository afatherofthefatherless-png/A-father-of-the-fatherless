// Verse designations, passages and file names. Pure functions, no DOM, no verse text.
//   id        'GEN.3.14'          (book code . chapter . verse)
//   ref       'Genesis 3:14'      ('Psalm 23:1' for PSA)
//   stem      'Genesis 3-14'      (ref with ':' -> '-')
//   file name 'Genesis 3-14.wav'
//   passage   'Genesis 3:14-19', 'Genesis 1:24-2:3', 'Psalm 23:1-6'
import { BOOKS, TOTAL_VERSES } from './books.js';

const byCode = new Map(BOOKS.map(b => [b.code, b]));
const byRefBook = new Map(BOOKS.map(b => [b.refBook, b]));
const norm = s => String(s).toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
const alias = new Map();
for (const b of BOOKS) {
  for (const k of [b.code, b.name, b.refBook]) alias.set(norm(k), b);
}
alias.set('ps', byCode.get('PSA')); alias.set('psa', byCode.get('PSA'));
alias.set('song of songs', byCode.get('SNG')); alias.set('canticles', byCode.get('SNG'));

// global offsets: 0-based global verse index, same as the old tracker's gi()
const chapterOffset = new Map(); // code -> array of global index of verse 1 of each chapter
{
  let g = 0;
  for (const b of BOOKS) {
    const arr = [];
    for (const n of b.counts) { arr.push(g); g += n; }
    chapterOffset.set(b.code, arr);
  }
}

export function findBook(name) {
  const b = alias.get(norm(name));
  return b || null;
}
export function bookByCode(code) { return byCode.get(code) || null; }
export function verseCount(code, chapter) {
  const b = byCode.get(code); if (!b) return 0;
  return b.counts[chapter - 1] || 0;
}
export function isValid(code, chapter, verse) {
  return Number.isInteger(chapter) && Number.isInteger(verse) && verse >= 1 && verse <= verseCount(code, chapter);
}

export function makeId(code, chapter, verse) {
  if (!isValid(code, chapter, verse)) throw new Error(`No such verse: ${code} ${chapter}:${verse}`);
  return `${code}.${chapter}.${verse}`;
}
export function parseId(id) {
  const m = /^([1-3]?[A-Z]{2,3})\.(\d+)\.(\d+)$/.exec(String(id));
  if (!m) return null;
  const code = m[1], chapter = +m[2], verse = +m[3];
  return isValid(code, chapter, verse) ? { code, chapter, verse } : null;
}
function must(id) { const p = parseId(id); if (!p) throw new Error(`Bad verse id: ${id}`); return p; }

export function refOf(id) { const p = must(id); return `${byCode.get(p.code).refBook} ${p.chapter}:${p.verse}`; }
export function stemOf(id) { const p = must(id); return `${byCode.get(p.code).refBook} ${p.chapter}-${p.verse}`; }
export function fileNameOf(id) { return stemOf(id) + '.wav'; }

/** Reverse of fileNameOf. Strict: only canonical names ('Genesis 3-14.wav'); returns id or null. */
export function parseFileName(name) {
  const m = /^(.+) (\d+)-(\d+)\.wav$/.exec(String(name));
  if (!m) return null;
  const b = byRefBook.get(m[1]);
  if (!b) return null;
  const ch = +m[2], v = +m[3];
  if (String(ch) !== m[2] || String(v) !== m[3]) return null; // no leading zeros
  return isValid(b.code, ch, v) ? `${b.code}.${ch}.${v}` : null;
}

/** Kept-old-take name: 'Genesis 3-14 take 2 20261103-094012.wav' (never parses as a canonical verse file). */
export function takeFileNameOf(id, takeNo, date = new Date()) {
  const p2 = n => String(n).padStart(2, '0');
  const ts = `${date.getFullYear()}${p2(date.getMonth() + 1)}${p2(date.getDate())}-${p2(date.getHours())}${p2(date.getMinutes())}${p2(date.getSeconds())}`;
  return `${stemOf(id)} take ${takeNo} ${ts}.wav`;
}

/** Drive folder path for a verse: ['KJV Recordings', '01 Genesis', 'Genesis 3']. */
export function folderPathOf(id, root = 'KJV Recordings') {
  const p = must(id); const b = byCode.get(p.code);
  return [root, `${String(b.num).padStart(2, '0')} ${b.name}`, `${b.refBook} ${p.chapter}`];
}

export function globalIndexOf(id) { const p = must(id); return chapterOffset.get(p.code)[p.chapter - 1] + p.verse - 1; }
export function idFromGlobalIndex(g) {
  if (!Number.isInteger(g) || g < 0 || g >= TOTAL_VERSES) return null;
  for (const b of BOOKS) {
    const offs = chapterOffset.get(b.code);
    const last = offs[offs.length - 1] + b.counts[b.counts.length - 1];
    if (g < last) {
      let c = offs.length - 1; while (offs[c] > g) c--;
      return `${b.code}.${c + 1}.${g - offs[c] + 1}`;
    }
  }
  return null;
}

/**
 * Parse a passage. Accepts:
 *   'Genesis 3:14-19', 'Genesis 3:14–19', 'Genesis 1:24-2:3', 'Genesis 3:14', 'Genesis 3' (whole chapter),
 *   'Psalms 23:1-6', 'Ps 23', and the stem form 'Genesis 3-14 to 3-19' / 'Genesis 1-24 to 2-3'.
 * Returns { code, start:{chapter,verse}, end:{chapter,verse} } or throws.
 */
export function parsePassage(input) {
  const s = String(input).replace(/[\u2013\u2014]/g, '-').replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
  let m = /^(.+?) (\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(s);
  let stemForm = /^(.+?) (\d+)-(\d+)(?: to (\d+)-(\d+))?$/.exec(s);
  let book, c1, v1, c2, v2;
  if (stemForm && /\bto\b/.test(s)) {
    book = findBook(stemForm[1]); c1 = +stemForm[2]; v1 = +stemForm[3]; c2 = +stemForm[4]; v2 = +stemForm[5];
  } else if (m) {
    book = findBook(m[1]);
    c1 = +m[2];
    if (m[3] === undefined) { // 'Genesis 3' (whole chapter); 'Genesis 3-4' is ambiguous -> reject
      if (m[4] !== undefined) throw new Error(`Ambiguous passage "${input}": use Genesis 3:1-4:26 or Genesis 3:4`);
      if (!book) throw new Error(`Unknown book in "${input}"`);
      v1 = 1; c2 = c1; v2 = verseCount(book.code, c1);
    } else {
      v1 = +m[3];
      if (m[4] === undefined) { c2 = c1; v2 = v1; }
      else if (m[5] === undefined) { c2 = c1; v2 = +m[4]; }
      else { c2 = +m[4]; v2 = +m[5]; }
    }
  } else throw new Error(`Cannot read passage "${input}"`);
  if (!book) throw new Error(`Unknown book in "${input}"`);
  if (!isValid(book.code, c1, v1) || !isValid(book.code, c2, v2)) throw new Error(`No such verse in "${input}"`);
  if (c2 < c1 || (c2 === c1 && v2 < v1)) throw new Error(`Passage runs backwards: "${input}"`);
  return { code: book.code, start: { chapter: c1, verse: v1 }, end: { chapter: c2, verse: v2 } };
}

function asPassage(p) { return typeof p === 'string' ? parsePassage(p) : p; }

/** Canonical label, same rules as the tracker's canon(): 'Genesis 3:14-19', 'Genesis 1:24-2:3', 'Psalm 23:1-6'. */
export function formatPassage(p) {
  p = asPassage(p); const name = byCode.get(p.code).refBook; const { start: a, end: b } = p;
  if (a.chapter === b.chapter && a.verse === b.verse) return `${name} ${a.chapter}:${a.verse}`;
  if (a.chapter === b.chapter) return `${name} ${a.chapter}:${a.verse}-${b.verse}`;
  return `${name} ${a.chapter}:${a.verse}-${b.chapter}:${b.verse}`;
}

/** File stem for a stitched passage: 'Genesis 3-14 to 3-19', 'Genesis 1-24 to 2-3'; single verse = verse stem. */
export function passageStem(p) {
  p = asPassage(p); const name = byCode.get(p.code).refBook; const { start: a, end: b } = p;
  if (a.chapter === b.chapter && a.verse === b.verse) return `${name} ${a.chapter}-${a.verse}`;
  return `${name} ${a.chapter}-${a.verse} to ${b.chapter}-${b.verse}`;
}

/** All verse ids in the passage, in canonical order. */
export function expandPassage(p) {
  p = asPassage(p); const out = [];
  for (let c = p.start.chapter; c <= p.end.chapter; c++) {
    const from = c === p.start.chapter ? p.start.verse : 1;
    const to = c === p.end.chapter ? p.end.verse : verseCount(p.code, c);
    for (let v = from; v <= to; v++) out.push(`${p.code}.${c}.${v}`);
  }
  return out;
}

/** Sort verse ids canonically. */
export function compareIds(a, b) { return globalIndexOf(a) - globalIndexOf(b); }
