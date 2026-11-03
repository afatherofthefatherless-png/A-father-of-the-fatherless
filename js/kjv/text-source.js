// Verse-text source. This repo and the deployed site contain NO verse text. There is exactly ONE place text can
// come from: a JSON file in the signed-in user's own Google Drive, chosen once with the Google Picker.
//   sign in (drive.file token) -> pick the file (Google Picker) -> remember its Drive file id (localStorage)
//   -> download files/{id}?alt=media -> sha256 + shape + 31,102 verses + ids -> TextSource.
// The validated bytes are cached in the site's IndexedDB store so it works offline; the same checks run again on
// every read from the cache. There is no fixed path, no device file picker and no other fallback.
// Expected shape: { "verses": [ { "id": "GEN.1.1", "read_aloud_text": "..." }, ... ] } with all 31,102 KJV verses.
// UNTESTED against Google: needs Robin's sign-in and a Google API key on the real GitHub Pages origin.
import { TOTAL_VERSES } from './books.js';
import { parseId } from './ref.js';
import { sha256Hex } from '../stitch/hash.js';
import { GOOGLE_API_KEY, GOOGLE_APP_ID } from '../config.js';

// sha256 of /workspace/kjv-central/kjv-text-slim.json (see kjv-text-slim.json.sha256). Update both together.
export const TEXT_SHA256 = '0641311bd4407628c34ce43e769c75c8a1e67b29490df207dde87a050d31c592';
export const TEXT_MIME = 'application/json';
export const FILE_ID_KEY = 'kjv-site.textDriveFileId.v1';   // localStorage: the picked Drive file id
export const CACHE_KEY = 'textCache.v1';                    // store kv: { fileId, sha256, bytes, savedAt }
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files/';

export const MESSAGES = Object.freeze({
  noKey: 'Google API key not set up yet',
  signedOut: 'Sign in with Google (Drive tab) to load the verse text.',
  choose: 'Choose the verse text file from Google Drive',      // the button label
  notChosen: 'No verse text file chosen yet.',
  forgotten: 'The verse text file you chose before could not be opened. Please choose it again.',
  loading: 'Loading the verse text from Google Drive…',
});
// Shown wherever verse text would appear while it is not loaded (Home and Record use the same status).
export const MISSING_MESSAGE = 'Verse text not loaded yet.';

export class TextSource {
  constructor(map = new Map(), label = 'none') { this.map = map; this.label = label; }
  get loaded() { return this.map.size > 0; }
  text(id) { return this.map.get(id) ?? null; }
  wordCount(id) { const t = this.text(id); return t ? t.trim().split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length : null; }
  /** Swap in another source's verses, so every holder of this object (e.g. an open Recorder) sees them. */
  replaceWith(other) { this.map = other.map; this.label = other.label; return this; }
  /** Builds a source from the CrossWire slim shape only. Does not check completeness (see validateText). */
  static fromJson(obj, label = 'Google Drive') {
    const m = new Map();
    if (obj && Array.isArray(obj.verses)) for (const v of obj.verses) if (v && v.id && typeof v.read_aloud_text === 'string') m.set(v.id, v.read_aloud_text);
    return new TextSource(m, label);
  }
}

/** Returns a list of problems (empty = valid): shape, 31,102 verses, every id a real KJV verse, no duplicates. */
export function validateText(obj, expected = TOTAL_VERSES) {
  if (!obj || typeof obj !== 'object' || !Array.isArray(obj.verses)) return ['expected { "verses": [ ... ] }'];
  const errs = [], seen = new Set();
  if (obj.verses.length !== expected) errs.push(`expected ${expected} verses, found ${obj.verses.length}`);
  for (const v of obj.verses) {
    if (errs.length >= 5) break;
    if (!v || typeof v.id !== 'string' || !parseId(v.id)) { errs.push(`unknown verse id ${JSON.stringify(v && v.id)}`); continue; }
    if (seen.has(v.id)) errs.push(`duplicate verse id ${v.id}`);
    seen.add(v.id);
    if (typeof v.read_aloud_text !== 'string' || !v.read_aloud_text.trim()) errs.push(`no read_aloud_text for ${v.id}`);
  }
  return errs;
}

/** The full set of checks on raw bytes. Never throws. Returns { ok, source, message }. */
export async function checkTextBytes(buf, { expectedSha256 = TEXT_SHA256, expectedCount = TOTAL_VERSES, label = 'Google Drive' } = {}) {
  const fail = message => ({ ok: false, source: new TextSource(), message });
  try {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (expectedSha256) {
      const got = await sha256Hex(bytes);
      if (got !== expectedSha256) return fail(`The verse text file failed its checksum (got ${got.slice(0, 12)}…).`);
    }
    const obj = JSON.parse(new TextDecoder('utf-8').decode(bytes));
    const errs = validateText(obj, expectedCount);
    if (errs.length) return fail(`The verse text file failed its check: ${errs.join('; ')}.`);
    return { ok: true, source: TextSource.fromJson(obj, label), message: '' };
  } catch (e) {
    return fail(`The verse text file could not be read: ${e.message}.`);
  }
}

const safeLs = ls => ({
  get: k => { try { return ls ? ls.getItem(k) : null; } catch { return null; } },
  set: (k, v) => { try { ls && ls.setItem(k, v); } catch {} },
  del: k => { try { ls && ls.removeItem(k); } catch {} },
});
const toArrayBuffer = b => b instanceof ArrayBuffer ? b : (b && b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);

/**
 * Loads the verse text from Google Drive (or the validated offline cache of it). Never throws.
 * Returns { source, status, message } with status one of:
 *   'ok'         text loaded (from Drive or from the cache)
 *   'no-key'     GOOGLE_API_KEY is empty, so the Picker cannot open yet
 *   'signed-out' not signed in to Google
 *   'choose'     signed in, no file chosen yet (or the remembered one was 404/403 and has been forgotten)
 *   'invalid'    the Drive file failed a check (its id is forgotten so a different file can be chosen)
 *   'error'      network or Drive error; try again later
 * Everything is injectable for tests: store (getKv/setKv), getToken, fetchImpl, localStorage, apiKey, expectedSha256.
 */
export async function loadTextSource({
  store, getToken = () => null, fetchImpl = (...a) => globalThis.fetch(...a), localStorage = globalThis.localStorage,
  apiKey = GOOGLE_API_KEY, expectedSha256 = TEXT_SHA256, expectedCount = TOTAL_VERSES,
} = {}) {
  const empty = new TextSource(), ls = safeLs(localStorage), opts = { expectedSha256, expectedCount };
  const out = (status, message, source = empty) => ({ source, status, message });
  const fileId = ls.get(FILE_ID_KEY);

  // 1. Offline cache (checks run again on every read).
  let cached = null;
  try { cached = store ? await store.getKv(CACHE_KEY) : null; } catch {}
  if (cached && cached.bytes) {
    const c = await checkTextBytes(toArrayBuffer(cached.bytes), { ...opts, label: 'Google Drive (saved on this device)' });
    if (c.ok && (!fileId || !cached.fileId || cached.fileId === fileId)) return out('ok', '', c.source);
    try { await store.setKv(CACHE_KEY, null); } catch {}
  }

  // 2. Drive.
  const token = getToken();
  if (!fileId && !apiKey) return out('no-key', MESSAGES.noKey);
  if (!token) return out('signed-out', MESSAGES.signedOut);
  if (!fileId) return out('choose', MESSAGES.notChosen);
  let r;
  try {
    r = await fetchImpl(`${DRIVE_FILES}${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch { return out('error', 'Could not reach Google Drive. Check the connection and try again.'); }
  if (r.status === 404 || r.status === 403) { ls.del(FILE_ID_KEY); return out(apiKey ? 'choose' : 'no-key', apiKey ? MESSAGES.forgotten : MESSAGES.noKey); }
  if (r.status === 401) return out('signed-out', MESSAGES.signedOut);
  if (!r.ok) return out('error', `Google Drive said ${r.status}. Try again later.`);
  let buf;
  try { buf = await r.arrayBuffer(); } catch (e) { return out('error', `Download from Google Drive failed: ${e.message}.`); }
  const c = await checkTextBytes(buf, opts);
  if (!c.ok) { ls.del(FILE_ID_KEY); return out('invalid', `${c.message} Please choose the correct file.`); }
  try { if (store) await store.setKv(CACHE_KEY, { fileId, sha256: expectedSha256, bytes: buf, savedAt: Date.now() }); } catch {}
  return out('ok', '', c.source);
}

/** Remember a Drive file id chosen in the Picker (the next loadTextSource downloads it). */
export function rememberFileId(id, localStorage = globalThis.localStorage) { if (id) safeLs(localStorage).set(FILE_ID_KEY, id); }

/** "Choose a different file": forget the remembered id and clear the offline cache. */
export async function forgetTextFile({ store, localStorage = globalThis.localStorage } = {}) {
  safeLs(localStorage).del(FILE_ID_KEY);
  try { if (store) await store.setKv(CACHE_KEY, null); } catch {}
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.async = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google Picker'));
    document.head.appendChild(s);
  });
}
async function loadPicker(env) {
  if (env.google?.picker) return env.google.picker;
  if (!env.gapi) { await env.loadScript('https://apis.google.com/js/api.js'); }
  const gapi = env.gapi || globalThis.gapi; if (!gapi) throw new Error('Could not load Google Picker');
  await new Promise((res, rej) => gapi.load('picker', { callback: res, onerror: () => rej(new Error('Could not load Google Picker')) }));
  const g = env.google || globalThis.google; if (!g?.picker) throw new Error('Could not load Google Picker');
  return g.picker;
}

/**
 * Opens the Google Picker (JSON files only) with the drive.file token. Picking a file grants this site access to it
 * under drive.file. Resolves to the picked file id, or null if the user cancels. Rejects if the key is missing.
 * env is injectable for tests: { gapi, google, loadScript }.
 */
export async function pickTextFile({ token, apiKey = GOOGLE_API_KEY, appId = GOOGLE_APP_ID, env = {} } = {}) {
  if (!apiKey) throw new Error(MESSAGES.noKey);
  if (!token) throw new Error(MESSAGES.signedOut);
  const e = { gapi: env.gapi ?? (env.loadScript ? undefined : globalThis.gapi), google: env.google, loadScript: env.loadScript || loadScript };
  const picker = await loadPicker(e);
  return new Promise(res => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setMimeTypes(TEXT_MIME).setIncludeFolders(true).setSelectFolderEnabled(false);
    const p = new picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setTitle('Choose the verse text file')
      .setCallback(data => {
        const action = data[picker.Response.ACTION];
        if (action === picker.Action.PICKED) { const d = (data[picker.Response.DOCUMENTS] || [])[0]; res(d ? d[picker.Document.ID] : null); }
        else if (action === picker.Action.CANCEL) res(null);
      })
      .build();
    p.setVisible(true);
  });
}
