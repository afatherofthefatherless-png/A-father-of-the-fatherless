// ITU-R BS.1770 integrated loudness (mono) and simple normalisation with a peak ceiling.
import { LOUDNESS } from '../config.js';

function kCoeffs(fs) {
  // stage 1 high shelf, stage 2 high pass (coefficients derived for any rate, as in pyloudnorm)
  let G = 3.99984385397, Q = 0.7071752369554193, fc = 1681.9744509555319;
  let K = Math.tan(Math.PI * fc / fs), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.499666774155);
  let a0 = 1 + K / Q + K * K;
  const s1 = { b: [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  fc = 38.13547087613982; Q = 0.5003270373253953; K = Math.tan(Math.PI * fc / fs); a0 = 1 + K / Q + K * K;
  const s2 = { b: [1, -2, 1], a: [2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0] };
  return [s1, s2];
}
function biquad(x, { b, a }) {
  const y = new Float64Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/** Integrated loudness in LUFS (mono). Returns -Infinity for silence / too short. */
export function integratedLufs(samples, fs) {
  const [s1, s2] = kCoeffs(fs);
  const y = biquad(biquad(samples, s1), s2);
  const block = Math.round(0.4 * fs), step = Math.round(0.1 * fs);
  if (y.length < block) return -Infinity;
  const z = [];
  for (let st = 0; st + block <= y.length; st += step) {
    let acc = 0; for (let i = st; i < st + block; i++) acc += y[i] * y[i];
    z.push(acc / block);
  }
  const L = v => -0.691 + 10 * Math.log10(v);
  const abs = z.filter(v => L(v) > -70);
  if (!abs.length) return -Infinity;
  const relThr = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const rel = abs.filter(v => L(v) > relThr);
  if (!rel.length) return -Infinity;
  return L(rel.reduce((a, b) => a + b, 0) / rel.length);
}

export function peak(samples) { let p = 0; for (const v of samples) { const a = Math.abs(v); if (a > p) p = a; } return p; }

/** Gain to target loudness, limited so the peak stays under the ceiling. Returns { samples, gainDb, lufsBefore, lufsAfter, limited }. */
export function normalize(samples, fs, { targetLufs = LOUDNESS.targetLufs, ceilingDbfs = LOUDNESS.ceilingDbfs } = {}) {
  const before = integratedLufs(samples, fs);
  if (!isFinite(before)) return { samples, gainDb: 0, lufsBefore: before, lufsAfter: before, limited: false };
  let gainDb = targetLufs - before; const pk = peak(samples);
  let limited = false;
  if (pk > 0) { const maxGain = ceilingDbfs - 20 * Math.log10(pk); if (gainDb > maxGain) { gainDb = maxGain; limited = true; } }
  const g = Math.pow(10, gainDb / 20), out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] * g;
  return { samples: out, gainDb, lufsBefore: before, lufsAfter: before + gainDb, limited };
}
