// Cross-references: parse the openbible.info file (CC-BY), rank by votes, map to CrossWire KJV verse ids.
// File format (tab separated, first line is a header):  From Verse <TAB> To Verse <TAB> Votes
//   Gen.1.1   John.1.1-John.1.3   384        (OSIS-style book abbreviations; "To" may be a range)
// No verse text is in this file or in this module: only references and vote counts.
import { BOOKS, TOTAL_VERSES } from '../kjv/books.js';
import { globalIndexOf, idFromGlobalIndex, refOf, isValid } from '../kjv/ref.js';

// OSIS abbreviations in KJV book order (same order as BOOKS / CrossWire).
export const OSIS = 'Gen Exod Lev Num Deut Josh Judg Ruth 1Sam 2Sam 1Kgs 2Kgs 1Chr 2Chr Ezra Neh Esth Job Ps Prov Eccl Song Isa Jer Lam Ezek Dan Hos Joel Amos Obad Jonah Mic Nah Hab Zeph Hag Zech Mal Matt Mark Luke John Acts Rom 1Cor 2Cor Gal Eph Phil Col 1Thess 2Thess 1Tim 2Tim Titus Phlm Heb Jas 1Pet 2Pet 1John 2John 3John Jude Rev'.split(' ');
const osisToCode = new Map(OSIS.map((o, i) => [o, BOOKS[i].code]));
export const FILE_ROWS = 344799;  // data rows in openbible.info cross_references.txt (2026-10-26); fallback max
export const TOP_PICK = 1000;      // "select from top 1000 links"

/** 'Gen.1.1' -> 'GEN.1.1' (CrossWire id), or null if the book/chapter/verse is not a KJV verse. */
export function osisToId(s) {
  const m = /^([1-3]?[A-Za-z]+)\.(\d+)\.(\d+)$/.exec(String(s).trim());
  if (!m) return null;
  const code = osisToCode.get(m[1]); if (!code) return null;
  let c = +m[2], v = +m[3];
  // Versification: OpenBible splits 3 John 1:14 into 14-15; CrossWire KJV has 14 verses (1:15 is part of 1:14).
  if (code === '3JN' && c === 1 && v === 15) v = 14;
  return isValid(code, c, v) ? `${code}.${c}.${v}` : null;
}

/** Book groups for the ruler (Law, History, Poetry, Major/Minor prophets, Gospels+Acts, Epistles, Revelation). */
export const GROUPS = [
  { name: 'Law', from: 0, to: 4, color: '#facc15' }, { name: 'History', from: 5, to: 16, color: '#fb923c' },
  { name: 'Poetry', from: 17, to: 21, color: '#22c55e' }, { name: 'Major prophets', from: 22, to: 26, color: '#38bdf8' },
  { name: 'Minor prophets', from: 27, to: 38, color: '#818cf8' }, { name: 'Gospels and Acts', from: 39, to: 43, color: '#f472b6' },
  { name: 'Letters', from: 44, to: 64, color: '#ef4444' }, { name: 'Revelation', from: 65, to: 65, color: '#e5e5e5' },
];
export function groupOfBook(i) { return GROUPS.findIndex(g => i >= g.from && i <= g.to); }

// Global index of the first verse of each book (for the ruler and book lookup).
export const BOOK_START = (() => { const a = []; let g = 0; for (const b of BOOKS) { a.push(g); g += b.counts.reduce((x, y) => x + y, 0); } a.push(g); return a; })();
export function bookIndexAt(g) { let lo = 0, hi = BOOKS.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (BOOK_START[m] <= g) lo = m; else hi = m - 1; } return lo; }

/**
 * Parses the file text into a ranked set (highest votes first; ties keep file order).
 * Returns { total, skipped, header, from, to, toEnd, votes, order } where from/to/toEnd are Int32Array global verse
 * indexes (0..31,101) and votes an Int32Array; all already sorted by rank (index 0 = rank 1).
 * Lines whose verses are not KJV verses are counted in skipped (with up to 5 examples in skippedExamples).
 */
export function parseRefs(text) {
  if (typeof text !== 'string') throw new Error('Cross-references file could not be read.');
  const lines = text.split(/\r?\n/);
  const header = lines[0] || '';
  if (!/^From Verse\tTo Verse\tVotes/.test(header)) throw new Error('This does not look like the cross-references file (expected a "From Verse, To Verse, Votes" header).');
  const n = lines.length;
  const F = new Int32Array(n), T = new Int32Array(n), E = new Int32Array(n), V = new Int32Array(n);
  let k = 0, skipped = 0; const skippedExamples = [];
  const cache = new Map();
  const gi = s => { let r = cache.get(s); if (r === undefined) { const id = osisToId(s); r = id ? globalIndexOf(id) : -1; cache.set(s, r); } return r; };
  for (let i = 1; i < n; i++) {
    const line = lines[i]; if (!line) continue;
    const t1 = line.indexOf('\t'), t2 = line.indexOf('\t', t1 + 1);
    if (t1 < 0 || t2 < 0) { skipped++; continue; }
    const fromS = line.slice(0, t1), toS = line.slice(t1 + 1, t2), votes = parseInt(line.slice(t2 + 1), 10);
    const dash = toS.indexOf('-');
    const f = gi(fromS), t = gi(dash < 0 ? toS : toS.slice(0, dash)), e = dash < 0 ? t : gi(toS.slice(dash + 1));
    if (f < 0 || t < 0 || e < 0 || !Number.isFinite(votes)) { skipped++; if (skippedExamples.length < 5) skippedExamples.push(line); continue; }
    F[k] = f; T[k] = t; E[k] = Math.max(t, e); V[k] = votes; k++;
  }
  if (!k) throw new Error('The cross-references file has no usable lines.');
  // Stable rank: votes descending, then file order.
  const order = new Uint32Array(k); for (let i = 0; i < k; i++) order[i] = i;
  order.sort((a, b) => (V[b] - V[a]) || (a - b));
  const from = new Int32Array(k), to = new Int32Array(k), toEnd = new Int32Array(k), votes = new Int32Array(k);
  for (let r = 0; r < k; r++) { const i = order[r]; from[r] = F[i]; to[r] = T[i]; toEnd[r] = E[i]; votes[r] = V[i]; }
  return { total: k, skipped, skippedExamples, header, from, to, toEnd, votes };
}

// Vote-threshold slider (Robin, 4 Nov): each step is a minimum vote count; null = all references.
export const THRESHOLDS = Object.freeze([null, 5, 10, 20, 50, 100]);
export const DRAW_CAP = 60000;   // never draw more arcs than this at once (top-voted first)
/** Number of ranked refs with votes >= min (votes are sorted descending, so a binary search). null = all. */
export function countAtLeast(set, min) {
  if (!set) return 0; if (min == null) return set.total;
  let lo = 0, hi = set.total; while (lo < hi) { const m = (lo + hi) >> 1; if (set.votes[m] >= min) lo = m + 1; else hi = m; } return lo;
}
/** Slider step (0..THRESHOLDS.length-1) -> { min, count, drawn, capped } computed from the loaded file. */
export function stepInfo(set, step) {
  const i = Math.max(0, Math.min(THRESHOLDS.length - 1, Math.round(Number(step) || 0)));
  const min = THRESHOLDS[i], count = countAtLeast(set, min), drawn = Math.min(count, DRAW_CAP);
  return { step: i, min, count, drawn, capped: drawn < count };
}
export function stepLabel(info, total) {
  const base = info.min == null ? `Showing all ${fmt(info.count)} refs` : `Showing ${fmt(info.count)} refs (at least ${info.min} votes)`;
  return info.capped ? `${base}, drawing the top ${fmt(info.drawn)} of ${fmt(info.count)}` : base;
}
export const fmt = n => Number(n).toLocaleString('en-GB');

/** One link (by rank, 0-based) as plain references and verse ids. */
export function linkAt(set, rank) {
  if (!set || rank < 0 || rank >= set.total) return null;
  const fromId = idFromGlobalIndex(set.from[rank]), toId = idFromGlobalIndex(set.to[rank]), endId = idFromGlobalIndex(set.toEnd[rank]);
  const toIds = []; for (let g = set.to[rank]; g <= set.toEnd[rank] && toIds.length < 40; g++) toIds.push(idFromGlobalIndex(g));
  return { rank, fromId, toId, endId, toIds, votes: set.votes[rank], fromRef: refOf(fromId), toRef: rangeRef(toId, endId) };
}
export function rangeRef(a, b) {
  if (a === b) return refOf(a);
  const [ra, rb] = [refOf(a), refOf(b)];
  const [ba, ca] = [ra.slice(0, ra.lastIndexOf(' ')), ra.slice(ra.lastIndexOf(' ') + 1).split(':')[0]];
  const [bb, cb] = [rb.slice(0, rb.lastIndexOf(' ')), rb.slice(rb.lastIndexOf(' ') + 1).split(':')];
  if (ba !== bb) return `${ra} - ${rb}`;
  return ca === cb[0] ? `${ra}-${cb[1]}` : `${ra}-${cb[0]}:${cb[1]}`;
}
/** Pick one of the top 1000 (or fewer) links; rnd in [0,1). */
export function pickTop(set, rnd = Math.random()) { const n = Math.min(TOP_PICK, set.total); return Math.min(n - 1, Math.floor(rnd * n)); }
/** Best-ranked link that starts (or lands) in a book, among the first `limit` ranks. */
export function topInBook(set, bookIdx, limit = set.total) {
  const a = BOOK_START[bookIdx], b = BOOK_START[bookIdx + 1];
  for (let r = 0; r < Math.min(limit, set.total); r++) { const f = set.from[r], t = set.to[r]; if ((f >= a && f < b) || (t >= a && t < b)) return r; }
  return -1;
}

// ---------- Geometry (shared by drawing, hit-testing and the animated dots) ----------
// Each link is a half ellipse on the right of the ruler: centre at the ruler (x0), between the two verses' y.
export function arcOf(set, r, L) {
  const y1 = L.y(set.from[r]), y2 = L.y((set.to[r] + set.toEnd[r]) / 2);
  const cy = (y1 + y2) / 2, ry = Math.max(0.5, Math.abs(y2 - y1) / 2);
  const rx = Math.max(2, L.maxW * Math.sqrt(ry * 2 / L.h));
  return { x0: L.x0, cy, rx, ry, down: y2 >= y1 };
}
/** Point at t in [0,1] along the arc, from the "from" verse to the "to" verse. */
export function pointOn(a, t) {
  const th = (a.down ? -1 : 1) * (Math.PI / 2) * (1 - 2 * t); // -pi/2 = top end
  return { x: a.x0 + a.rx * Math.cos(th), y: a.cy + a.ry * Math.sin(th) };
}
/** Distance (px) from (x,y) to an arc, by radial projection onto the half ellipse. */
export function arcDist(a, x, y) {
  const nx = (x - a.x0) / a.rx, ny = (y - a.cy) / a.ry;
  let th = Math.atan2(ny, nx); if (th > Math.PI / 2) th = Math.PI / 2; if (th < -Math.PI / 2) th = -Math.PI / 2;
  return Math.hypot(x - (a.x0 + a.rx * Math.cos(th)), y - (a.cy + a.ry * Math.sin(th)));
}
/** Brute-force nearest arc among the first n ranks within tol px (-1 if none). Ties go to the higher rank. */
export function hitTest(set, n, L, x, y, tol = 8) {
  let best = -1, bestD = tol;
  for (let r = 0; r < n; r++) { const a = arcOf(set, r, L); if (Math.abs(y - a.cy) > a.ry + tol || x > a.x0 + a.rx + tol || x < a.x0 - tol) continue; const d = arcDist(a, x, y); if (d < bestD) { bestD = d; best = r; } }
  return best;
}
/** Grid spatial index over the first n arcs: each arc is sampled along its length into CELL px cells. */
export class ArcIndex {
  constructor(set, n, L, cell = 20) {
    this.set = set; this.n = n; this.L = L; this.cell = cell; this.cols = Math.ceil((L.x0 + L.maxW + 20) / cell) + 1; this.grid = new Map();
    for (let r = 0; r < n; r++) {
      const a = arcOf(set, r, L), len = Math.PI * Math.sqrt((a.rx * a.rx + a.ry * a.ry) / 2), k = Math.max(4, Math.min(400, Math.ceil(len / (cell / 2))));
      let last = -1;
      for (let i = 0; i <= k; i++) { const p = pointOn(a, i / k), key = this.key(p.x, p.y); if (key === last) continue; last = key; let c = this.grid.get(key); if (!c) this.grid.set(key, c = []); if (c[c.length - 1] !== r) c.push(r); }
    }
  }
  key(x, y) { return Math.floor(y / this.cell) * this.cols + Math.floor(Math.max(0, x) / this.cell); }
  /** Nearest arc within tol px (tol <= cell), -1 if none. Same answer as hitTest. */
  nearest(x, y, tol = 8) {
    const cx = Math.floor(Math.max(0, x) / this.cell), cy = Math.floor(y / this.cell), seen = new Set();
    let best = -1, bestD = tol;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (cx + i < 0) continue; const c = this.grid.get((cy + j) * this.cols + cx + i); if (!c) continue;
      for (const r of c) { if (seen.has(r)) continue; seen.add(r); const d = arcDist(arcOf(this.set, r, this.L), x, y); if (d < bestD || (d === bestD && r < best)) { bestD = d; best = r; } }
    }
    return best;
  }
}
// ---------- Scrolling map helpers (L.sy = scroll offset in px; L.y already subtracts it) ----------
/** Global verse indices [g0, g1] covered by the viewport (0..L.H px) at the current scroll offset. */
export function visibleRange(L) {
  const at = y => Math.max(0, Math.min(TOTAL_VERSES - 1, Math.round((y + L.sy - L.top) / L.h * TOTAL_VERSES - 0.5)));
  return [at(0), at(L.H)];
}
/** Does arc r cross the viewport vertically? (cheap cull: its y-span overlaps 0..L.H) */
export function arcVisible(set, r, L, pad = 2) {
  const y1 = L.y(set.from[r]), y2 = L.y((set.to[r] + set.toEnd[r]) / 2);
  return Math.max(y1, y2) >= -pad && Math.min(y1, y2) <= L.H + pad;
}
/** Up to max ranks (< n, highest votes first) whose start or target verse lies in [g0, g1]. */
export function refsInRange(set, n, g0, g1, max = 150) {
  const out = []; if (!set) return out;
  for (let r = 0; r < Math.min(n, set.total) && out.length < max; r++) {
    const f = set.from[r], t = set.to[r];
    if ((f >= g0 && f <= g1) || (t >= g0 && t <= g1)) out.push(r);
  }
  return out;
}
/** Facts about the loaded file for the "OpenBible cross-references text file info" note. */
export function fileInfo(set) {
  if (!set) return null;
  if (!set._info) { const seen = new Uint8Array(TOTAL_VERSES + 1); let starts = 0;
    for (let i = 0; i < set.total; i++) { const f = set.from[i]; if (!seen[f]) { seen[f] = 1; starts++; } }
    set._info = { total: set.total, skipped: set.skipped || 0, starts, maxV: set.total ? set.votes[0] : 0, minV: set.total ? set.votes[set.total - 1] : 0 }; }
  return set._info;
}
export { TOTAL_VERSES };
