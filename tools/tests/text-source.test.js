// Verse-text loader (release 11): data/manifest.json -> data/kjv-crosswire.json -> sha256 -> checks -> IndexedDB cache.
// Fake sample text only; fetch and the store are mocks.
import { test, eq, ok } from './lib.js';
import { BOOKS } from '../js/kjv/books.js';
import { loadTextSource, validateText, checkTextBytes, TextSource, TEXT_SHA256, TEXT_FILE } from '../js/kjv/text-source.js';
import * as TS from '../js/kjv/text-source.js';
import { loadManifest, loadDataFile, cacheKey, MANIFEST_KEY } from '../js/data/repo-data.js';
import { MemoryStore } from '../js/store/memory.js';
import { sha256Hex } from '../js/stitch/hash.js';

function fakeText() {
  const verses = [];
  for (const b of BOOKS) b.counts.forEach((n, ci) => { for (let v = 1; v <= n; v++) verses.push({ id: `${b.code}.${ci + 1}.${v}`, read_aloud_text: `Sample verse ${v}.` }); });
  return { verses };
}
const enc = o => new TextEncoder().encode(typeof o === 'string' ? o : JSON.stringify(o));
const GOOD = enc(fakeText());
async function readSrc(rel) {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(new URL(rel, import.meta.url), 'utf8');
  }
  return (await fetch(new URL(rel, import.meta.url), { cache: 'no-store' })).text();
}
/** A fake site: files by relative URL; online can be switched off; logs every URL fetched. */
function fakeSite(files) {
  const site = { files, online: true, calls: [] };
  site.fetch = async (url) => {
    site.calls.push(String(url));
    if (!site.online) throw new TypeError('Failed to fetch');
    const b = site.files[url]; if (!b) return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
    return { ok: true, status: 200, arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) };
  };
  return site;
}
const manifestFor = async (name, bytes, sha) => enc({ files: { [name]: { bytes: bytes.length, sha256: sha || await sha256Hex(bytes) } } });

test('data: checksum ok -> downloaded once, cached by checksum; relative URLs only', async () => {
  const b = enc('hello data'), site = fakeSite({ 'data/manifest.json': await manifestFor('x.txt', b), 'data/x.txt': b }), store = new MemoryStore();
  const r = await loadDataFile('x.txt', { store, fetchImpl: site.fetch });
  eq(r.ok, true); eq(r.from, 'download'); eq(new TextDecoder().decode(r.bytes), 'hello data');
  eq(site.calls.join('|'), 'data/manifest.json|data/x.txt', 'plain relative fetches (work under /A-father-of-the-fatherless/)');
  eq((await store.getKv(cacheKey('x.txt'))).sha256, await sha256Hex(b)); ok(await store.getKv(MANIFEST_KEY));
});
test('data: checksum bad -> clear error, nothing cached', async () => {
  const b = enc('hello data'), site = fakeSite({ 'data/manifest.json': await manifestFor('x.txt', b, 'a'.repeat(64)), 'data/x.txt': b }), store = new MemoryStore();
  const r = await loadDataFile('x.txt', { store, fetchImpl: site.fetch });
  eq(r.ok, false); ok(/Checksum mismatch for data\/x\.txt/.test(r.message), r.message); eq(await store.getKv(cacheKey('x.txt')), undefined);
  const r2 = await loadDataFile('y.txt', { store, fetchImpl: site.fetch }); eq(r2.ok, false); ok(/no checksum for y\.txt/.test(r2.message));
});
test('data: cache hit offline -> no download, bytes from IndexedDB; offline with no cache -> clear error', async () => {
  const b = enc('hello data'), site = fakeSite({ 'data/manifest.json': await manifestFor('x.txt', b), 'data/x.txt': b }), store = new MemoryStore();
  await loadDataFile('x.txt', { store, fetchImpl: site.fetch });
  site.online = false; site.calls.length = 0;
  const r = await loadDataFile('x.txt', { store, fetchImpl: site.fetch });
  eq(r.ok, true); eq(r.from, 'cache'); ok(/saved on this device/.test(r.warning)); eq(site.calls.join('|'), 'data/manifest.json');
  online: {
    const r2 = await loadDataFile('x.txt', { store: new MemoryStore(), fetchImpl: site.fetch });
    eq(r2.ok, false); ok(/Could not load data\/manifest\.json/.test(r2.message), r2.message);
  }
  site.online = true; site.calls.length = 0;
  eq((await loadDataFile('x.txt', { store, fetchImpl: site.fetch })).from, 'cache'); eq(site.calls.join('|'), 'data/manifest.json', 'online, same checksum: no re-download');
});
test('data: manifest checksum change -> downloads again; damaged cache is dropped', async () => {
  const b1 = enc('version one'), b2 = enc('version two'), store = new MemoryStore();
  const site = fakeSite({ 'data/manifest.json': await manifestFor('x.txt', b1), 'data/x.txt': b1 });
  await loadDataFile('x.txt', { store, fetchImpl: site.fetch });
  site.files = { 'data/manifest.json': await manifestFor('x.txt', b2), 'data/x.txt': b2 }; site.calls.length = 0;
  const r = await loadDataFile('x.txt', { store, fetchImpl: site.fetch });
  eq(r.from, 'download'); eq(new TextDecoder().decode(r.bytes), 'version two'); eq(site.calls.join('|'), 'data/manifest.json|data/x.txt');
  const c = await store.getKv(cacheKey('x.txt')); c.bytes = enc('tampered!!!'); await store.setKv(cacheKey('x.txt'), c);
  eq((await loadDataFile('x.txt', { store, fetchImpl: site.fetch })).from, 'download', 'bad cached bytes -> fresh download');
  eq((await loadManifest({ store: new MemoryStore(), fetchImpl: fakeSite({}).fetch })).ok, false, '404 manifest, no saved copy'); eq((await loadManifest({ store, fetchImpl: fakeSite({}).fetch })).offline, true, '404 manifest -> saved copy');
});
test('text: loads data/kjv-crosswire.json, checks pinned sha + shape; errors are plain', async () => {
  const sha = await sha256Hex(GOOD), store = new MemoryStore();
  const site = fakeSite({ 'data/manifest.json': await manifestFor(TEXT_FILE, GOOD), ['data/' + TEXT_FILE]: GOOD });
  let r = await loadTextSource({ store, fetchImpl: site.fetch, expectedSha256: sha });
  eq(r.status, 'ok'); eq(r.source.text('GEN.1.1'), 'Sample verse 1.'); eq(r.source.map.size, 31102);
  r = await loadTextSource({ store: new MemoryStore(), fetchImpl: site.fetch }); // fake bytes vs the real pinned checksum
  eq(r.status, 'error'); ok(/different checksum/.test(r.message)); eq(r.source.loaded, false);
  const bad = enc({ verses: fakeText().verses.slice(1) });
  r = await loadTextSource({ store: new MemoryStore(), fetchImpl: fakeSite({ 'data/manifest.json': await manifestFor(TEXT_FILE, bad), ['data/' + TEXT_FILE]: bad }).fetch, expectedSha256: await sha256Hex(bad) });
  eq(r.status, 'error'); ok(/31102 verses/.test(r.message));
  eq(validateText(fakeText()).length, 0); eq((await checkTextBytes(GOOD, { expectedSha256: sha })).ok, true);
  ok(/^[0-9a-f]{64}$/.test(TEXT_SHA256));
});
test('text: TextSource.replaceWith keeps identity so an open Recorder sees text loaded later', () => {
  const t = new TextSource(); const holder = { textSource: t };
  t.replaceWith(TextSource.fromJson({ verses: [{ id: 'GEN.1.1', read_aloud_text: 'Sample verse one.' }] }));
  eq(holder.textSource.loaded, true); eq(holder.textSource.text('GEN.1.1'), 'Sample verse one.');
});

test('text: no Google Drive or Picker for text; the site manifest pins the same checksum', async () => {
  for (const k of ['pickTextFile', 'rememberFileId', 'forgetTextFile', 'FILE_ID_KEY']) eq(k in TS, false, k);
  for (const rel of ['../index.html', '../js/app.js', '../js/kjv/text-source.js', '../js/xref/refs-source.js', '../js/ui/xref-view.js', '../js/ui/record-view.js'])
    for (const re of [/googleapis\.com\/drive/, /picker/i, /pickTextFile|pickRefsFile|chooseTextFile/, /Sign in to (show|load)/, /type\s*[:=]\s*['"]file['"]/])
      ok(!re.test(await readSrc(rel)), `${rel} matches ${re}`);
  const m = JSON.parse(await readSrc('../data/manifest.json'));
  eq(m.files[TEXT_FILE].sha256, TEXT_SHA256); eq(m.files[TEXT_FILE].verses, 31102);
});
