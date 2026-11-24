// Repo-hosted data loader: data/manifest.json -> fetch the file (plain relative URL, so it works under
// /A-father-of-the-fatherless/ on GitHub Pages and on localhost) -> sha256 check with WebCrypto -> IndexedDB cache
// keyed by checksum. A reload uses the cache (works offline); a file downloads again only when its manifest checksum changes.
import { sha256Hex } from '../stitch/hash.js';

export const DATA_DIR = 'data/';
export const MANIFEST_URL = DATA_DIR + 'manifest.json';
export const MANIFEST_KEY = 'repoData.manifest.v1';
export const cacheKey = name => 'repoData.file.v1:' + name;

const asBytes = buf => buf instanceof Uint8Array ? buf : new Uint8Array(buf);

/** Fetch the manifest (no-store so a new deploy is seen). Offline: fall back to the last manifest saved on this device. */
export async function loadManifest({ store, fetchImpl = globalThis.fetch, base = '' } = {}) {
  try {
    const res = await fetchImpl(base + MANIFEST_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const m = JSON.parse(new TextDecoder().decode(asBytes(await res.arrayBuffer())));
    if (!m || typeof m.files !== 'object') throw new Error('no "files" list');
    if (store) await store.setKv(MANIFEST_KEY, m).catch(() => {});
    return { ok: true, manifest: m, offline: false };
  } catch (e) {
    const saved = store ? await store.getKv(MANIFEST_KEY).catch(() => undefined) : undefined;
    if (saved) return { ok: true, manifest: saved, offline: true, warning: `Could not fetch ${MANIFEST_URL} (${e.message}); using the copy saved on this device.` };
    return { ok: false, message: `Could not load ${MANIFEST_URL}: ${e.message}. Check your connection and try again.` };
  }
}

/**
 * Get one data file's bytes, checked against the manifest's sha256.
 * Returns { ok:true, bytes, from:'cache'|'download', entry } or { ok:false, message }.
 */
export async function loadDataFile(name, { store, fetchImpl = globalThis.fetch, base = '', manifest } = {}) {
  let warning;
  if (!manifest) { const m = await loadManifest({ store, fetchImpl, base }); if (!m.ok) return m; manifest = m.manifest; warning = m.warning; }
  const entry = manifest.files && manifest.files[name];
  if (!entry || !/^[0-9a-f]{64}$/.test(entry.sha256 || '')) return { ok: false, message: `${MANIFEST_URL} has no checksum for ${name}.` };
  const key = cacheKey(name);
  const cached = store ? await store.getKv(key).catch(() => undefined) : undefined;
  if (cached && cached.sha256 === entry.sha256 && cached.bytes) {
    const b = asBytes(cached.bytes);
    if (await sha256Hex(b) === entry.sha256) return { ok: true, bytes: b, from: 'cache', entry, warning };
    await store.setKv(key, null).catch(() => {}); // damaged copy: drop it and download again
  }
  let res;
  try { res = await fetchImpl(base + DATA_DIR + name, { cache: 'no-cache' }); }
  catch (e) { return { ok: false, message: `Could not download ${DATA_DIR}${name}: ${e.message}. Check your connection and try again.` }; }
  if (!res.ok) return { ok: false, message: `Could not download ${DATA_DIR}${name} (HTTP ${res.status}).` };
  const bytes = asBytes(await res.arrayBuffer());
  const got = await sha256Hex(bytes);
  if (got !== entry.sha256) return { ok: false, message: `Checksum mismatch for ${DATA_DIR}${name}: expected ${entry.sha256.slice(0, 12)}…, got ${got.slice(0, 12)}…. The file was not used.` };
  if (store) await store.setKv(key, { sha256: entry.sha256, bytes, savedAt: Date.now() }).catch(() => {});
  return { ok: true, bytes, from: 'download', entry, warning };
}
