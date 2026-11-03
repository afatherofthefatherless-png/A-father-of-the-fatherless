// Verse-text loader: Google Drive is the only source (Picker -> file id -> files.get?alt=media -> checks -> cache).
// Fake sample text only; fetch, localStorage, the store, gapi and the Picker are all mocks.
import { test, eq, ok } from './lib.js';
import { BOOKS, TOTAL_VERSES } from '../js/kjv/books.js';
import { loadTextSource, pickTextFile, rememberFileId, forgetTextFile, validateText, checkTextBytes, TextSource,
  TEXT_SHA256, TEXT_MIME, FILE_ID_KEY, CACHE_KEY, MESSAGES, MISSING_MESSAGE } from '../js/kjv/text-source.js';
import * as TS from '../js/kjv/text-source.js';
import { GOOGLE_API_KEY, GOOGLE_APP_ID, GOOGLE_CLIENT_ID, DRIVE_SCOPE } from '../js/config.js';
import { MemoryStore } from '../js/store/memory.js';
import { sha256Hex } from '../js/stitch/hash.js';

function fakeText() {
  const verses = [];
  for (const b of BOOKS) b.counts.forEach((n, ci) => { for (let v = 1; v <= n; v++) verses.push({ id: `${b.code}.${ci + 1}.${v}`, read_aloud_text: `Sample verse ${v}.` }); });
  return { verses };
}
const enc = o => new TextEncoder().encode(JSON.stringify(o));
const GOOD = enc(fakeText());
let GOOD_SHA = null;
const goodSha = async () => GOOD_SHA || (GOOD_SHA = await sha256Hex(GOOD));
function fakeFetch(body, status = 200) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url: String(url), auth: init && init.headers && init.headers.Authorization });
    if (body instanceof Error) throw body;
    return { ok: status >= 200 && status < 300, status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
  f.calls = calls; return f;
}
function fakeLs(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}
const tok = () => 'tok-123';
async function readSrc(rel) {
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    const { readFile } = await import('node:fs/promises');
    return readFile(new URL(rel, import.meta.url), 'utf8');
  }
  return (await fetch(new URL(rel, import.meta.url), { cache: 'no-store' })).text();
}

test('text: config has the Picker constants; API key empty until Robin sets it; scope stays drive.file', () => {
  eq(GOOGLE_APP_ID, '456053541349'); ok(GOOGLE_CLIENT_ID.startsWith(GOOGLE_APP_ID + '-'));
  eq(typeof GOOGLE_API_KEY, 'string'); eq(DRIVE_SCOPE, 'https://www.googleapis.com/auth/drive.file');
  ok(/^[0-9a-f]{64}$/.test(TEXT_SHA256)); eq(TEXT_MIME, 'application/json');
});
test('text: no key, not signed in, no file chosen -> the plain messages, never throws, no fetch', async () => {
  const f = fakeFetch(GOOD), store = new MemoryStore();
  let r = await loadTextSource({ store, getToken: tok, fetchImpl: f, localStorage: fakeLs(), apiKey: '' });
  eq(r.status, 'no-key'); eq(r.message, 'Google API key not set up yet'); eq(r.source.loaded, false);
  r = await loadTextSource({ store, getToken: () => null, fetchImpl: f, localStorage: fakeLs(), apiKey: 'k' });
  eq(r.status, 'signed-out'); eq(r.message, 'Sign in with Google (Drive tab) to load the verse text.');
  r = await loadTextSource({ store, getToken: tok, fetchImpl: f, localStorage: fakeLs(), apiKey: 'k' });
  eq(r.status, 'choose'); eq(r.message, MESSAGES.notChosen); eq(MESSAGES.choose, 'Choose the verse text file from Google Drive');
  eq(f.calls.length, 0); ok(MISSING_MESSAGE);
});
test('text: remembered id -> files.get?alt=media with the token -> checks -> cached', async () => {
  const f = fakeFetch(GOOD), store = new MemoryStore(), ls = fakeLs({ [FILE_ID_KEY]: 'FILE1' });
  const r = await loadTextSource({ store, getToken: tok, fetchImpl: f, localStorage: ls, apiKey: 'k', expectedSha256: await goodSha() });
  eq(r.status, 'ok', r.message); eq(r.source.map.size, TOTAL_VERSES); eq(r.source.text('PSA.23.1'), 'Sample verse 1.');
  eq(f.calls.length, 1); eq(f.calls[0].url, 'https://www.googleapis.com/drive/v3/files/FILE1?alt=media'); eq(f.calls[0].auth, 'Bearer tok-123');
  const c = await store.getKv(CACHE_KEY); eq(c.fileId, 'FILE1'); ok(c.bytes.byteLength === GOOD.byteLength);
});
test('text: cache works offline and signed out, checks run again on read, bad cache is dropped', async () => {
  const store = new MemoryStore(), ls = fakeLs({ [FILE_ID_KEY]: 'FILE1' }), sha = await goodSha();
  await loadTextSource({ store, getToken: tok, fetchImpl: fakeFetch(GOOD), localStorage: ls, apiKey: 'k', expectedSha256: sha });
  const off = fakeFetch(new Error('offline'));
  let r = await loadTextSource({ store, getToken: () => null, fetchImpl: off, localStorage: ls, apiKey: '', expectedSha256: sha });
  eq(r.status, 'ok', r.message); eq(r.source.map.size, TOTAL_VERSES); eq(off.calls.length, 0, 'no network when cached');
  // tamper with the cache: checksum fails on read, cache is cleared, falls back to the Drive flow
  const c = await store.getKv(CACHE_KEY); const bad = new Uint8Array(c.bytes); bad[20] ^= 1; await store.setKv(CACHE_KEY, { ...c, bytes: bad.buffer });
  r = await loadTextSource({ store, getToken: () => null, fetchImpl: off, localStorage: ls, apiKey: 'k', expectedSha256: sha });
  eq(r.status, 'signed-out'); eq(await store.getKv(CACHE_KEY), null);
});
test('text: remembered id 404/403 is forgotten and the choose button comes back; 401 = sign in again', async () => {
  for (const st of [404, 403]) {
    const ls = fakeLs({ [FILE_ID_KEY]: 'GONE' });
    const r = await loadTextSource({ store: new MemoryStore(), getToken: tok, fetchImpl: fakeFetch(new Uint8Array(), st), localStorage: ls, apiKey: 'k' });
    eq(r.status, 'choose'); eq(r.message, MESSAGES.forgotten); eq(ls.getItem(FILE_ID_KEY), null);
  }
  const ls = fakeLs({ [FILE_ID_KEY]: 'X' });
  let r = await loadTextSource({ store: new MemoryStore(), getToken: tok, fetchImpl: fakeFetch(new Uint8Array(), 401), localStorage: ls, apiKey: 'k' });
  eq(r.status, 'signed-out'); eq(ls.getItem(FILE_ID_KEY), 'X');
  r = await loadTextSource({ store: new MemoryStore(), getToken: tok, fetchImpl: fakeFetch(new Error('offline')), localStorage: ls, apiKey: 'k' });
  eq(r.status, 'error'); eq(ls.getItem(FILE_ID_KEY), 'X');
});
test('text: checksum mismatch, wrong count, bad id, wrong shape are all rejected (id forgotten, nothing cached)', async () => {
  const good = fakeText(), store = new MemoryStore();
  const run = async (bytes, sha) => { const ls = fakeLs({ [FILE_ID_KEY]: 'F' }); const r = await loadTextSource({ store, getToken: tok, fetchImpl: fakeFetch(bytes), localStorage: ls, apiKey: 'k', expectedSha256: sha }); eq(ls.getItem(FILE_ID_KEY), null); return r; };
  let r = await run(GOOD, TEXT_SHA256); // real checksum constant vs fake bytes
  eq(r.status, 'invalid'); ok(/checksum/.test(r.message)); eq(r.source.loaded, false);
  r = await run(enc({ verses: good.verses.slice(1) }), null); eq(r.status, 'invalid'); ok(/31102 verses/.test(r.message));
  r = await run(enc({ verses: good.verses.map((v, i) => i === 5 ? { ...v, id: 'GEN 1:6' } : v) }), null); eq(r.status, 'invalid'); ok(/unknown verse id/.test(r.message));
  r = await run(enc([{ id: 'GEN.1.1', text: 'Sample verse one.' }]), null); eq(r.status, 'invalid');
  r = await run(new TextEncoder().encode('not json'), null); eq(r.status, 'invalid');
  eq(await store.getKv(CACHE_KEY), undefined);
  eq(validateText(good).length, 0); eq((await checkTextBytes(GOOD, { expectedSha256: await goodSha() })).ok, true);
});
test('text: "Choose a different file" forgets the id and clears the cache; rememberFileId stores the pick', async () => {
  const store = new MemoryStore(), ls = fakeLs(), sha = await goodSha();
  rememberFileId('FILE9', ls); eq(ls.getItem(FILE_ID_KEY), 'FILE9');
  await loadTextSource({ store, getToken: tok, fetchImpl: fakeFetch(GOOD), localStorage: ls, apiKey: 'k', expectedSha256: sha });
  ok(await store.getKv(CACHE_KEY));
  await forgetTextFile({ store, localStorage: ls });
  eq(ls.getItem(FILE_ID_KEY), null); eq(await store.getKv(CACHE_KEY), null);
  const r = await loadTextSource({ store, getToken: tok, fetchImpl: fakeFetch(GOOD), localStorage: ls, apiKey: 'k', expectedSha256: sha });
  eq(r.status, 'choose');
});
test('text: TextSource.replaceWith keeps identity so an open Recorder sees text loaded later', () => {
  const t = new TextSource(); const holder = { textSource: t };
  t.replaceWith(TextSource.fromJson({ verses: [{ id: 'GEN.1.1', read_aloud_text: 'Sample verse one.' }] }));
  eq(holder.textSource.loaded, true); eq(holder.textSource.text('GEN.1.1'), 'Sample verse one.');
});

function fakePicker({ pick = 'PICKED_ID', cancel = false } = {}) {
  const log = {};
  const picker = {
    ViewId: { DOCS: 'all' }, Action: { PICKED: 'picked', CANCEL: 'cancel' }, Response: { ACTION: 'action', DOCUMENTS: 'docs' }, Document: { ID: 'id' },
    DocsView: class { constructor(v) { log.viewId = v; } setMimeTypes(m) { log.mime = m; return this; } setIncludeFolders(b) { log.folders = b; return this; } setSelectFolderEnabled(b) { log.selectFolder = b; return this; } },
    PickerBuilder: class {
      addView(v) { log.view = v; return this; } setOAuthToken(t) { log.token = t; return this; } setDeveloperKey(k) { log.key = k; return this; }
      setAppId(a) { log.appId = a; return this; } setTitle(t) { log.title = t; return this; } setCallback(cb) { log.cb = cb; return this; }
      build() { return { setVisible: v => { log.visible = v; setTimeout(() => log.cb(cancel ? { action: 'cancel' } : { action: 'picked', docs: [{ id: pick }] }), 0); } }; }
    },
  };
  const google = {};
  const gapi = { load: (name, o) => { log.loaded = name; google.picker = picker; o.callback(); } };
  return { env: { gapi, google, loadScript: async src => { log.script = src; } }, log };
}
test('text: Picker opens JSON-only with the drive.file token, API key and app id; returns the id or null', async () => {
  const { env, log } = fakePicker();
  eq(await pickTextFile({ token: 'tok-123', apiKey: 'KEY', env }), 'PICKED_ID');
  eq(log.loaded, 'picker'); eq(log.mime, 'application/json'); eq(log.token, 'tok-123'); eq(log.key, 'KEY'); eq(log.appId, '456053541349'); eq(log.visible, true);
  eq(await pickTextFile({ token: 't', apiKey: 'KEY', env: fakePicker({ cancel: true }).env }), null);
  let err = null; try { await pickTextFile({ token: 't', apiKey: '', env }); } catch (e) { err = e.message; } eq(err, 'Google API key not set up yet');
  err = null; try { await pickTextFile({ token: null, apiKey: 'KEY', env }); } catch (e) { err = e.message; } eq(err, MESSAGES.signedOut);
});
test('text: Drive is the only source: no fixed path, no device file picker, no data/ fetch', async () => {
  eq('saveTextFile' in TS, false); eq('TEXT_PATH' in TS, false);
  for (const rel of ['../index.html', '../js/app.js', '../js/kjv/text-source.js']) {
    const src = await readSrc(rel);
    for (const re of [/type\s*[:=]\s*['"]file['"]/, /#\/text\b/, /showOpenFilePicker/, /FileReader/, /saveTextFile/, /getKv\(\s*['"]textSource/, /webkitdirectory/, /data\/kjv-text/])
      ok(!re.test(src), `${rel} matches ${re}`);
  }
  const ts = await readSrc('../js/kjv/text-source.js');
  const fetched = [...ts.matchAll(/fetchImpl\((`[^`]*`|[^,)]+)/g)].map(m => m[1].trim());
  eq(fetched.join('|'), '`${DRIVE_FILES}${encodeURIComponent(fileId)}?alt=media`', 'loader fetches only the Drive file');
  ok(ts.includes("'https://www.googleapis.com/drive/v3/files/'"));
});
