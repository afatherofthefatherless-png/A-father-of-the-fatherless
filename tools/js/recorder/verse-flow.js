// Old-recorder flow, one file per verse (Robin's sticky note):
//   the passage arrives (Reading Tracker link ?passage=...), then for each verse: Record -> Stop -> Send.
//   Record starts capturing at once (the old Voice Recorder's behaviour: no "listening to the room" step).
//   Stop runs "Snip Snip" on that verse: find the real voice start and end, trim, add the fixed padding back
//   (onset.js rules: 150 ms before the voice, 250 ms after it, 10 ms / 30 ms fades), then -16 LUFS and the checks.
//   Send captures the WAV: it is saved on this device as the verse's accepted take (IndexedDB) and downloaded as
//   'Genesis 3-14.wav' (colon -> hyphen). A retake replaces the stored take and downloads under the same name.
//   Pressing Record (or Re-record) again throws away the take that has not been sent and records the verse again.
//   After Send the recorder moves to the next verse. When every verse is sent, StitchBot joins them (card 2).
// DOM-free; mic, store and device saver are injected, exactly like recorder.js, so tests drive it with a fake mic.
import { SAMPLE_RATE, ONSET } from '../config.js';
import { S, firstUnsaved } from './state.js';
import { analyseTake, trimTake } from './onset.js';
import { normalize } from './loudness.js';
import { encodeWav, decodeWav } from './wav.js';
import { checkVerse } from '../stitch/gate.js';
import { expandPassage, formatPassage, fileNameOf, refOf } from '../kjv/ref.js';
import { MicDeniedError, resampleTo } from './capture.js';
import { StorageFullError } from '../store/db.js';

/** States of the verse in front of you. 'SAVED' means sent (saved on this device), as elsewhere in the site. */
export const V = Object.freeze({
  IDLE: 'IDLE', STARTING: 'STARTING', RECORDING: 'RECORDING', PROCESSING: 'PROCESSING', READY: 'READY',
  FAILED_CHECK: 'FAILED_CHECK', NO_SPEECH: 'NO_SPEECH', SENDING: 'SENDING', SAVED: S.SAVED,
  MIC_DENIED: 'MIC_DENIED', MIC_LOST: 'MIC_LOST', STORAGE_FULL: 'STORAGE_FULL',
});
const T = {
  IDLE:         { record: 'STARTING' },
  STARTING:     { started: 'RECORDING', micdenied: 'MIC_DENIED', cancel: 'IDLE' },
  RECORDING:    { stop: 'PROCESSING', record: 'STARTING', miclost: 'MIC_LOST', cancel: 'IDLE' },
  PROCESSING:   { ready: 'READY', failcheck: 'FAILED_CHECK', nospeech: 'NO_SPEECH' },
  READY:        { send: 'SENDING', record: 'STARTING' },
  FAILED_CHECK: { record: 'STARTING' },
  NO_SPEECH:    { record: 'STARTING' },
  SENDING:      { sent: 'SAVED', storagefull: 'STORAGE_FULL' },
  SAVED:        { next: 'IDLE', record: 'STARTING' },
  MIC_DENIED:   { record: 'STARTING' },
  MIC_LOST:     { record: 'STARTING' },
  STORAGE_FULL: { send: 'SENDING', record: 'STARTING' },
};
const SETTLED = new Set(['IDLE', 'READY', 'FAILED_CHECK', 'NO_SPEECH', 'SAVED', 'MIC_DENIED', 'MIC_LOST', 'STORAGE_FULL']);
export function vTransition(state, event) {
  if (event === 'select') { if (SETTLED.has(state)) return 'IDLE'; throw new Error(`Cannot jump to another verse while ${state}`); }
  const next = T[state] && T[state][event];
  if (!next) throw new Error(`Illegal event "${event}" in state ${state}`);
  return next;
}

const concat = chunks => { const n = chunks.reduce((t, c) => t + c.length, 0), o = new Float32Array(n); let p = 0; for (const c of chunks) { o.set(c, p); p += c.length; } return o; };

/**
 * Snip Snip for one verse take. Pure (no store, no DOM): raw Float32 mono at sr -> trimmed, padded, -16 LUFS WAV + checks.
 * Without a calibration the room floor is taken from the take itself (the quiet part before you start reading).
 */
export function snipVerse(raw, sr, { calibration = null, dropTailMs = ONSET.stopTapDropMs, words = null, resampled = false } = {}) {
  const a = analyseTake(raw, sr, { calibration, dropTailMs });
  if (!a.speech) return { noSpeech: true };
  let run = 0, rawClipRun = 0; for (const v of raw) { if (Math.abs(v) >= 0.999) { run++; if (run > rawClipRun) rawClipRun = run; } else run = 0; }
  const trimmed = trimTake(raw, sr, a);
  const norm = normalize(trimmed, sr);
  const wav = encodeWav(norm.samples, sr);
  const checks = checkVerse(decodeWav(wav), { words, meta: { rawClipRun } });
  const fa = checks._analysis; delete checks._analysis;
  const hardFail = Object.values(checks).some(c => c.status === 'FAIL');
  const meta = { floorDb: a.floorDb, snrDb: a.snrDb, rawS: raw.length / sr, trimStartS: a.trimStart / sr, trimEndS: a.trimEnd / sr,
    onsetInFileS: fa ? fa.onsetSample / sr : null, offsetInFileS: fa ? fa.offsetSample / sr : null,
    gainDb: norm.gainDb, lufs: norm.lufsAfter, limited: norm.limited, rawClipRun, resampled, durationS: norm.samples.length / sr };
  return { wav, checks, hardFail, meta };
}

export class VerseRecorder {
  constructor({ passage, store, saver = null, openMic, textSource = null, onUpdate = () => {}, flushWaitMs = 80 }) {
    this.passage = formatPassage(passage); this.ids = expandPassage(passage);
    Object.assign(this, { store, saver, openMic, textSource, onUpdate, flushWaitMs });
    this.state = V.IDLE; this.index = 0; this.statuses = {}; this.gen = 0; this.mic = null; this.take = null;
    this.chunks = []; this.collecting = false; this.message = ''; this.startedAt = 0; this.lastSave = null;
  }
  get verseId() { return this.ids[this.index]; }
  get fileName() { return fileNameOf(this.verseId); }
  get ref() { return refOf(this.verseId); }
  get complete() { return this.ids.every(id => this.statuses[id] === S.SAVED); }
  get sentCount() { return this.ids.filter(id => this.statuses[id] === S.SAVED).length; }
  emit() { this.onUpdate(this); }
  go(ev) { this.state = vTransition(this.state, ev); this.emit(); }
  async persist() { await this.store.saveSession({ passage: this.passage, ids: this.ids, statuses: this.statuses, index: this.index }); }

  /** Load or resume: a verse with an accepted take counts as sent; start at the first verse not sent yet. */
  async load() {
    const s = await this.store.getSession(this.passage);
    if (s && s.statuses) for (const [k, v] of Object.entries(s.statuses)) if (v === S.SAVED) this.statuses[k] = S.SAVED;
    for (const id of this.ids) if (!this.statuses[id] && await this.store.acceptedTake(id)) this.statuses[id] = S.SAVED;
    this.index = Math.min(firstUnsaved(this.ids, this.statuses), this.ids.length - 1);
    if (this.statuses[this.verseId] === S.SAVED) this.state = V.SAVED;
    await this.persist(); this.emit(); return this;
  }

  async ensureMic() {
    if (this.mic) return this.mic;
    this.mic = await this.openMic({ onChunk: c => { if (this.collecting) this.chunks.push(c); }, onLost: why => this.onLost(why) });
    return this.mic;
  }
  onLost(why) {
    this.mic = null;
    if (this.state === V.RECORDING || this.state === V.STARTING) { this.gen++; this.collecting = false; this.chunks = []; this.message = `Microphone lost (${why}). Tap Record to try again.`; this.go('miclost'); }
  }

  /** Record (and Re-record): throw away any take not sent yet, then record this verse again at once. */
  async record() {
    if (this.state === V.PROCESSING || this.state === V.SENDING) return;
    const g = ++this.gen; this.message = ''; this.take = null; this.collecting = false; this.chunks = [];
    this.go('record');
    try { await this.ensureMic(); }
    catch (e) {
      if (g !== this.gen) return;
      this.message = e instanceof MicDeniedError ? 'Could not use the microphone. Allow microphone access for this page and try again.' : `Could not use the microphone (${e.message}).`;
      this.go('micdenied'); return;
    }
    if (g !== this.gen) return;
    this.chunks = []; this.collecting = true; this.startedAt = Date.now();
    this.go('started');
  }
  /** Stop -> Snip Snip -> READY (listen back, then Send) | FAILED_CHECK | NO_SPEECH. */
  async stop() {
    if (this.state !== V.RECORDING) return;
    const g = this.gen; this.mic.flush && this.mic.flush();
    this.go('stop');
    if (this.flushWaitMs) await new Promise(r => setTimeout(r, this.flushWaitMs)); // let the last block arrive
    this.collecting = false;
    let raw = concat(this.chunks); this.chunks = [];
    let sr = this.mic ? this.mic.sampleRate : SAMPLE_RATE, resampled = false;
    if (sr !== SAMPLE_RATE) { raw = await resampleTo(raw, sr, SAMPLE_RATE); sr = SAMPLE_RATE; resampled = true; }
    if (g !== this.gen) return;
    const words = this.textSource && this.textSource.loaded ? this.textSource.wordCount(this.verseId) : null;
    const r = snipVerse(raw, sr, { words, resampled });
    if (g !== this.gen) return;
    if (r.noSpeech) { this.message = 'No speech heard. Tap Record and read the verse.'; this.go('nospeech'); return; }
    const verseId = this.verseId;
    this.take = { verseId, createdAt: Date.now(), status: r.hardFail ? 'failed' : 'review', wav: r.wav, checks: r.checks, meta: r.meta, fileName: fileNameOf(verseId) };
    if (r.hardFail) this.message = 'This take failed a check (see below). Tap Re-record and read the verse again.';
    this.go(r.hardFail ? 'failcheck' : 'ready');
  }
  /** Send: keep the WAV as this verse's take (one per verse), download it as 'Book C-V.wav', go to the next verse. */
  async send() {
    const take = this.take; if (!take || (this.state !== V.READY && this.state !== V.STORAGE_FULL)) return;
    this.go('send');
    const takeNo = await this.store.nextTakeNo(take.verseId);
    const saved = { ...take, takeId: `${take.verseId}#${takeNo}`, takeNo, status: 'review' };
    try { await this.store.putTake(saved); await this.store.acceptTake(saved.takeId); }
    catch (e) { if (e instanceof StorageFullError) { this.message = 'Device storage is full.'; this.go('storagefull'); return; } throw e; }
    this.statuses[take.verseId] = S.SAVED; this.take = null; this.lastSent = { ...saved, status: 'accepted' };
    await this.persist();
    this.go('sent');
    if (this.saver) { this.lastSave = await this.saver.saveTake(this.lastSent); if (!this.lastSave.ok) this.message = `Kept on this device, but the download did not start (${this.lastSave.message}). Tap Save again.`; }
    this.next();
  }
  /** Move on to the next verse not sent yet (or stay on the last one when all are sent). */
  next() {
    const after = this.ids.findIndex((id, i) => i > this.index && this.statuses[id] !== S.SAVED);
    const any = firstUnsaved(this.ids, this.statuses);
    const to = after >= 0 ? after : any < this.ids.length ? any : this.index;
    if (to !== this.index) { this.index = to; this.state = vTransition(this.state, 'next'); }
    this.persist(); this.emit();
  }
  /** Jump to any verse (to hear it again or record it again). */
  select(i) {
    if (i === this.index && this.state !== V.SAVED) return;
    this.state = vTransition(this.state, 'select'); this.index = i; this.take = null; this.message = '';
    if (this.statuses[this.verseId] === S.SAVED) this.state = V.SAVED;
    this.persist(); this.emit();
  }
  async cancel() { this.gen++; this.collecting = false; this.chunks = []; if (this.state === V.RECORDING || this.state === V.STARTING) this.go('cancel'); }
  async close() { await this.cancel(); if (this.mic) await this.mic.close(); this.mic = null; }
}
