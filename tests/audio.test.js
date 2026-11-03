import { test, eq, ok, near } from './lib.js';
import { Synth, SR, sine } from './synth.js';
import { encodeWav, decodeWav } from '../js/recorder/wav.js';
import { integratedLufs, normalize, peak } from '../js/recorder/loudness.js';
import { analyseTake, trimTake, LiveOnsetDetector, calibrateFloor } from '../js/recorder/onset.js';

const noise = (s, db = -65, seed = 3) => new Synth({ seed, noiseDb: db }).silence(s).render();
const ms = n => Math.round(n * SR / 1000);

test('wav: PCM16 mono 48 kHz header and round trip', () => {
  const x = sine(440, 0.1, -6); const buf = encodeWav(x, SR); const d = decodeWav(buf);
  eq(buf.byteLength, 44 + x.length * 2); eq(d.formatTag, 1); eq(d.channels, 1); eq(d.bitsPerSample, 16); eq(d.sampleRate, 48000); eq(d.samples.length, x.length);
  let maxErr = 0; for (let i = 0; i < x.length; i++) maxErr = Math.max(maxErr, Math.abs(x[i] - d.samples[i])); ok(maxErr < 1 / 32767 + 1e-9, 'quantisation error ' + maxErr);
});
test('wav: clamps out-of-range samples', () => { const d = decodeWav(encodeWav(new Float32Array([2, -2, 0]), SR)); eq(d.samples[0], 1); eq(d.samples[1], -1); });
test('loudness: 997 Hz sine at 0 dBFS = -3.01 LUFS (BS.1770 reference)', () => near(integratedLufs(sine(997, 3, 0), SR), -3.01, 0.1));
test('loudness: -20 dBFS sine = -23.01 LUFS; normalize to -16 LUFS', () => {
  const x = sine(997, 3, -20); near(integratedLufs(x, SR), -23.01, 0.1);
  const n = normalize(x, SR); near(n.lufsAfter, -16, 0.01); near(integratedLufs(n.samples, SR), -16, 0.1); eq(n.limited, false);
});
test('loudness: peak ceiling -1.5 dBFS limits gain', () => {
  const x = new Synth({ seed: 2 }).silence(0.5).click(5, -3).phrase(4, { db: -40 }).silence(0.5).render();
  const n = normalize(x, SR); ok(n.limited); ok(20 * Math.log10(peak(n.samples)) <= -1.49);
});

function verse({ lead = 0.6, words = 8, tail = 1.0, seed = 5, noiseDb = -65, db = -22, build } = {}) {
  const s = new Synth({ seed, noiseDb }).silence(lead);
  if (build) build(s); else s.phrase(words, { db });
  s.silence(tail);
  const x = s.render();
  return { x, onset: s.wordStarts[0], s };
}
test('onset: clean take, onset within 30 ms, offset near last word', () => {
  const { x, onset, s } = verse();
  const a = analyseTake(x, SR, { calibration: noise(0.5) });
  ok(a.speech); near(a.onsetSample, onset, ms(30), 'onset');
  const lastEnd = x.length - ms(1000); near(a.offsetSample, lastEnd, ms(40), 'offset');
  eq(a.trimStart, a.onsetSample - ms(150)); eq(a.trimEnd, a.offsetSample + ms(250));
  ok(a.snrDb > 30, 'snr ' + a.snrDb); ok(a.floorDb < -60, 'floor ' + a.floorDb);
});
test('onset: floor estimated from the take when no calibration is given', () => {
  const { x, onset } = verse({ seed: 11 }); const a = analyseTake(x, SR); near(a.onsetSample, onset, ms(30));
});
test('onset: pure room noise = no speech', () => { eq(analyseTake(noise(3), SR, { calibration: noise(0.5, -65, 9) }).speech, false); });
test('onset: clicks (20 ms, 35 ms) before speech are rejected', () => {
  const { x, onset } = verse({ build: s => { s.click(20, -8).silence(0.3).click(35, -8).silence(0.4).phrase(6); } });
  const a = analyseTake(x, SR, { calibration: noise(0.5) }); near(a.onsetSample, onset, ms(30));
});
test('onset: a lone click is not speech', () => {
  const x = new Synth({ seed: 4 }).silence(1).click(25, -6).silence(1).render();
  eq(analyseTake(x, SR, { calibration: noise(0.5) }).speech, false);
});
test('onset: soft breath before speech is ignored', () => {
  const { x, onset } = verse({ build: s => { s.breath(0.35, -55).silence(0.3).phrase(6); } });
  const a = analyseTake(x, SR, { calibration: noise(0.5) }); near(a.onsetSample, onset, ms(30));
});
test('onset: fricative start is kept (backtrack)', () => {
  const { x, onset } = verse({ build: s => { s.word(0.3, -22, { fricative: true }).silence(0.05).phrase(5); } });
  const a = analyseTake(x, SR, { calibration: noise(0.5) });
  ok(a.onsetSample <= onset + ms(20), `onset ${a.onsetSample} vs true ${onset}`);
});
test('onset: mid-verse pause kept, internal silence measured', () => {
  const { x } = verse({ build: s => { s.phrase(4).silence(1.2).phrase(4); } });
  const a = analyseTake(x, SR, { calibration: noise(0.5) });
  near(a.offsetSample, x.length - ms(1000), ms(40)); near(a.longestInternalSilenceS, 1.2, 0.08);
});
test('onset: noisier room (-48 dBFS) still finds speech', () => {
  const { x, onset } = verse({ noiseDb: -48, seed: 21 });
  const a = analyseTake(x, SR, { calibration: noise(0.5, -48, 22) }); ok(a.speech); near(a.onsetSample, onset, ms(40));
});
test('onset: Stop-tap noise in the last 150 ms is dropped', () => {
  const s = new Synth({ seed: 8 }).silence(0.6).phrase(6).silence(0.9).click(60, -6).silence(0.05); const x = s.render();
  const a = analyseTake(x, SR, { calibration: noise(0.5), dropTailMs: 150 });
  near(a.offsetSample, x.length - ms(1010), ms(40), 'offset ignores the tap');
});
test('onset: trimTake = pre-roll 150 ms + tail 250 ms with fades', () => {
  const { x } = verse(); const a = analyseTake(x, SR, { calibration: noise(0.5) }); const t = trimTake(x, SR, a);
  eq(t.length, a.trimEnd - a.trimStart); eq(t[0], 0); ok(Math.abs(t[t.length - 1]) < 1e-6);
});
test('onset: live detector (4096-sample chunks) triggers near the true onset, not on clicks', () => {
  const { x, onset } = verse({ build: s => { s.click(20, -8).silence(0.4).phrase(6); } });
  const d = new LiveOnsetDetector(SR, calibrateFloor(noise(0.5), SR)); let hit = null;
  for (let i = 0; i < x.length && hit === null; i += 4096) hit = d.push(x.subarray(i, i + 4096));
  ok(hit !== null, 'no onset'); near(hit, onset, ms(40));
});
