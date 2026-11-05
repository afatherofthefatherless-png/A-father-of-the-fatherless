// Verse-text source (release 11): the CrossWire KJV text is hosted in this repo as data/kjv-crosswire.json and
// served with the site. Loading: data/manifest.json -> fetch data/kjv-crosswire.json (relative URL) -> sha256 against
// the manifest AND the pinned TEXT_SHA256 -> shape + 31,102 verses + ids -> TextSource. The checked bytes are cached in
// IndexedDB keyed by checksum (js/data/repo-data.js), so reloads work offline and the file downloads again only when
// the manifest checksum changes. No Google sign-in is involved.
// Shape: { "verses": [ { "id": "GEN.1.1", "read_aloud_text": "..." }, ... ] } with all 31,102 KJV verses.
import { TOTAL_VERSES } from './books.js';
import { parseId } from './ref.js';
import { sha256Hex } from '../stitch/hash.js';
import { loadDataFile } from '../data/repo-data.js';

// sha256 of data/kjv-crosswire.json (same bytes as /workspace/kjv-central/kjv-text-slim.json). Also pinned in
// data/manifest.json and scripts/check-no-kjv-text.py. Update all three together.
export const TEXT_SHA256 = '0641311bd4407628c34ce43e769c75c8a1e67b29490df207dde87a050d31c592';
export const TEXT_FILE = 'kjv-crosswire.json';
export const TEXT_MIME = 'application/json';

export const MESSAGES = Object.freeze({
  loading: 'Loading the verse text…',
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
  static fromJson(obj, label = 'this site') {
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
export async function checkTextBytes(buf, { expectedSha256 = TEXT_SHA256, expectedCount = TOTAL_VERSES, label = 'this site' } = {}) {
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

/**
 * Loads the verse text from this site's data/ folder (or the checked IndexedDB copy). Never throws.
 * Returns { source, status, message, from } with status 'ok' or 'error' (message says what failed; "Try again" reloads).
 * Injectable for tests: store (getKv/setKv), fetchImpl, base, expectedSha256.
 */
export async function loadTextSource({ store, fetchImpl = (...a) => globalThis.fetch(...a), base = '', expectedSha256 = TEXT_SHA256, expectedCount = TOTAL_VERSES } = {}) {
  const r = await loadDataFile(TEXT_FILE, { store, fetchImpl, base });
  if (!r.ok) return { source: new TextSource(), status: 'error', message: r.message };
  if (expectedSha256 && r.entry.sha256 !== expectedSha256) return { source: new TextSource(), status: 'error', message: `data/manifest.json lists a different checksum for ${TEXT_FILE} than this build expects; the text was not used.` };
  const c = await checkTextBytes(r.bytes, { expectedSha256, expectedCount, label: r.from === 'cache' ? 'this site (saved on this device)' : 'this site' });
  if (!c.ok) return { source: c.source, status: 'error', message: c.message };
  return { source: c.source, status: 'ok', message: r.warning || '', from: r.from };
}
