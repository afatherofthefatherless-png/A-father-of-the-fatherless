import { test, eq, ok, near, throws } from './lib.js';
import { Synth, SR } from './synth.js';
import { encodeWav, decodeWav } from '../js/recorder/wav.js';
import { analyseTake, trimTake } from '../js/recorder/onset.js';
import { normalize } from '../js/recorder/loudness.js';
import { checkVerse, runGate } from '../js/stitch/gate.js';
import { joinVerses, stitchPassage } from '../js/stitch/stitch.js';
import { fileNameOf, expandPassage } from '../js/kjv/ref.js';
import { TextSource } from '../js/kjv/text-source.js';

/** A finished per-verse file, made the way the recorder makes it: trim to speech + pads, normalise, PCM16. */
export function makeVerseWav({ seed = 1, words = 8, noiseDb = -72, build = null, skipNormalize = false, sr = SR } = {}) {
  const s = new Synth({ seed, noiseDb, sr }).silence(0.6);
  if (build) build(s); else s.phrase(words);
  s.silence(1.0);
  const raw = s.render();
  const a = analyseTake(raw, sr, { calibration: new Synth({ seed: seed + 100, noiseDb, sr }).silence(0.5).render() });
  const t = trimTake(raw, sr, a);
  return encodeWav(skipNormalize ? t : normalize(t, sr).samples, sr);
}
const statusOf = c => Object.fromEntries(Object.entries(c).filter(([k]) => k !== '_analysis').map(([k, v]) => [k, v.status]));

test('gate: a good synthetic verse passes every check', () => {
  const c = checkVerse(decodeWav(makeVerseWav()), { words: null });
  const st = statusOf(c);
  for (const k of ['format', 'lead_in', 'clipping', 'noise_floor', 'snr', 'internal_silence', 'loudness']) eq(st[k], 'PASS', k + ' ' + JSON.stringify(c[k]));
  eq(st.duration, 'SKIP'); near(c.lead_in.value, 0.15, 0.03);
});
test('gate: duration vs word count (fake text) pass / fail', () => {
  const wav = decodeWav(makeVerseWav({ words: 8 }));
  const dur = wav.samples.length / SR, wordsFit = Math.round((dur - 0.4) * 2.5);
  eq(checkVerse(wav, { words: wordsFit }).duration.status, 'PASS');
  eq(checkVerse(wav, { words: wordsFit * 4 }).duration.status, 'FAIL');
});
test('gate: clipped verse fails', () => {
  const wav = makeVerseWav({ build: s => s.phrase(4, { db: -1 }).click(40, 12).phrase(3, { db: -1 }), skipNormalize: true });
  eq(checkVerse(decodeWav(wav)).clipping.status, 'FAIL');
});
test('gate: raw clipping before normalisation fails via meta', () => {
  eq(checkVerse(decodeWav(makeVerseWav()), { meta: { rawClipRun: 12 } }).clipping.status, 'FAIL');
});
test('gate: noisy room fails noise floor', () => {
  const c = checkVerse(decodeWav(makeVerseWav({ noiseDb: -38, seed: 4 })));
  ok(c.noise_floor.status === 'FAIL' || c.snr.status === 'FAIL', JSON.stringify([c.noise_floor, c.snr]));
});
test('gate: long mid-verse silence warns (3 s) / fails (5 s)', () => {
  eq(checkVerse(decodeWav(makeVerseWav({ build: s => s.phrase(3).silence(3).phrase(3) }))).internal_silence.status, 'WARN');
  eq(checkVerse(decodeWav(makeVerseWav({ build: s => s.phrase(3).silence(5).phrase(3) }))).internal_silence.status, 'FAIL');
});
test('gate: clipped start (no lead-in) fails', () => {
  const d = decodeWav(makeVerseWav()); const cut = { ...d, samples: d.samples.subarray(Math.round(0.145 * SR)) };
  eq(checkVerse(cut).lead_in.status, 'FAIL');
});
test('gate: wrong sample rate / not PCM16 mono fails format', () => {
  eq(checkVerse(decodeWav(makeVerseWav({ sr: 44100 }))).format.status, 'FAIL');
  const d = decodeWav(makeVerseWav()); eq(checkVerse({ ...d, channels: 2 }).format.status, 'FAIL');
});
test('gate: silent file fails speech', () => { eq(checkVerse(decodeWav(encodeWav(new Synth().silence(2).render(), SR))).speech.status, 'FAIL'); });
test('gate: runGate — missing verse, loudness spread, overall', async () => {
  const files = new Map([[fileNameOf('GEN.3.14'), makeVerseWav({ seed: 1 })], [fileNameOf('GEN.3.16'), makeVerseWav({ seed: 3 })]]);
  const rep = await runGate('Genesis 3:14-16', files);
  eq(rep.overall, 'FAIL'); eq(rep.verses[1].checks.exists.status, 'FAIL'); eq(rep.verses[0].checks.exists.status, 'PASS'); eq(rep.verses[0].sha256.length, 64);
  files.set(fileNameOf('GEN.3.15'), makeVerseWav({ seed: 2 }));
  const rep2 = await runGate('Genesis 3:14-16', files); eq(rep2.overall, 'PASS', JSON.stringify(rep2.verses.map(v => statusOf(v.checks))));
  eq(rep2.range.loudness_spread.status, 'PASS');
  const quiet = makeVerseWav({ seed: 2, skipNormalize: true, build: s => s.phrase(8, { db: -34 }) });
  files.set(fileNameOf('GEN.3.15'), quiet); const rep3 = await runGate('Genesis 3:14-16', files);
  eq(rep3.range.loudness_spread.status, 'FAIL'); eq(rep3.overall, 'FAIL');
});
test('gate: case-variant duplicate file fails', async () => {
  const files = new Map([['Genesis 3-14.wav', makeVerseWav()], ['genesis 3-14.wav', makeVerseWav()]]);
  eq((await runGate('Genesis 3:14', files)).verses[0].checks.exists.status, 'FAIL');
});
test('gate: fake text source drives the duration check', async () => {
  const wav = makeVerseWav(); const dur = (wav.byteLength - 44) / 2 / SR;
  const words = Math.round((dur - 0.4) * 2.5), fake = Array.from({ length: words }, (_, i) => 'sample' + i).join(' ');
  const ts = TextSource.fromJson({ verses: [{ id: 'GEN.3.14', read_aloud_text: fake }] });
  eq((await runGate('Genesis 3:14', new Map([['Genesis 3-14.wav', wav]]), { textSource: ts })).verses[0].checks.duration.status, 'PASS');
});

test('stitch: joinVerses timings are exact sample counts with a constant 0.4 s gap', () => {
  const mk = (id, n) => ({ id, samples: new Float32Array(n).fill(0.5), sampleRate: SR, speechStart: 7200, speechEnd: n - 12000 });
  const { samples, timings } = joinVerses([mk('GEN.3.16', 96000), mk('GEN.3.14', 48000), mk('GEN.3.15', 72000)]);
  eq(timings.passage, 'Genesis 3:14-16'); eq(timings.sample_rate, 48000); eq(timings.gap_s, 0.4);
  eq(timings.verses.map(v => v.id).join(), 'GEN.3.14,GEN.3.15,GEN.3.16');
  const starts = timings.verses.map(v => v.start_sample); eq(starts.join(), [0, 48000 + 19200, 48000 + 19200 + 72000 + 19200].join());
  eq(timings.total_samples, 48000 + 72000 + 96000 + 2 * 19200); eq(samples.length, timings.total_samples);
  eq(timings.verses[1].start_s, 1.4); eq(timings.verses[1].end_s, 2.9); eq(timings.verses[1].speech_start_s, 1.55);
  eq(timings.verses[0].file, 'Genesis 3-14.wav');
  for (let i = 48000; i < 48000 + 19200; i++) if (samples[i] !== 0) throw new Error('gap not silent at ' + i);
  eq(samples[0], 0); near(samples[240], 0.5 * Math.SQRT1_2, 1e-6); eq(samples[480], 0.5); // 10 ms equal-power fade-in
});
test('stitch: cross-chapter passage label and order', () => {
  const ids = expandPassage('Genesis 1:30-2:2'); const v = ids.map(id => ({ id, samples: new Float32Array(4800), sampleRate: SR }));
  const { timings } = joinVerses(v.reverse()); eq(timings.passage, 'Genesis 1:30-2:2'); eq(timings.verses.map(x => x.id).join(), ids.join());
});
test('stitch: sample-rate mismatch and duplicates throw (no silent resampling)', async () => {
  await throws(() => joinVerses([{ id: 'GEN.1.1', samples: new Float32Array(10), sampleRate: 48000 }, { id: 'GEN.1.2', samples: new Float32Array(10), sampleRate: 44100 }]), /mismatch/);
  await throws(() => joinVerses([{ id: 'GEN.1.1', samples: new Float32Array(10), sampleRate: 48000 }, { id: 'GEN.1.1', samples: new Float32Array(10), sampleRate: 48000 }]), /Duplicate/);
});
test('stitch: stitchPassage end to end (gate -> join -> names, timings, sha256)', async () => {
  const ids = expandPassage('Psalm 23:1-3'); const files = new Map(ids.map((id, i) => [fileNameOf(id), makeVerseWav({ seed: 30 + i })]));
  const r = await stitchPassage('Psalm 23:1-3', files);
  ok(!r.blocked, r.blocked); eq(r.wavName, 'Psalm 23-1 to 23-3.wav'); eq(r.timingsName, 'Psalm 23-1 to 23-3.timings.json');
  const d = decodeWav(r.wav); eq(d.samples.length, r.timings.total_samples); eq(d.sampleRate, 48000);
  eq(r.timings.verses[2].file, 'Psalm 23-3.wav'); eq(r.timings.verses[0].sha256, r.gate.verses[0].sha256);
  for (const v of r.timings.verses) ok(v.speech_start_s > v.start_s && v.speech_end_s < v.end_s && v.speech_start_s - v.start_s < 0.2);
});
test('stitch: gate FAIL blocks; WARN blocks until accepted', async () => {
  const files = new Map([['Genesis 3-14.wav', makeVerseWav({ seed: 1 })]]);
  ok((await stitchPassage('Genesis 3:14-15', files)).blocked);
  files.set('Genesis 3-15.wav', makeVerseWav({ seed: 2, build: s => s.phrase(3).silence(3).phrase(3) }));
  const w = await stitchPassage('Genesis 3:14-15', files); eq(w.gate.overall, 'WARN'); ok(w.blocked);
  const ok2 = await stitchPassage('Genesis 3:14-15', files, { acceptWarnings: true }); ok(!ok2.blocked); eq(ok2.wavName, 'Genesis 3-14 to 3-15.wav');
});
