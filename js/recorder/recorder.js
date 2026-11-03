// Recorder controller: drives the state machine for one passage, one verse at a time.
// DOM-free; mic, store and upload queue are injected (tests use a fake mic with synthetic audio).
import { SAMPLE_RATE, ONSET } from '../config.js';
import { S, transition, firstUnsaved } from './state.js';
import { analyseTake, trimTake, calibrateFloor, LiveOnsetDetector } from './onset.js';
import { normalize } from './loudness.js';
import { encodeWav, decodeWav } from './wav.js';
import { checkVerse } from '../stitch/gate.js';
import { expandPassage, formatPassage } from '../kjv/ref.js';
import { MicDeniedError, resampleTo } from './capture.js';
import { StorageFullError } from '../store/db.js';

const concat = chunks => { const n = chunks.reduce((t, c) => t + c.length, 0), o = new Float32Array(n); let p = 0; for (const c of chunks) { o.set(c, p); p += c.length; } return o; };

export class Recorder {
  constructor({ passage, store, queue = null, openMic, textSource = null, onUpdate = () => {} }) {
    this.passage = formatPassage(passage); this.ids = expandPassage(passage);
    Object.assign(this, { store, queue, openMic, textSource, onUpdate });
    this.state = S.IDLE; this.index = 0; this.statuses = {}; this.gen = 0; this.mic = null; this.review = null; this.message = '';
  }
  get verseId() { return this.ids[this.index]; }
  emit() { this.onUpdate(this); }
  go(ev) { this.state = transition(this.state, ev); this.emit(); }
  async persist() { await this.store.saveSession({ passage: this.passage, ids: this.ids, statuses: this.statuses, index: this.index }); }

  /** Load or resume: restores statuses, moves to the first unsaved verse. */
  async load() {
    const s = await this.store.getSession(this.passage);
    if (s) this.statuses = s.statuses || {};
    for (const id of this.ids) if (!this.statuses[id] && await this.store.acceptedTake(id)) this.statuses[id] = S.SAVED;
    this.index = Math.min(firstUnsaved(this.ids, this.statuses), this.ids.length - 1);
    await this.persist(); this.emit(); return this;
  }
  get complete() { return this.ids.every(id => this.statuses[id] === S.SAVED); }

  async ensureMic() {
    if (this.mic) return this.mic;
    this.mic = await this.openMic({ onChunk: c => this.onChunk(c), onLost: why => this.onLost(why) });
    return this.mic;
  }
  onChunk(c) {
    if (this.state === S.ARMING) { this.cal.push(c); this.calN += c.length; if (this.calN >= this.mic.sampleRate * ONSET.calibrationS) this.finishArming(); }
    else if (this.state === S.ARMED) {
      this.ring.push(c); this.ringN += c.length; this.armN += c.length;
      while (this.ringN - this.ring[0].length > this.mic.sampleRate * ONSET.armRingS) { this.ringN -= this.ring.shift().length; }
      const on = this.live.push(c);
      if (on !== null) { this.startRecording(Math.max(0, on - Math.round(this.mic.sampleRate * ONSET.preRollMs * 2 / 1000)), 'onset'); }
    } else if (this.state === S.RECORDING) this.take.push(c);
  }
  onLost(why) {
    if ([S.ARMING, S.ARMED, S.RECORDING].includes(this.state)) { this.gen++; this.take = []; this.message = `Microphone lost (${why}). Tap Record to try again.`; this.go('miclost'); }
    this.mic = null;
  }

  /** IDLE/NO_SPEECH/... -> ARMING: open mic, 0.5 s noise calibration. */
  async record() {
    this.gen++; this.message = '';
    const ev = this.state === S.REVIEW || this.state === S.FAILED_CHECK || this.state === S.SAVED ? 'rerecord' : 'record';
    if (ev === 'rerecord' && this.review) { await this.store.putTake({ ...this.review, status: this.review.status === 'review' ? 'superseded' : this.review.status }); this.review = null; }
    this.go(ev); this.cal = []; this.calN = 0;
    try { await this.ensureMic(); }
    catch (e) { this.message = e instanceof MicDeniedError ? 'Microphone permission was denied. Allow it in Settings, then tap Record.' : `Microphone error: ${e.message}`; this.go('micdenied'); }
  }
  finishArming() {
    const cal = concat(this.cal); this.calibration = cal; this.floorDb = calibrateFloor(cal, this.mic.sampleRate);
    this.live = new LiveOnsetDetector(this.mic.sampleRate, this.floorDb); this.ring = []; this.ringN = 0; this.armN = 0;
    if (this.floorDb > -45) this.message = `Room is noisy (${this.floorDb.toFixed(0)} dBFS).`;
    this.go('armed');
  }
  /** ARMED -> RECORDING by tap (onset auto-detection does the same). */
  tapStart() { if (this.state === S.ARMED) this.startRecording(Math.max(0, this.armN - Math.round(this.mic.sampleRate * 0.3)), 'tap'); }
  startRecording(fromArmSample, ev) {
    // keep audio from the ring buffer, starting a little before the detected onset
    const ring = concat(this.ring), ringStart = this.armN - ring.length;
    this.take = [ring.subarray(Math.max(0, fromArmSample - ringStart))];
    this.go(ev);
  }
  /** RECORDING -> PROCESSING -> REVIEW | FAILED_CHECK | NO_SPEECH. */
  async stop({ auto = false } = {}) {
    if (this.state !== S.RECORDING) return;
    const g = this.gen; this.mic.flush && this.mic.flush();
    this.go(auto ? 'autostop' : 'stop');
    let raw = concat(this.take); this.take = [];
    let sr = this.mic.sampleRate, resampled = false, cal = this.calibration;
    if (sr !== SAMPLE_RATE) { raw = await resampleTo(raw, sr, SAMPLE_RATE); cal = await resampleTo(cal, sr, SAMPLE_RATE); sr = SAMPLE_RATE; resampled = true; }
    if (g !== this.gen) return;
    const r = await this.process(raw, sr, { calibration: cal, dropTailMs: auto ? 0 : ONSET.stopTapDropMs, resampled });
    if (g !== this.gen) return;
    await this.applyProcessed(r);
  }
  /** Pure-ish processing step (also used by tests). */
  async process(raw, sr, { calibration, dropTailMs = ONSET.stopTapDropMs, resampled = false } = {}) {
    const a = analyseTake(raw, sr, { calibration, dropTailMs });
    if (!a.speech) return { noSpeech: true };
    let run = 0, rawClipRun = 0; for (const v of raw) { if (Math.abs(v) >= 0.999) { run++; if (run > rawClipRun) rawClipRun = run; } else run = 0; }
    const trimmed = trimTake(raw, sr, a);
    const norm = normalize(trimmed, sr);
    const wav = encodeWav(norm.samples, sr);
    const words = this.textSource && this.textSource.loaded ? this.textSource.wordCount(this.verseId) : null;
    const checks = checkVerse(decodeWav(wav), { words, meta: { rawClipRun } });
    const fa = checks._analysis; delete checks._analysis;
    const hardFail = Object.values(checks).some(c => c.status === 'FAIL');
    const meta = { floorDb: a.floorDb, snrDb: a.snrDb, onsetInFileS: fa ? fa.onsetSample / sr : null, offsetInFileS: fa ? fa.offsetSample / sr : null,
      gainDb: norm.gainDb, lufs: norm.lufsAfter, limited: norm.limited, rawClipRun, resampled, durationS: norm.samples.length / sr };
    return { wav, checks, hardFail, meta };
  }
  async applyProcessed(r) {
    if (r.noSpeech) { this.message = 'No speech heard. Tap Record and read the verse.'; this.go('nospeech'); return; }
    const verseId = this.verseId, takeNo = await this.store.nextTakeNo(verseId);
    const take = { takeId: `${verseId}#${takeNo}`, verseId, takeNo, createdAt: Date.now(), status: r.hardFail ? 'failed' : 'review', wav: r.wav, checks: r.checks, meta: r.meta };
    try { await this.store.putTake(take); } catch (e) { if (e instanceof StorageFullError) { this.message = 'Device storage is full.'; this.state = S.STORAGE_FULL; this.emit(); return; } throw e; }
    this.review = take;
    this.go(r.hardFail ? 'failcheck' : 'processed');
  }
  /** REVIEW -> SAVING -> SAVED (upload queued) -> next verse IDLE. Older accepted takes are kept as 'superseded'. */
  async accept() {
    const take = this.review; if (!take) return;
    this.go('accept');
    try { await this.store.acceptTake(take.takeId); }
    catch (e) { if (e instanceof StorageFullError) { this.message = 'Device storage is full.'; this.go('storagefull'); return; } throw e; }
    this.statuses[take.verseId] = S.SAVED; await this.persist();
    this.go('saved'); this.review = null;
    if (this.queue) this.queue.enqueue({ ...take, status: 'accepted' }).catch(() => {});
    this.next();
  }
  async skip() {
    if (this.review) { await this.store.putTake({ ...this.review, status: 'superseded' }); this.review = null; }
    this.go('skip'); this.statuses[this.verseId] = this.statuses[this.verseId] === S.SAVED ? S.SAVED : S.SKIPPED; await this.persist(); this.next();
  }
  next() {
    if (this.state !== S.IDLE) this.go('next');
    const after = this.ids.findIndex((id, i) => i > this.index && this.statuses[id] !== S.SAVED);
    const any = firstUnsaved(this.ids, this.statuses);
    this.index = after >= 0 ? after : any < this.ids.length ? any : this.index;
    this.persist(); this.emit();
  }
  /** Jump to any verse (to redo it). */
  select(i) { this.state = transition(this.state, 'select'); this.index = i; this.review = null; this.message = ''; this.persist(); this.emit(); }
  async cancel() { this.gen++; this.take = []; if ([S.ARMING, S.ARMED, S.RECORDING].includes(this.state)) this.go('cancel'); }
  async close() { await this.cancel(); if (this.mic) await this.mic.close(); this.mic = null; }
}
