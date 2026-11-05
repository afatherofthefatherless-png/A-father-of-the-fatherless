// Cross-references file loader. Same route as the verse text (js/kjv/text-source.js): the file lives in Robin's own
// Google Drive, is chosen once with the Google Picker (drive.file), its id is remembered in localStorage, the bytes
// are cached in IndexedDB (site store kv) and parsed in the browser. Nothing is committed to the repo.
// Local development/tests only: ?refs=<relative path> on localhost/127.0.0.1 loads a file served by the dev server.
import { parseRefs } from './xrefs.js';
import { pickTextFile } from '../kjv/text-source.js';

export const REFS_FILE_ID_KEY = 'kjv-site.refsDriveFileId.v1';
export const REFS_CACHE_KEY = 'refsCache.v1';
export const REFS_MIME = 'text/plain,text/tab-separated-values';
export const REFS_FILE_NAME = 'cross_references.txt';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files/';
const ls = l => ({ get: k => { try { return l.getItem(k); } catch { return null; } }, set: (k, v) => { try { l.setItem(k, v); } catch {} }, del: k => { try { l.removeItem(k); } catch {} } });

/** Dev-only URL: returns the path if allowed (relative, same origin, localhost), else null. */
export function devRefsUrl(search, hostname) {
  const v = new URLSearchParams(search || '').get('refs');
  if (!v || !/^(localhost|127\.0\.0\.1)$/.test(hostname || '')) return null;
  if (/^[a-z]+:|^\/\//i.test(v)) return null;
  return v;
}
function parseBytes(buf) {
  try { return { ok: true, set: parseRefs(new TextDecoder('utf-8').decode(buf)) }; }
  catch (e) { return { ok: false, message: e.message }; }
}
/**
 * Never throws. Returns { set, status, message }; status: 'ok' | 'signed-out' | 'choose' | 'invalid' | 'error'.
 */
export async function loadRefs({ store, getToken = () => null, fetchImpl = (...a) => globalThis.fetch(...a), localStorage = globalThis.localStorage, devUrl = null } = {}) {
  const L = ls(localStorage), out = (status, message, set = null, from = '') => ({ status, message, set, from });
  if (devUrl) {
    try { const r = await fetchImpl(devUrl, { cache: 'no-store' }); if (!r.ok) return out('error', `Local refs file said ${r.status}.`);
      const p = parseBytes(await r.arrayBuffer()); return p.ok ? out('ok', '', p.set, 'local test file') : out('invalid', p.message); }
    catch (e) { return out('error', `Local refs file could not be loaded: ${e.message}`); }
  }
  const fileId = L.get(REFS_FILE_ID_KEY);
  let cached = null; try { cached = store ? await store.getKv(REFS_CACHE_KEY) : null; } catch {}
  if (cached && cached.bytes && (!fileId || cached.fileId === fileId)) {
    const p = parseBytes(cached.bytes); if (p.ok) return out('ok', '', p.set, 'Google Drive (saved on this device)');
    try { await store.setKv(REFS_CACHE_KEY, null); } catch {}
  }
  const token = getToken();
  if (!token) return out('signed-out', 'Not signed in to Google. Sign in to load the cross-references file from your Drive.');
  if (!fileId) return out('choose', `No cross-references file chosen yet. Choose ${REFS_FILE_NAME} from your Drive.`);
  let r; try { r = await fetchImpl(`${DRIVE_FILES}${encodeURIComponent(fileId)}?alt=media`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }); }
  catch { return out('error', 'Could not reach Google Drive. Check the connection and try again.'); }
  if (r.status === 404 || r.status === 403) { L.del(REFS_FILE_ID_KEY); return out('choose', 'The cross-references file you chose before could not be opened. Please choose it again.'); }
  if (r.status === 401) return out('signed-out', 'Google sign-in expired. Sign in again.');
  if (!r.ok) return out('error', `Google Drive said ${r.status}. Try again later.`);
  const buf = await r.arrayBuffer(), p = parseBytes(buf);
  if (!p.ok) { L.del(REFS_FILE_ID_KEY); return out('invalid', `${p.message} Please choose the correct file.`); }
  try { if (store) await store.setKv(REFS_CACHE_KEY, { fileId, bytes: buf, savedAt: Date.now() }); } catch {}
  return out('ok', '', p.set, 'Google Drive');
}
export async function pickRefsFile({ token, localStorage = globalThis.localStorage, env } = {}) {
  const id = await pickTextFile({ token, env, mimeTypes: REFS_MIME, title: `Choose ${REFS_FILE_NAME} (cross-references)` });
  if (id) ls(localStorage).set(REFS_FILE_ID_KEY, id);
  return id;
}
export async function forgetRefsFile({ store, localStorage = globalThis.localStorage } = {}) {
  ls(localStorage).del(REFS_FILE_ID_KEY); try { if (store) await store.setKv(REFS_CACHE_KEY, null); } catch {}
}
// "Save for later": local only, no send route yet.
export const SAVED_KEY = 'kjv-site.xrefSaved.v1';
export function saveLinkForLater(link, localStorage = globalThis.localStorage) {
  const L = ls(localStorage); let a = []; try { a = JSON.parse(L.get(SAVED_KEY) || '[]'); } catch {}
  const item = { from: link.fromId, to: link.toId, toEnd: link.endId, votes: link.votes, label: `${link.fromRef} -> ${link.toRef}`, savedAt: new Date().toISOString() };
  a = a.filter(x => !(x.from === item.from && x.to === item.to && x.toEnd === item.toEnd)); a.unshift(item); a = a.slice(0, 200);
  L.set(SAVED_KEY, JSON.stringify(a)); return a;
}
export function savedLinks(localStorage = globalThis.localStorage) { try { return JSON.parse(ls(localStorage).get(SAVED_KEY) || '[]'); } catch { return []; } }
