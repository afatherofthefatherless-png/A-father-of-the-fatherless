import { test, eq, ok, deepEq, throws } from './lib.js';
import { BOOKS, TOTAL_VERSES } from '../js/kjv/books.js';
import * as R from '../js/kjv/ref.js';

test('ref: 66 books, 31,102 verses', () => { eq(BOOKS.length, 66); eq(TOTAL_VERSES, 31102); });
test('ref: id -> ref/stem/file name, Genesis 3:14', () => {
  eq(R.refOf('GEN.3.14'), 'Genesis 3:14'); eq(R.stemOf('GEN.3.14'), 'Genesis 3-14'); eq(R.fileNameOf('GEN.3.14'), 'Genesis 3-14.wav');
  deepEq(R.folderPathOf('GEN.3.14'), ['KJV Recordings', '01 Genesis', 'Genesis 3']);
});
test('ref: Psalm singular in refs and files, Psalms in book folder', () => {
  eq(R.refOf('PSA.23.1'), 'Psalm 23:1'); eq(R.fileNameOf('PSA.23.1'), 'Psalm 23-1.wav');
  deepEq(R.folderPathOf('PSA.23.1'), ['KJV Recordings', '19 Psalms', 'Psalm 23']);
  eq(R.parseFileName('Psalm 23-1.wav'), 'PSA.23.1'); eq(R.parseFileName('Psalms 23-1.wav'), null);
});
test('ref: file name round trip for all 31,102 verses, all unique', () => {
  const seen = new Set(); let n = 0;
  for (const b of BOOKS) b.counts.forEach((vc, ci) => { for (let v = 1; v <= vc; v++) {
    const id = `${b.code}.${ci + 1}.${v}`, f = R.fileNameOf(id);
    if (R.parseFileName(f) !== id) throw new Error(`round trip failed for ${id} (${f})`);
    if (/[\\/:*?"<>|]/.test(f)) throw new Error(`reserved character in ${f}`);
    seen.add(f); n++;
  } });
  eq(n, 31102); eq(seen.size, 31102);
});
test('ref: parseFileName rejects non-canonical names', () => {
  for (const bad of ['Genesis 3-14 take 2 20261103-094012.wav', 'Genesis 03-14.wav', 'Genesis 3-014.wav', 'Genesis 51-1.wav', 'Genesis 3-25.wav', 'Genesis 3:14.wav', 'genesis 3-14.wav', 'Genesis 3-14.WAV', 'Genesis 3.14.wav'])
    eq(R.parseFileName(bad), null, bad);
  eq(R.parseFileName('1 Samuel 3-4.wav'), '1SA.3.4'); eq(R.parseFileName('Song of Solomon 1-1.wav'), 'SNG.1.1');
});
test('ref: kept-take name never parses as a verse file', () => {
  const n = R.takeFileNameOf('GEN.3.14', 2, new Date(2026, 10, 3, 9, 40, 12));
  eq(n, 'Genesis 3-14 take 2 20261103-094012.wav'); eq(R.parseFileName(n), null);
});
test('ref: passage parse/format/stem/expand (single chapter)', () => {
  const p = R.parsePassage('Genesis 3:14-19');
  eq(R.formatPassage(p), 'Genesis 3:14-19'); eq(R.passageStem(p), 'Genesis 3-14 to 3-19');
  deepEq(R.expandPassage(p), ['GEN.3.14', 'GEN.3.15', 'GEN.3.16', 'GEN.3.17', 'GEN.3.18', 'GEN.3.19']);
  eq(R.formatPassage('Genesis 3:14'), 'Genesis 3:14'); eq(R.passageStem('Genesis 3:14'), 'Genesis 3-14');
});
test('ref: cross-chapter range Genesis 1:24-2:3', () => {
  const p = R.parsePassage('Genesis 1:24-2:3'), ids = R.expandPassage(p);
  eq(ids.length, 11); eq(ids[0], 'GEN.1.24'); eq(ids[7], 'GEN.1.31'); eq(ids[8], 'GEN.2.1'); eq(ids[10], 'GEN.2.3');
  eq(R.formatPassage(p), 'Genesis 1:24-2:3'); eq(R.passageStem(p), 'Genesis 1-24 to 2-3');
  eq(R.formatPassage(R.parsePassage('Genesis 1-24 to 2-3')), 'Genesis 1:24-2:3'); // stem form round trip
});
test('ref: Psalm passages, aliases, en dash, whole chapter, cross-chapter', () => {
  eq(R.formatPassage('Psalms 23'), 'Psalm 23:1-6'); eq(R.formatPassage('Ps 23:1\u20133'), 'Psalm 23:1-3');
  eq(R.formatPassage('psalm 23:1-6'), 'Psalm 23:1-6'); eq(R.passageStem('Psalm 23:1-6'), 'Psalm 23-1 to 23-6');
  const p = R.parsePassage('Psalm 119:175-120:2'); eq(R.expandPassage(p).length, 4); eq(R.passageStem(p), 'Psalm 119-175 to 120-2');
  eq(R.formatPassage('1 Samuel 3:4'), '1 Samuel 3:4'); eq(R.formatPassage('Song of Songs 1:1-2'), 'Song of Solomon 1:1-2');
  eq(R.formatPassage('Genesis+3:14-19'), 'Genesis 3:14-19'); // from a URL query
  eq(R.formatPassage('Jude 1:1-25'), 'Jude 1:1-25');
});
test('ref: bad passages are rejected', async () => {
  await throws(() => R.parsePassage('Genesis 3:19-14'), /backwards/);
  await throws(() => R.parsePassage('Genesis 3:25'), /No such verse/);
  await throws(() => R.parsePassage('Genesis 3-4'), /Ambiguous/);
  await throws(() => R.parsePassage('Hezekiah 1:1'), /Unknown book/);
  await throws(() => R.parsePassage('Genesis 2:3-1:24'), /backwards/);
});
test('ref: global index matches tracker gi() layout', () => {
  eq(R.globalIndexOf('GEN.1.1'), 0); eq(R.globalIndexOf('GEN.2.1'), 31); eq(R.globalIndexOf('REV.22.21'), 31101);
  for (const id of ['GEN.1.1', 'EXO.20.3', 'PSA.119.176', 'MAL.4.6', 'MAT.1.1', 'REV.22.21']) eq(R.idFromGlobalIndex(R.globalIndexOf(id)), id);
  eq(R.idFromGlobalIndex(31102), null);
});
test('ref: parseId validates', () => { ok(R.parseId('GEN.3.14')); eq(R.parseId('GEN.3.25'), null); eq(R.parseId('Gen.3.14'), null); ok(R.parseId('1SA.3.4')); });
