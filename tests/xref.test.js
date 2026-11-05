// Cross Ref Map: parser, ranking, vote-threshold slider, id mapping, geometry, loader. Synthetic refs only, no verse text.
import { test, eq, ok, deepEq, throws } from './lib.js';
import * as X from '../js/xref/xrefs.js';
import { loadRefs, devRefsUrl, REFS_FILE_NAME } from '../js/xref/refs-source.js';
import { sha256Hex } from '../js/stitch/hash.js';
import { MemoryStore } from '../js/store/memory.js';
import { globalIndexOf } from '../js/kjv/ref.js';

const SAMPLE = 'From Verse\tTo Verse\tVotes\t#test\nGen.1.1\tJohn.1.1-John.1.3\t384\nGen.1.1\tExod.31.18\t-41\nPs.23.1\tJohn.10.11\t50\nRev.22.21\tRom.1.7\t0\n3John.1.15\tJohn.10.3\t2\nGen.1.1\tHeb.11.3\t50\nFoo.1.1\tGen.1.1\t9\n';
const fakeLs = (m = {}) => ({ getItem: k => k in m ? m[k] : null, setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; }, m });

test('xref: OSIS -> CrossWire id mapping (66 books, KJV order, 3 John 1:15 -> 1:14)', () => {
  eq(X.OSIS.length, 66); eq(X.osisToId('Gen.1.1'), 'GEN.1.1'); eq(X.osisToId('Ps.23.1'), 'PSA.23.1'); eq(X.osisToId('Song.1.1'), 'SNG.1.1');
  eq(X.osisToId('1John.2.3'), '1JN.2.3'); eq(X.osisToId('Phlm.1.25'), 'PHM.1.25'); eq(X.osisToId('Rev.22.21'), 'REV.22.21');
  eq(X.osisToId('3John.1.15'), '3JN.1.14'); eq(X.osisToId('Gen.51.1'), null); eq(X.osisToId('Foo.1.1'), null);
  eq(X.BOOK_START[66], 31102); eq(X.bookIndexAt(globalIndexOf('MAT.1.1')), 39);
});
test('xref: parser reads ranges, skips non-KJV lines, ranks by votes (ties keep file order)', () => {
  const s = X.parseRefs(SAMPLE);
  eq(s.total, 6); eq(s.skipped, 1);
  deepEq([...s.votes], [384, 50, 50, 2, 0, -41]);
  const l0 = X.linkAt(s, 0); eq(l0.fromRef, 'Genesis 1:1'); eq(l0.toRef, 'John 1:1-3'); deepEq(l0.toIds, ['JHN.1.1', 'JHN.1.2', 'JHN.1.3']);
  eq(X.linkAt(s, 1).fromRef, 'Psalm 23:1', 'tie: earlier line ranks first'); eq(X.linkAt(s, 2).toRef, 'Hebrews 11:3');
  throws(() => X.parseRefs('hello\nworld'), /header/);
});
test('xref: vote-threshold slider counts come from the data', () => {
  const s = X.parseRefs(SAMPLE);
  deepEq(X.THRESHOLDS, [null, 5, 10, 20, 50, 100]);
  deepEq([0, 1, 2, 3, 4, 5].map(i => X.stepInfo(s, i).count), [6, 3, 3, 3, 3, 1]);
  eq(X.stepLabel(X.stepInfo(s, 0)), 'Showing all 6 refs'); eq(X.stepLabel(X.stepInfo(s, 2)), 'Showing 3 refs (at least 10 votes)');
  eq(X.stepInfo(s, 99).step, 5); eq(X.stepInfo(null, 0).count, 0);
  const big = { total: 100000, votes: new Int32Array(100000).fill(1) }, si = X.stepInfo(big, 0);
  ok(si.capped && si.drawn === X.DRAW_CAP, 'all step is capped'); eq(X.stepLabel(si), 'Showing all 100,000 refs, drawing the top 60,000 of 100,000');
});
test('xref: real OpenBible file (if on this computer): 344,799 refs and the four required steps', async () => {
  if (typeof process === 'undefined') return;
  const fs = await import('node:fs'), p = '/workspace/xref/cross_references.txt';
  if (!fs.existsSync(p)) return;
  const s = X.parseRefs(fs.readFileSync(p, 'utf8'));
  eq(s.total, 344799); eq(s.skipped, 0);
  deepEq([0, 1, 2, 3].map(i => X.stepInfo(s, i).count), [344799, 117466, 45209, 17639]);
  eq(X.linkAt(s, 0).fromRef, 'Jeremiah 29:11');
});
test('xref: top-1000 pick, book lookup, arc geometry and hit test', () => {
  const s = X.parseRefs(SAMPLE);
  eq(X.pickTop(s, 0), 0); eq(X.pickTop(s, 0.9999), 5);
  eq(X.topInBook(s, 18), 1); eq(X.topInBook(s, 0), 0); eq(X.topInBook(s, 2), -1);
  const L = { x0: 90, maxW: 600, top: 8, h: 700, y: g => 8 + (g + 0.5) / 31102 * 700 };
  const a = X.arcOf(s, 0, L), p0 = X.pointOn(a, 0), p1 = X.pointOn(a, 1), pm = X.pointOn(a, 0.5);
  ok(Math.abs(p0.x - 90) < 1e-6 && Math.abs(p0.y - L.y(s.from[0])) < 1e-6, 'dot starts at the from verse');
  ok(Math.abs(p1.y - L.y((s.to[0] + s.toEnd[0]) / 2)) < 1e-6, 'dot ends at the to verse');
  ok(Math.abs(pm.x - (90 + a.rx)) < 1e-6, 'mid point is the apex on the right');
  eq(X.hitTest(s, s.total, L, pm.x, pm.y), 0); eq(X.hitTest(s, s.total, L, 10, 10), -1);
});
test('xref: loader: data/manifest.json -> data/openbible-cross-references.txt, cached, offline, bad checksum; dev URL only on localhost', async () => {
  const store = new MemoryStore(), bytes = new TextEncoder().encode(SAMPLE);
  const man = sha => new TextEncoder().encode(JSON.stringify({ files: { [REFS_FILE_NAME]: { bytes: bytes.length, sha256: sha } } }));
  let online = true, files = { 'data/manifest.json': man(await sha256Hex(bytes)), ['data/' + REFS_FILE_NAME]: bytes };
  const fetchImpl = async u => { if (!online) throw new TypeError('offline'); const b = files[u]; return b ? { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(0) } : { ok: false, status: 404 }; };
  const r = await loadRefs({ store, fetchImpl });
  eq(r.status, 'ok'); eq(r.set.total, 6); eq(r.from, 'this site');
  online = false; eq((await loadRefs({ store, fetchImpl })).from, 'this site (saved on this device)', 'offline from cache');
  online = true; files['data/manifest.json'] = man('b'.repeat(64));
  const bad = await loadRefs({ store: new MemoryStore(), fetchImpl }); eq(bad.status, 'error'); ok(/Checksum mismatch/.test(bad.message));
  eq(REFS_FILE_NAME, 'openbible-cross-references.txt');
  eq(devRefsUrl('?refs=tests/fixtures/x.txt', '127.0.0.1'), 'tests/fixtures/x.txt');
  eq(devRefsUrl('?refs=tests/fixtures/x.txt', 'afatherofthefatherless-png.github.io'), null);
  eq(devRefsUrl('?refs=https://evil.example/x', 'localhost'), null);
});
test('xref: spatial index gives the same nearest arc as brute force', () => {
  let seed = 3; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const N = 3000, set = { total: N, from: new Int32Array(N), to: new Int32Array(N), toEnd: new Int32Array(N), votes: new Int32Array(N) };
  for (let i = 0; i < N; i++) { set.from[i] = Math.floor(rnd() * 31102); set.to[i] = set.toEnd[i] = Math.floor(rnd() * 31102); set.votes[i] = N - i; }
  const L = { x0: 92, maxW: 1060, top: 8, h: 600, y: g => 8 + (g + 0.5) / 31102 * 600 };
  const idx = new X.ArcIndex(set, N, L); let hits = 0;
  for (let k = 0; k < 400; k++) {
    const x = 92 + rnd() * 1060, y = rnd() * 616, a = X.hitTest(set, N, L, x, y, 12), b = idx.nearest(x, y, 12);
    eq(b, a, `at ${x.toFixed(1)},${y.toFixed(1)}`); if (a >= 0) hits++;
  }
  ok(hits > 50, 'enough points near arcs: ' + hits);
});

test('xref: scrolling helpers: visible range, culling and range list follow the scroll offset', () => {
  const s = X.parseRefs(SAMPLE), T = X.TOTAL_VERSES, H = 500, h = 4 * H - 16;
  const L = { W: 800, H, sy: 0, x0: 90, maxW: 700, top: 8, h, y: g => 8 + (g + 0.5) / T * h - L.sy };
  const [a0, b0] = X.visibleRange(L); eq(a0, 0); ok(b0 > 7000 && b0 < 8000, 'first screen ~ quarter of the Bible: ' + b0);
  ok(X.arcVisible(s, 0, L), 'Gen 1:1 -> John 1 crosses screen 1');
  const psRank = 1; L.sy = 3 * H; const [a1, b1] = X.visibleRange(L); ok(a1 > 20000 && b1 === T - 1, 'last screen reaches Revelation');
  eq(X.arcVisible({ from: [0], to: [100], toEnd: [100] }, 0, L), false, 'a Genesis-only arc is off the last screen'); ok(X.arcVisible(s, psRank, L), 'Ps 23 -> John 10 reaches into it');
  eq(X.refsInRange(s, s.total, a1, b1).map(r => X.linkAt(s, r).fromRef).join('|'), 'Genesis 1:1|Psalm 23:1|Genesis 1:1|3 John 1:14|Revelation 22:21', 'only links whose start or target is in range (not Gen -> Exod)');
  L.sy = 0; deepEq(X.refsInRange(s, s.total, 0, 10, 2), [0, 2], 'ranked, max respected');
  const fi = X.fileInfo(s); eq(fi.total, 6); eq(fi.starts, 4); eq(fi.maxV, 384); eq(fi.minV, -41);
});
test('xref: real file: 29,364 OSIS starting verses = 29,363 KJV verses (3 John 1:15 folds into 1:14)', async () => {
  if (typeof process === 'undefined') return;
  const fs = await import('node:fs'), p = '/workspace/xref/cross_references.txt'; if (!fs.existsSync(p)) return;
  eq(X.fileInfo(X.parseRefs(fs.readFileSync(p, 'utf8'))).starts, 29363);
});
