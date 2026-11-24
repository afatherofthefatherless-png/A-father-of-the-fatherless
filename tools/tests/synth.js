// Synthetic "speech-like" audio for tests. No real voice, no Bible audio.
// Words = voiced bursts (harmonic stack on a 110-180 Hz fundamental with a syllable envelope) plus optional fricative
// (high-passed noise) starts; background = white noise at a chosen dBFS; also clicks and breaths.
export const SR = 48000;
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const dbToAmp = db => Math.pow(10, db / 20);

export class Synth {
  constructor({ sr = SR, seed = 7, noiseDb = -65 } = {}) { this.sr = sr; this.r = rng(seed); this.noiseDb = noiseDb; this.parts = []; this.len = 0; }
  silence(s) { this.parts.push({ t: 'sil', n: Math.round(s * this.sr) }); this.len += Math.round(s * this.sr); return this; }
  /** A word: duration s, level dBFS (RMS-ish), fricative start? */
  word(s, db = -22, { fricative = false } = {}) { const n = Math.round(s * this.sr); this.parts.push({ t: 'word', n, db, fricative }); this.len += n; return this; }
  /** n words separated by short gaps (a phrase). */
  phrase(words, { db = -22, gap = 0.06, wordS = 0.22 } = {}) {
    for (let i = 0; i < words; i++) { this.word(wordS * (0.7 + 0.6 * this.r()), db + (this.r() * 4 - 2)); if (i < words - 1) this.silence(gap * (0.5 + this.r())); }
    return this;
  }
  click(ms = 20, db = -10) { const n = Math.round(ms / 1000 * this.sr); this.parts.push({ t: 'click', n, db }); this.len += n; return this; }
  breath(s = 0.3, db = -48) { const n = Math.round(s * this.sr); this.parts.push({ t: 'breath', n, db }); this.len += n; return this; }
  render() {
    const out = new Float32Array(this.len), r = this.r, sr = this.sr; let p = 0;
    const na = dbToAmp(this.noiseDb) * Math.sqrt(3);
    for (let i = 0; i < out.length; i++) out[i] = (r() * 2 - 1) * na;
    const wordStarts = [];
    for (const part of this.parts) {
      const { n } = part;
      if (part.t === 'word') {
        wordStarts.push(p);
        const f0 = 110 + 70 * r(), a = dbToAmp(part.db) * 3.2; let ph = 0; // a: scaled so a word RMS is close to db
        for (let i = 0; i < n; i++) {
          const x = i / n, env = Math.sin(Math.PI * Math.min(1, x * 1.15)) ** 0.6 * (0.75 + 0.25 * Math.sin(2 * Math.PI * 4.5 * i / sr));
          ph += 2 * Math.PI * f0 * (1 + 0.03 * Math.sin(2 * Math.PI * 3 * i / sr)) / sr;
          let v = 0; for (let k = 1; k <= 8; k++) v += Math.sin(k * ph) / k;
          let s = v * 0.45 * env * a;
          if (part.fricative && i < 0.08 * sr) s = (r() * 2 - 1) * a * 0.3 * Math.min(1, i / (0.01 * sr)); // 's'/'wh'-like noise start
          out[p + i] += s;
        }
      } else if (part.t === 'click') {
        const a = dbToAmp(part.db); for (let i = 0; i < n; i++) out[p + i] += (r() * 2 - 1) * a * Math.exp(-i / (n / 3));
      } else if (part.t === 'breath') {
        const a = dbToAmp(part.db) * Math.sqrt(3); for (let i = 0; i < n; i++) out[p + i] += (r() * 2 - 1) * a * Math.sin(Math.PI * i / n);
      }
      p += n;
    }
    this.wordStarts = wordStarts;
    return out;
  }
}
export function sine(freq, s, db, sr = SR) { const n = Math.round(s * sr), a = dbToAmp(db), o = new Float32Array(n); for (let i = 0; i < n; i++) o[i] = a * Math.sin(2 * Math.PI * freq * i / sr); return o; }
