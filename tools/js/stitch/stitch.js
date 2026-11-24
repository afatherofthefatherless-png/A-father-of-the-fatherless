// StitchBot (browser module): join verse WAVs in verse order with a constant gap; output passage WAV + timings JSON.
// The gap is a baked-in constant (STITCH.GAP_S), not a user setting.
import { STITCH } from '../config.js';
import { decodeWav, encodeWav } from '../recorder/wav.js';
import { expandPassage, fileNameOf, refOf, formatPassage, passageStem, compareIds } from '../kjv/ref.js';
import { sha256Hex } from './hash.js';
import { runGate } from './gate.js';

/**
 * Low-level join. verses: [{ id, samples: Float32Array, sampleRate, speechStart?, speechEnd? (samples within file), file?, sha256? }]
 * Returns { samples, timings }.
 */
export function joinVerses(verses, { gapS = STITCH.GAP_S, fadeMs = STITCH.FADE_MS, passage = null } = {}) {
  if (!verses.length) throw new Error('Nothing to stitch');
  const sorted = [...verses].sort((a, b) => compareIds(a.id, b.id));
  const sr = sorted[0].sampleRate;
  for (const v of sorted) if (v.sampleRate !== sr) throw new Error(`Sample rate mismatch: ${v.id} is ${v.sampleRate} Hz, expected ${sr} Hz (no silent resampling)`);
  for (let i = 1; i < sorted.length; i++) if (sorted[i].id === sorted[i - 1].id) throw new Error(`Duplicate verse ${sorted[i].id}`);
  const gap = Math.round(gapS * sr), fade = Math.round(fadeMs / 1000 * sr);
  const total = sorted.reduce((t, v) => t + v.samples.length, 0) + gap * (sorted.length - 1);
  const out = new Float32Array(total);
  const tv = []; let pos = 0;
  sorted.forEach((v, k) => {
    const n = v.samples.length, f = Math.min(fade, Math.floor(n / 2));
    out.set(v.samples, pos);
    for (let i = 0; i < f; i++) { // equal-power fade in / out
      out[pos + i] *= Math.sin(Math.PI / 2 * (i / f));
      out[pos + n - 1 - i] *= Math.sin(Math.PI / 2 * (i / f));
    }
    const ss = v.speechStart ?? 0, se = v.speechEnd ?? n;
    tv.push({ id: v.id, ref: refOf(v.id), file: v.file || fileNameOf(v.id), sha256: v.sha256 || null,
      start_sample: pos, end_sample: pos + n, start_s: pos / sr, end_s: (pos + n) / sr,
      speech_start_s: (pos + ss) / sr, speech_end_s: (pos + se) / sr });
    pos += n + (k < sorted.length - 1 ? gap : 0);
  });
  const label = passage ? formatPassage(passage) : formatPassage(rangeOf(sorted.map(v => v.id)));
  return { samples: out, timings: { passage: label, sample_rate: sr, gap_s: gap / sr, total_samples: total, verses: tv } };
}

function rangeOf(ids) {
  const [c0, ch0, v0] = ids[0].split('.'), [, ch1, v1] = ids[ids.length - 1].split('.');
  return { code: c0, start: { chapter: +ch0, verse: +v0 }, end: { chapter: +ch1, verse: +v1 } };
}

/**
 * Full StitchBot: gate (stop on FAIL; WARN needs acceptWarnings), then join.
 * files: Map(fileName -> ArrayBuffer). Returns { gate, wavName, wav (ArrayBuffer), timingsName, timings } or { gate, blocked }.
 */
export async function stitchPassage(passage, files, { acceptWarnings = false, textSource = null, metaById = {} } = {}) {
  const gate = await runGate(passage, files, { textSource, metaById });
  if (gate.overall === 'FAIL') return { gate, blocked: 'Gate FAIL: fix or re-record the failing verses' };
  if (gate.overall === 'WARN' && !acceptWarnings) return { gate, blocked: 'Gate WARN: needs explicit OK' };
  const ids = expandPassage(passage);
  const verses = [];
  for (const id of ids) {
    const file = fileNameOf(id), buf = files.get(file), wav = decodeWav(buf);
    const g = gate.verses.find(v => v.id === id);
    const sp = g && g.speech;
    verses.push({ id, file, sha256: g.sha256, samples: wav.samples, sampleRate: wav.sampleRate,
      speechStart: sp ? Math.round(sp.onset_s * wav.sampleRate) : undefined, speechEnd: sp ? Math.round(sp.offset_s * wav.sampleRate) : undefined });
  }
  const { samples, timings } = joinVerses(verses, { passage });
  const stem = passageStem(passage);
  return { gate, wavName: `${stem}.wav`, wav: encodeWav(samples, timings.sample_rate), timingsName: `${stem}.timings.json`, timings };
}

export { sha256Hex };
