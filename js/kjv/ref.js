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

// Forgiving book names: 'Gen', 'gen.', 'GEN', '1 John', '1John', '1st John', 'I John', 'First John', 'Ps', 'Psalms',
// 'Song of Songs', 'Phil' (Philippians), 'Philem' (Philemon). Any unique start of a book name works too ('Deut', 'Rev').
const EXTRA_ALIASES = {
  GEN: 'gn ge', EXO: 'ex exod', LEV: 'lv le', NUM: 'nm nu', DEU: 'dt deut', JOS: 'josh jsh', JDG: 'jdg jg judg', RUT: 'rth ru',
  '1SA': '1 sam 1 sm', '2SA': '2 sam 2 sm', '1KI': '1 kgs 1 kin', '2KI': '2 kgs 2 kin', '1CH': '1 chr 1 chron', '2CH': '2 chr 2 chron',
  PSA: 'ps psa pss psalm psalms', PRO: 'prov prv pr', ECC: 'eccl eccles qoh', SNG: 'song sos cant song of songs canticles',
  ISA: 'is isa', JER: 'jer jr', LAM: 'lam la', EZK: 'ezek eze ezk', DAN: 'dn da', HOS: 'hos ho', JOL: 'jl', AMO: 'am amos',
  OBA: 'ob obad', JON: 'jnh jon', MIC: 'mic mi', NAM: 'nah na', HAB: 'hab hb', ZEP: 'zeph zp', HAG: 'hag hg', ZEC: 'zech zc', MAL: 'mal ml',
  MAT: 'mt matt mat', MRK: 'mk mr mar mrk', LUK: 'lk lu luk', JHN: 'jn jhn joh', ACT: 'ac acts', ROM: 'rm ro rom',
  '1CO': '1 cor', '2CO': '2 cor', GAL: 'ga gal', EPH: 'eph ephes', PHP: 'phil php pp', COL: 'col', '1TH': '1 thess 1 th', '2TH': '2 thess 2 th',
  '1TI': '1 tim 1 tm', '2TI': '2 tim 2 tm', TIT: 'tit ti', PHM: 'philem phm pm', HEB: 'heb', JAS: 'jas jm', '1PE': '1 pet 1 pt', '2PE': '2 pet 2 pt',
  '1JN': '1 jn 1 jhn 1 joh', '2JN': '2 jn 2 jhn 2 joh', '3JN': '3 jn 3 jhn 3 joh', JUD: 'jud jude', REV: 'rev re rv revelations revelation of john apocalypse',
};
/** Book key: lower case, no dots, '1st'/'i'/'first' -> '1', '1john' -> '1 john'. */
function bookKey(name) {
  let k = norm(name);
  k = k.replace(/^(first|1st|i)\s+/, '1 ').replace(/^(second|2nd|ii)\s+/, '2 ').replace(/^(third|3rd|iii)\s+/, '3 ');
  k = k.replace(/^([1-3])\s*(?=[a-z])/, '$1 ');
  return k;
}
for (const [code, list] of Object.entries(EXTRA_ALIASES)) {
  const b = byCode.get(code); const words = list.split(' '); const out = [];
  for (let i = 0; i < words.length; i++) { // '1 sam' style pairs: a lone digit joins the next word
    if (/^[1-3]$/.test(words[i]) && words[i + 1]) { out.push(words[i] + ' ' + words[i + 1]); i++; } else out.push(words[i]);
  }
  // multi-word aliases such as 'song of songs' were split above: put the known phrases back
  if (code === 'SNG') out.push('song of songs'); if (code === 'REV') out.push('revelation of john');
  for (const a of out) if (!alias.has(bookKey(a))) alias.set(bookKey(a), b);
}
const allKeys = BOOKS.map(b => ({ b, keys: [bookKey(b.name), bookKey(b.refBook), bookKey(b.code)] }));

export function findBook(name) {
  const k = bookKey(name);
  if (!k) return null;
  const hit = alias.get(k) || alias.get(norm(name)); if (hit) return hit;
  // unique start of a book name, at least 2 letters ('deut', 'rev', '1 thes')
  const letters = k.replace(/[^a-z]/g, '');
  if (letters.length < 2) return null;
  const found = new Set();
  for (const { b, keys } of allKeys) if (keys.some(x => x.startsWith(k))) found.add(b);
  return found.size === 1 ? [...found][0] : null;
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
 * Parse a passage. Forgiving: spaces, a colon or a dot between chapter and verse, abbreviations, numbered books.
 *   'Genesis 3:14-19', 'Genesis 3 14-19', 'gen 3.14-19', 'Gen 1:1', 'Genesis 1 1', '1 John 2 3', '1John 2:3-5',
 *   'Genesis 3:14–19', 'Genesis 1:24-2:3', 'Genesis 1 24 - 2 3', 'Genesis 3' (whole chapter), 'Ps 23',
 *   'Jude 3' (one-chapter books: the number is the verse), and the stem form 'Genesis 3-14 to 3-19'.
 * Returns { code, start:{chapter,verse}, end:{chapter,verse} } or throws with a plain message.
 */
export function parsePassage(input) {
  let s = String(input ?? '').replace(/[\u2013\u2014\u2212]/g, '-').replace(/\+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('Type a passage, for example Genesis 3:14-19');
  // split the book from the numbers: the book may start with 1-3 ('1 John', '1John') and may contain dots or spaces
  const m0 = /^((?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\s*[A-Za-z][A-Za-z .']*?)\.?\s*(\d.*)?$/i.exec(s);
  if (!m0) throw new Error(`Cannot read passage "${input}"`);
  const book = findBook(m0[1]);
  if (!book) throw new Error(`Unknown book in "${input}". Try a name such as Genesis, Gen, Psalm or 1 John`);
  let nums = (m0[2] || '').trim();
  if (!nums) throw new Error(`Add a chapter to "${input}", for example ${book.refBook} 1`);
  const single = book.counts.length === 1;
  let c1, v1, c2, v2;
  const stem = /^(\d+)-(\d+) to (\d+)-(\d+)$/i.exec(nums);
  if (stem) { c1 = +stem[1]; v1 = +stem[2]; c2 = +stem[3]; v2 = +stem[4]; }
  else {
    nums = nums.replace(/(\d)\s*[.:]\s*(\d)/g, '$1:$2').replace(/\s*-\s*/g, '-').replace(/(\d+) (\d+)/g, '$1:$2');
    const m = /^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(nums);
    if (!m) throw new Error(`Cannot read the numbers in "${input}". Write it like ${book.refBook} 3:14-19`);
    if (single && m[2] === undefined && m[1] === '1' && m[3] === undefined) { c1 = c2 = 1; v1 = 1; v2 = book.counts[0]; } // 'Jude 1': the whole book
    else if (single && m[2] === undefined) { // 'Jude 3', 'Jude 3-5': verses of chapter 1
      c1 = c2 = 1; v1 = +m[1]; v2 = m[3] !== undefined && m[4] === undefined ? +m[3] : v1;
      if (m[4] !== undefined) throw new Error(`Cannot read passage "${input}"`);
    } else if (m[2] === undefined) { // 'Genesis 3' (whole chapter); 'Genesis 3-4' is ambiguous -> reject
      if (m[3] !== undefined) throw new Error(`Ambiguous passage "${input}": use ${book.refBook} ${m[1]}:1-${m[3]}:${verseCount(book.code, +m[3]) || 1} or ${book.refBook} ${m[1]}:${m[3]}`);
      c1 = c2 = +m[1]; v1 = 1; v2 = verseCount(book.code, c1);
    } else {
      c1 = +m[1]; v1 = +m[2];
      if (m[3] === undefined) { c2 = c1; v2 = v1; }
      else if (m[4] === undefined) { c2 = c1; v2 = +m[3]; }
      else { c2 = +m[3]; v2 = +m[4]; }
    }
  }
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
