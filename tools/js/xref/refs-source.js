// Cross-references file loader (release 11): the OpenBible.info file (CC-BY) is hosted in this repo, unchanged, as
// data/openbible-cross-references.txt. Same route as the verse text: data/manifest.json -> relative fetch -> sha256
// check -> IndexedDB cache keyed by checksum (js/data/repo-data.js) -> parsed in the browser. No Google sign-in.
// Local development/tests only: ?refs=<relative path> on localhost/127.0.0.1 loads a (synthetic) file instead.
import { parseRefs } from './xrefs.js';
import { loadDataFile } from '../data/repo-data.js';

export const REFS_FILE_NAME = 'openbible-cross-references.txt';

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
/** Never throws. Returns { set, status, message, from }; status: 'ok' | 'invalid' | 'error'. */
export async function loadRefs({ store, fetchImpl = (...a) => globalThis.fetch(...a), base = '', devUrl = null } = {}) {
  const out = (status, message, set = null, from = '') => ({ status, message, set, from });
  if (devUrl) {
    try { const r = await fetchImpl(devUrl, { cache: 'no-store' }); if (!r.ok) return out('error', `Local refs file said ${r.status}.`);
      const p = parseBytes(await r.arrayBuffer()); return p.ok ? out('ok', '', p.set, 'local test file') : out('invalid', p.message); }
    catch (e) { return out('error', `Local refs file could not be loaded: ${e.message}`); }
  }
  const r = await loadDataFile(REFS_FILE_NAME, { store, fetchImpl, base });
  if (!r.ok) return out('error', r.message);
  const p = parseBytes(r.bytes);
  if (!p.ok) return out('invalid', `data/${REFS_FILE_NAME} could not be read: ${p.message}`);
  return out('ok', r.warning || '', p.set, r.from === 'cache' ? 'this site (saved on this device)' : 'this site');
}
