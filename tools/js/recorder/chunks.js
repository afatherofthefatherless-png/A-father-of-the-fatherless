// "Passages to record": the tracker's own chunks (plan videos), handed over in the Record link.
// The tracker (another origin, so no shared localStorage) adds two things to its Record link:
//   ?passage=<the row tapped>&next=<the tracker's NEXT plan video>&chunks=<n~ref|n~ref|...>
// chunks = the Not-recorded plan videos from the tracker's NEXT onwards (up to 25), in plan order, as plan number ~ reference.
// The recorder keeps the latest list in its own localStorage so it is still there when Record is opened without a link.
// The list itself stays the tracker's: nothing here changes the tracker's chunks or its progress.
import { parsePassage, formatPassage, expandPassage } from '../kjv/ref.js';

export const CHUNKS_KEY = 'kjv-site.trackerChunks.v1';
export const MAX_CHUNKS = 25;

/** 'n~ref|n~ref' -> [{ n, ref }] (bad entries dropped). */
export function parseChunkParam(s) {
  if (!s) return [];
  return String(s).split('|').map(x => x.trim()).filter(Boolean).slice(0, MAX_CHUNKS).map(x => {
    const i = x.indexOf('~'); return i > 0 ? { n: x.slice(0, i).trim(), ref: x.slice(i + 1).trim() } : { n: '', ref: x };
  }).filter(c => c.ref);
}
export function chunkParam(list) { return list.map(c => (c.n ? c.n + '~' : '') + c.ref).join('|'); }

/** Read the hand-off from the Record URL params and remember it. Returns the stored list (new or old) or null. */
export function takeHandoff(params, ls = globalThis.localStorage, now = Date.now()) {
  const raw = params && params.get('chunks');
  if (raw != null) {
    const list = parseChunkParam(raw), next = params.get('next') || (list[0] && list[0].ref) || '';
    const o = { receivedAt: now, next, chunks: list };
    try { ls && ls.setItem(CHUNKS_KEY, JSON.stringify(o)); } catch {}
    return o;
  }
  try { const o = JSON.parse(ls && ls.getItem(CHUNKS_KEY) || 'null'); return o && Array.isArray(o.chunks) ? o : null; } catch { return null; }
}

/** Status of each chunk on this device: how many of its verses have been sent (accepted take). */
export async function chunkStatuses(handoff, store) {
  const out = [];
  for (const c of (handoff ? handoff.chunks : [])) {
    let p = null, error = '', ids = [];
    try { p = parsePassage(c.ref); ids = expandPassage(p); } catch (e) { error = /Unknown book|Cannot read/.test(e.message) ? 'This plan video runs across two books. Record each book part on its own.' : e.message; }
    let sent = 0; for (const id of ids) if (await store.acceptedTake(id)) sent++;
    out.push({ n: c.n, ref: c.ref, passage: p ? formatPassage(p) : null, error, total: ids.length, sent, done: ids.length > 0 && sent === ids.length });
  }
  return out;
}

/** Which chunk is "Record this one next": the tracker's NEXT, unless every verse of it is already sent here; then the first one after it not done. */
export function nextChunkIndex(statuses, trackerNext) {
  const norm = r => { try { return formatPassage(parsePassage(r)); } catch { return r; } };
  const want = trackerNext ? norm(trackerNext) : null;
  let start = want ? statuses.findIndex(s => s.passage === want || s.ref === trackerNext) : 0;
  if (start < 0) start = 0;
  for (let i = start; i < statuses.length; i++) if (!statuses[i].done && !statuses[i].error) return i;
  for (let i = 0; i < start; i++) if (!statuses[i].done && !statuses[i].error) return i;
  return -1;
}
