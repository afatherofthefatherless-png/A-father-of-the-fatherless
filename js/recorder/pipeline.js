// Everything the page does by itself after Send, with one status line per stage (DOM-free, testable).
//   captured   WAV captured per verse (saved on this device as the verse's accepted take)
//   drive      each verse saved to Google Drive ('Genesis 3-14.wav', overwritten in place) by the upload queue
//   gate       StitchBot gate: PASS / WARN (needs your OK) / FAIL (re-record the verse it names)
//   stitched   verses joined in order with the fixed gap (STITCH.GAP_S, 0.4 s) -> '<stem>.wav' + '<stem>.timings.json'
//   queued     stitched WAV + timings saved to 'KJV Recordings/Stitched' and a render job written to
//              'KJV Recordings/Render jobs/<stem>.render-job.json' for the Rolling Reader renderer
//   rendered   MP4 rendered       -> always 'waiting for renderer': the renderer runs on Robin's computer and is not in this repo
//   mp4        MP4 on Drive       -> always 'waiting for renderer' (this site cannot see files it did not create, drive.file)
// Stage state: 'todo' | 'busy' | 'done' | 'warn' | 'bad' | 'wait' (wait = needs something outside the page: sign-in, an OK, the renderer).
import { expandPassage, fileNameOf, passageStem, refOf, formatPassage, parsePassage } from '../kjv/ref.js';
import { U } from './state.js';
import { stitchPassage } from '../stitch/stitch.js';
import { readerInfo, renderJob } from '../reader/handoff.js';
import { STITCH } from '../config.js';

export const STAGES = ['captured', 'drive', 'gate', 'stitched', 'queued', 'rendered', 'mp4'];
export const RENDERER_MISSING = 'waiting for renderer (runs on Robin\'s computer; not built yet, see README)';

export class PassagePipeline {
  constructor({ passage, store, drive = null, textSource = null, getToken = () => null, onUpdate = () => {}, now = () => new Date() }) {
    if (typeof passage === 'string') passage = parsePassage(passage);
    this.passage = passage; this.label = formatPassage(passage); this.ids = expandPassage(passage); this.stem = passageStem(passage);
    Object.assign(this, { store, drive, textSource, getToken, onUpdate, now });
    this.stage = Object.fromEntries(STAGES.map(s => [s, { state: 'todo', text: '' }]));
    this.stage.rendered = { state: 'wait', text: RENDERER_MISSING }; this.stage.mp4 = { state: 'wait', text: RENDERER_MISSING };
    this.result = null; this.gate = null; this.running = null; this.uploaded = null; this.job = null; this.acceptWarnings = false;
  }
  set(name, state, text) { this.stage[name] = { state, text }; this.onUpdate(this); }

  /** Re-read per-verse capture and Drive upload state from the store. */
  async refresh() {
    let captured = 0; const takeOf = {};
    for (const id of this.ids) { const t = await this.store.acceptedTake(id); if (t) { captured++; takeOf[id] = t.takeId; } }
    const n = this.ids.length;
    this.stage.captured = captured === n ? { state: 'done', text: `WAV captured for all ${n} verse${n > 1 ? 's' : ''}` }
      : { state: captured ? 'busy' : 'todo', text: `WAV captured: ${captured} of ${n} verses` };
    const ups = await this.store.allUploads().catch(() => []);
    const mine = ups.filter(u => takeOf[u.verseId] && u.takeId === takeOf[u.verseId]);
    const c = s => mine.filter(u => u.state === s).length;
    const done = c(U.UPLOADED), auth = c(U.AUTH_EXPIRED), failed = c(U.UPLOAD_FAILED), going = c(U.QUEUED) + c(U.UPLOADING);
    let st = 'todo', text = `Saved to Drive: ${done} of ${n} verses`;
    if (done === n) { st = 'done'; text = `Saved to Drive: all ${n} verse files (KJV Recordings/…/${fileNameOf(this.ids[0])}${n > 1 ? ' …' : ''})`; }
    else if (auth) { st = 'wait'; text += ` · ${auth} waiting for Google sign-in`; }
    else if (failed) { st = 'bad'; text += ` · ${failed} failed, retrying`; }
    else if (going) { st = 'busy'; text += ` · ${going} uploading`; }
    this.stage.drive = { state: st, text };
    this.onUpdate(this);
    return captured === n;
  }

  /** Run every stage the page can run. Safe to call again (after a sign-in, an OK, a re-record). */
  async run({ acceptWarnings = this.acceptWarnings, force = false } = {}) {
    if (this.running) return this.running;
    this.running = (async () => {
      const complete = await this.refresh();
      if (!complete) { this.set('gate', 'todo', 'Gate: runs by itself when every verse is sent'); this.set('stitched', 'todo', 'Stitch: after the gate'); this.set('queued', 'todo', 'Queued for Rolling Reader: after the stitch'); return; }
      if (force || !this.result) {
        this.result = null; this.uploaded = null; this.job = null;
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
        this.set('stitched', 'done', `Stitched: ${r.wavName} (${this.ids.length} verse${this.ids.length > 1 ? 's' : ''}, ${STITCH.GAP_S} s gap, ${(r.timings.total_samples / r.timings.sample_rate).toFixed(1)} s)`);
      }
      await this.upload();
    })().finally(() => { this.running = null; });
    return this.running;
  }

  /** Stitched WAV + timings to Drive, then the render-job JSON. Needs a sign-in (never asks for one itself). */
  async upload() {
    const r = this.result; if (!r || this.job) return;
    if (!this.drive || !this.getToken()) { this.set('queued', 'wait', 'Queued for Rolling Reader: waiting for Google sign-in (tap "Sign in to save to Drive")'); return; }
    try {
      this.set('queued', 'busy', 'Saving the stitched WAV and timings to Drive…');
      if (!this.uploaded) {
        const tj = new TextEncoder().encode(JSON.stringify(r.timings, null, 2));
        const w = await this.drive.uploadStitched(r.wavName, r.wav, 'audio/wav');
        const t = await this.drive.uploadStitched(r.timingsName, tj, 'application/json');
        this.uploaded = { wavFileId: w && w.id, timingsFileId: t && t.id };
      }
      const info = readerInfo(this.passage, r.timings, r.wavName, this.textSource);
      const job = renderJob({ passage: this.passage, stem: this.stem, wavName: r.wavName, timingsName: r.timingsName, ...this.uploaded, info, now: this.now() });
      const jobName = `${this.stem}.render-job.json`;
      await this.drive.putJson('Render jobs', jobName, job);
      this.job = { name: jobName, job };
      this.set('queued', 'done', `Queued for Rolling Reader: ${r.wavName} in KJV Recordings/Stitched, job file KJV Recordings/Render jobs/${jobName}`);
    } catch (e) {
      const auth = e && e.name === 'AuthExpiredError';
      this.set('queued', auth ? 'wait' : 'bad', auth ? 'Queued for Rolling Reader: sign-in expired, tap "Sign in to save to Drive"' : `Queued for Rolling Reader: Drive said ${e.message}. Tap "Try again".`);
    }
  }
}
