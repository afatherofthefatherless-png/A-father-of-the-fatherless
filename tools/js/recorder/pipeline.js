// Everything the page does by itself after Send, with one status line per stage (DOM-free, testable). Release 12: all local.
//   captured   WAV captured per verse (kept on this device, IndexedDB, as the verse's one take)
//   saved      each verse downloaded to this device as 'Genesis 3-14.wav' (Save again repeats it from the stored take)
//   gate       StitchBot gate: PASS / WARN (needs your OK) / FAIL (re-record the verse it names)
//   stitched   verses joined in order with the fixed gap (STITCH.GAP_S, 0.4 s) -> '<stem>.wav' + '<stem>.timings.json',
//              both downloaded to this device
//   rendered   MP4 rendered -> always 'waiting for renderer': there is no renderer in this repo
//   mp4        MP4 saved    -> always 'waiting for renderer'. Only audio exists; no video is ever claimed as saved.
// The render-job JSON of releases 7-11 (a Drive file for the renderer) is dropped: nothing reads it.
// Stage state: 'todo' | 'busy' | 'done' | 'warn' | 'bad' | 'wait' (wait = needs something outside the page: an OK, the renderer).
import { expandPassage, fileNameOf, passageStem, refOf, formatPassage, parsePassage } from '../kjv/ref.js';
import { stitchPassage } from '../stitch/stitch.js';
import { STITCH } from '../config.js';
import { SAVED_KEY } from '../save/device-save.js';

export const STAGES = ['captured', 'saved', 'gate', 'stitched', 'rendered', 'mp4'];
export const RENDERER_MISSING = 'waiting for renderer (not built yet, see README). Only the audio exists.';

export class PassagePipeline {
  /** save: (name, bytes, type) => result, used for the stitched WAV and timings (js/save/device-save.js saveFile in the page). */
  constructor({ passage, store, save = null, textSource = null, onUpdate = () => {}, now = () => new Date() }) {
    if (typeof passage === 'string') passage = parsePassage(passage);
    this.passage = passage; this.label = formatPassage(passage); this.ids = expandPassage(passage); this.stem = passageStem(passage);
    Object.assign(this, { store, save, textSource, onUpdate, now });
    this.stage = Object.fromEntries(STAGES.map(s => [s, { state: 'todo', text: '' }]));
    this.stage.rendered = { state: 'wait', text: RENDERER_MISSING }; this.stage.mp4 = { state: 'wait', text: RENDERER_MISSING };
    this.result = null; this.gate = null; this.running = null; this.downloaded = null; this.acceptWarnings = false;
  }
  set(name, state, text) { this.stage[name] = { state, text }; this.onUpdate(this); }

  /** Re-read per-verse capture and device-save state from the store. */
  async refresh() {
    let captured = 0, saved = 0;
    for (const id of this.ids) {
      const t = await this.store.acceptedTake(id); if (!t) continue; captured++;
      const s = await this.store.getKv(SAVED_KEY + id).catch(() => null); if (s && s.takeId === t.takeId) saved++;
    }
    const n = this.ids.length;
    this.stage.captured = captured === n ? { state: 'done', text: `WAV captured for all ${n} verse${n > 1 ? 's' : ''} (kept on this device)` }
      : { state: captured ? 'busy' : 'todo', text: `WAV captured: ${captured} of ${n} verses` };
    this.stage.saved = saved === n ? { state: 'done', text: `Saved to this device: all ${n} verse file${n > 1 ? 's' : ''} (${fileNameOf(this.ids[0])}${n > 1 ? ' …' : ''})` }
      : { state: captured > saved ? 'warn' : 'todo', text: `Saved to this device: ${saved} of ${n} verse files` + (captured > saved ? ' · tap Save again on a verse whose download did not start' : '') };
    this.onUpdate(this);
    return captured === n;
  }

  /** Run every stage the page can run. Safe to call again (after an OK, a re-record). */
  async run({ acceptWarnings = this.acceptWarnings, force = false } = {}) {
    if (this.running) return this.running;
    this.running = (async () => {
      const complete = await this.refresh();
      if (!complete) { this.set('gate', 'todo', 'Gate: runs by itself when every verse is sent'); this.set('stitched', 'todo', 'Stitch: after the gate'); return; }
      if (force || !this.result) {
        this.result = null; this.downloaded = null;
        this.set('gate', 'busy', 'Gate: checking every verse…');
        const files = new Map();
        for (const id of this.ids) { const t = await this.store.acceptedTake(id); files.set(fileNameOf(id), t.wav); }
        const r = await stitchPassage(this.passage, files, { acceptWarnings, textSource: this.textSource && this.textSource.loaded ? this.textSource : null });
        this.gate = r.gate;
        const vst = v => { const s = Object.values(v.checks || {}).map(c => c.status); return s.includes('FAIL') ? 'FAIL' : s.includes('WARN') ? 'WARN' : 'PASS'; };
        const bad = (r.gate.verses || []).filter(v => vst(v) === 'FAIL').map(v => refOf(v.id));
        const warn = (r.gate.verses || []).filter(v => vst(v) === 'WARN').map(v => refOf(v.id));
        if (r.gate.overall === 'FAIL') { this.set('gate', 'bad', `Gate: FAIL${bad.length ? ' – re-record ' + bad.join(', ') : ''}`); this.set('stitched', 'todo', 'Stitch: blocked by the gate'); return; }
        if (r.blocked) { this.set('gate', 'wait', `Gate: WARN${warn.length ? ' on ' + warn.join(', ') : ''} – listen, then tap "OK the warnings"`); this.set('stitched', 'todo', 'Stitch: waiting for your OK'); return; }
        this.set('gate', r.gate.overall === 'WARN' ? 'warn' : 'done', r.gate.overall === 'WARN' ? `Gate: WARN accepted (${warn.join(', ')})` : 'Gate: PASS');
        this.result = r;
      }
      await this.download();
    })().finally(() => { this.running = null; });
    return this.running;
  }

  /** Download the stitched WAV and its timings to this device (once per stitch; card 3 has the buttons to do it again). */
  async download() {
    const r = this.result; if (!r) return;
    const what = `Stitched: ${r.wavName} (${this.ids.length} verse${this.ids.length > 1 ? 's' : ''}, ${STITCH.GAP_S} s gap, ${(r.timings.total_samples / r.timings.sample_rate).toFixed(1)} s)`;
    if (this.downloaded) return;
    if (!this.save) { this.set('stitched', 'done', `${what} · use Download in card 3 to save it`); return; }
    try {
      await this.save(r.wavName, r.wav, 'audio/wav');
      await this.save(r.timingsName, new TextEncoder().encode(JSON.stringify(r.timings, null, 2)), 'application/json');
      this.downloaded = { at: this.now() };
      this.set('stitched', 'done', `${what} · saved to this device with ${r.timingsName}`);
    } catch (e) { this.set('stitched', 'warn', `${what} · the download did not start (${e.message}); use Download in card 3`); }
  }
}
