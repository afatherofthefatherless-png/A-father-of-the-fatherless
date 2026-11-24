// Onset/offset detection for one-verse takes (PLAN.md section d). Pure, no DOM.
// Offline analysis of the whole take is authoritative; LiveOnsetDetector is used only to auto-start RECORDING while ARMED.
import { ONSET } from '../config.js';

const EPS = 1e-12;
const toDb = ms => 10 * Math.log10(ms + EPS);

/** Frame RMS dBFS and zero-crossing rate: 20 ms frames on a 10 ms hop (frame i starts at i*hop). */
export function frameFeatures(samples, sr, { frameMs = ONSET.frameMs, hopMs = ONSET.hopMs } = {}) {
  const frame = Math.round(sr * frameMs / 1000), hop = Math.round(sr * hopMs / 1000);
  const n = samples.length < frame ? (samples.length ? 1 : 0) : Math.floor((samples.length - frame) / hop) + 1;
  const db = new Float32Array(n), zcr = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    const s = f * hop, e = Math.min(s + frame, samples.length); let acc = 0, zc = 0;
    for (let i = s; i < e; i++) { acc += samples[i] * samples[i]; if (i > s && (samples[i] >= 0) !== (samples[i - 1] >= 0)) zc++; }
    db[f] = toDb(acc / Math.max(1, e - s)); zcr[f] = zc / Math.max(1, e - s - 1);
  }
  return { db, zcr, frame, hop };
}

export function percentile(arr, p) {
  const a = Array.from(arr).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return -120;
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p / 100 * a.length)))];
}

/** Noise floor (dBFS) from calibration audio: 10th percentile of frame levels, ignoring digital silence. */
export function calibrateFloor(samples, sr) {
  const { db } = frameFeatures(samples, sr);
  const live = Array.from(db).filter(v => v > -110);
  return live.length ? percentile(live, ONSET.floorPercentile) : -110;
}

/**
 * Analyse a take.
 * opts.calibration: Float32Array of room noise (from ARMING); else the floor is estimated from the take itself.
 * opts.dropTailMs: drop this much from the end before analysis (Stop-tap noise).
 * Returns { speech, onsetSample, offsetSample, trimStart, trimEnd, floorDb, onDb, offDb, speechDb, snrDb,
 *           longestInternalSilenceS, endedEarly, segments:[{start,end}] } (samples). speech=false => NO_SPEECH.
 */
export function analyseTake(samples, sr, opts = {}) {
  const C = { ...ONSET, ...(opts.params || {}) };
  const usable = opts.dropTailMs ? Math.max(0, samples.length - Math.round(sr * opts.dropTailMs / 1000)) : samples.length;
  const x = usable < samples.length ? samples.subarray(0, usable) : samples;
  const { db, hop, frame } = frameFeatures(x, sr, C);
  const n = db.length;
  let floor0 = opts.calibration && opts.calibration.length ? calibrateFloor(opts.calibration, sr)
    : percentile(Array.from(db).filter(v => v > -110), C.floorPercentile);
  if (!Number.isFinite(floor0)) floor0 = -110;

  // adaptive floor: slow EMA, updated only by frames below floor + 3 dB
  const floor = new Float32Array(n); let fl = floor0;
  for (let i = 0; i < n; i++) { if (db[i] < fl + C.floorUpdateDb) fl = fl * (1 - C.floorEmaAlpha) + db[i] * C.floorEmaAlpha; floor[i] = fl; }
  const onT = i => Math.max(floor[i] + C.onAboveFloorDb, C.onMinDbfs);
  const offT = i => floor[i] + C.offAboveFloorDb;

  const need = Math.round(C.confirmMs / C.hopMs), win = Math.round(C.confirmWindowMs / C.hopMs);
  const back = Math.round(C.backtrackMaxMs / C.hopMs), silFrames = Math.round(C.offsetSilenceMs / C.hopMs);
  const segments = [];
  let i = 0;
  while (i < n) {
    if (db[i] < onT(i)) { i++; continue; }
    // confirm: >= need frames above on-threshold within the window
    let cnt = 0; for (let j = i; j < Math.min(n, i + win); j++) if (db[j] >= onT(j)) cnt++;
    if (cnt < need) { i++; continue; }
    // backtrack to first frame > floor + 3 dB (bounded), but not into the previous segment
    let s = i; const lim = Math.max(0, i - back, segments.length ? segments[segments.length - 1].endF + 1 : 0);
    while (s - 1 >= lim && db[s - 1] > floor[s - 1] + C.backtrackDb) s--;
    // extend while above off-threshold (hysteresis)
    let e = i; while (e + 1 < n && db[e + 1] >= offT(e + 1)) e++;
    segments.push({ startF: s, endF: e });
    i = e + 1;
  }
  const base = { floorDb: floor0, onDb: Math.max(floor0 + C.onAboveFloorDb, C.onMinDbfs), offDb: floor0 + C.offAboveFloorDb, frames: n, hop, frame };
  if (!segments.length) return { ...base, speech: false, segments: [], onsetSample: null, offsetSample: null, trimStart: 0, trimEnd: 0, speechDb: null, snrDb: null, longestInternalSilenceS: 0, endedEarly: false };

  const first = segments[0], last = segments[segments.length - 1];
  const onsetSample = first.startF * hop;
  const offsetSample = Math.min(x.length, last.endF * hop + frame);
  let longest = 0;
  for (let k = 1; k < segments.length; k++) longest = Math.max(longest, (segments[k].startF - segments[k - 1].endF - 1) * hop);
  const speechFrames = []; for (const sg of segments) for (let f = sg.startF; f <= sg.endF; f++) speechFrames.push(db[f]);
  const speechDb = percentile(speechFrames, 95);
  const trimStart = Math.max(0, onsetSample - Math.round(sr * C.preRollMs / 1000));
  const trimEnd = Math.min(x.length, offsetSample + Math.round(sr * C.tailMs / 1000));
  return {
    ...base, speech: true,
    segments: segments.map(s => ({ start: s.startF * hop, end: Math.min(x.length, s.endF * hop + frame) })),
    onsetSample, offsetSample, trimStart, trimEnd, speechDb, snrDb: speechDb - floor0,
    longestInternalSilenceS: longest / sr,
    endedEarly: (n - 1 - last.endF) < silFrames, // fewer than 700 ms of silence after the last speech
  };
}

/** Cut the take to [trimStart, trimEnd) with a 10 ms fade-in and 30 ms fade-out. */
export function trimTake(samples, sr, a, { fadeInMs = ONSET.fadeInMs, fadeOutMs = ONSET.fadeOutMs } = {}) {
  const out = samples.slice(a.trimStart, a.trimEnd);
  const fi = Math.min(out.length, Math.round(sr * fadeInMs / 1000)), fo = Math.min(out.length, Math.round(sr * fadeOutMs / 1000));
  for (let i = 0; i < fi; i++) out[i] *= i / fi;
  for (let i = 0; i < fo; i++) out[out.length - 1 - i] *= i / fo;
  return out;
}

/** Streaming detector for ARMED -> RECORDING. push(chunk) returns the absolute sample index of the onset once confirmed, else null. */
export class LiveOnsetDetector {
  constructor(sr, floorDb, params = {}) {
    this.C = { ...ONSET, ...params }; this.sr = sr; this.floor = floorDb;
    this.hop = Math.round(sr * this.C.hopMs / 1000); this.frameLen = Math.round(sr * this.C.frameMs / 1000);
    this.buf = new Float32Array(0); this.pos = 0; this.frames = []; this.done = false;
  }
  push(chunk) {
    if (this.done) return null;
    const nb = new Float32Array(this.buf.length + chunk.length); nb.set(this.buf); nb.set(chunk, this.buf.length); this.buf = nb;
    const C = this.C, need = Math.round(C.confirmMs / C.hopMs), win = Math.round(C.confirmWindowMs / C.hopMs), back = Math.round(C.backtrackMaxMs / C.hopMs);
    while (this.buf.length >= this.frameLen) {
      let acc = 0; for (let i = 0; i < this.frameLen; i++) acc += this.buf[i] * this.buf[i];
      const d = toDb(acc / this.frameLen);
      if (d < this.floor + C.floorUpdateDb) this.floor = this.floor * (1 - C.floorEmaAlpha) + d * C.floorEmaAlpha;
      this.frames.push({ d, on: d >= Math.max(this.floor + C.onAboveFloorDb, C.onMinDbfs), bt: d > this.floor + C.backtrackDb });
      this.buf = this.buf.slice(this.hop); this.pos++;
      const f = this.frames, n = f.length;
      if (n >= win) {
        const s0 = n - win;
        if (f[s0].on) {
          let cnt = 0; for (let j = s0; j < n; j++) if (f[j].on) cnt++;
          if (cnt >= need) {
            let s = s0; while (s - 1 >= Math.max(0, s0 - back) && f[s - 1].bt) s--;
            this.done = true; return s * this.hop;
          }
        }
      }
    }
    return null;
  }
}
