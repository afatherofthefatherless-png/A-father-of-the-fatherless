// Pass/fail gate before joining (PLAN.md section e). Any FAIL blocks the join; WARN needs an explicit OK.
import { GATE, SAMPLE_RATE, LOUDNESS } from '../config.js';
import { decodeWav } from '../recorder/wav.js';
import { analyseTake, frameFeatures } from '../recorder/onset.js';
import { integratedLufs } from '../recorder/loudness.js';
import { fileNameOf, refOf, expandPassage, formatPassage } from '../kjv/ref.js';
import { sha256Hex } from './hash.js';

const PASS = 'PASS', WARN = 'WARN', FAIL = 'FAIL', SKIP = 'SKIP';
const worst = list => list.includes(FAIL) ? FAIL : list.includes(WARN) ? WARN : PASS;
const r3 = v => (v == null || !Number.isFinite(v)) ? v : Math.round(v * 1000) / 1000;

/** Noise calibration for a finished file: the pre-roll and tail pads (minus fades). */
function padCalibration(s, sr) {
  const a = s.subarray(Math.round(0.012 * sr), Math.round(0.1 * sr));
  const b = s.subarray(Math.max(0, s.length - Math.round(0.2 * sr)), Math.max(0, s.length - Math.round(0.035 * sr)));
  const out = new Float32Array(a.length + b.length); out.set(a); out.set(b, a.length); return out;
}

/** Check a single decoded verse file. words = expected word count (from the text source) or null. */
export function checkVerse(wav, { words = null, rateWps = GATE.wordsPerSecond, expectedRate = SAMPLE_RATE, meta = null } = {}) {
  const c = {};
  const fmtOk = wav.formatTag === 1 && wav.bitsPerSample === 16 && wav.channels === 1 && wav.sampleRate === expectedRate && wav.samples;
  c.format = { value: `fmt${wav.formatTag} ${wav.bitsPerSample}-bit ${wav.channels}ch ${wav.sampleRate} Hz`, status: fmtOk ? PASS : FAIL };
  if (!fmtOk) return c;
  const s = wav.samples, sr = wav.sampleRate, dur = s.length / sr;
  const a = meta && meta.analysis ? meta.analysis : analyseTake(s, sr, { calibration: padCalibration(s, sr) });

  if (!a.speech) { c.speech = { value: 'none', status: FAIL }; return c; }
  // duration vs expected (words / rate + pads)
  if (words) {
    const exp = words / rateWps + 0.4, ratio = dur / exp;
    const st = ratio >= GATE.durationPass[0] && ratio <= GATE.durationPass[1] ? PASS : ratio >= GATE.durationWarn[0] && ratio <= GATE.durationWarn[1] ? WARN : FAIL;
    c.duration = { value: r3(ratio), seconds: r3(dur), expected_s: r3(exp), status: st };
  } else c.duration = { value: null, seconds: r3(dur), status: SKIP, note: 'no text loaded, word count unknown' };
  // lead-in
  const lead = a.onsetSample / sr;
  c.lead_in = { value: r3(lead), status: lead < GATE.leadInFailMin || lead > GATE.leadInWarnMax ? FAIL : lead >= GATE.leadInPass[0] && lead <= GATE.leadInPass[1] ? PASS : WARN };
  // clipping
  let clipped = 0, run = 0, maxRun = 0;
  for (const v of s) { if (Math.abs(v) >= GATE.clipLevel) { clipped++; run++; if (run > maxRun) maxRun = run; } else run = 0; }
  const ratio = clipped / s.length;
  let cst = clipped === 0 ? PASS : (maxRun >= GATE.clipMaxRun || ratio > GATE.clipMaxRatio) ? FAIL : WARN;
  if (meta && meta.rawClipRun >= GATE.clipMaxRun) cst = FAIL; // clipping before normalisation
  c.clipping = { value: clipped, max_run: Math.max(maxRun, meta?.rawClipRun || 0), status: cst };
  // noise floor and SNR
  const fl = a.floorDb, snr = a.snrDb;
  const fst = fl <= GATE.floorPassMax ? PASS : fl <= GATE.floorWarnMax ? WARN : FAIL;
  const sst = snr >= GATE.snrPassMin ? PASS : snr >= GATE.snrWarnMin ? WARN : FAIL;
  c.noise_floor = { value: r3(fl), status: fst };
  c.snr = { value: r3(snr), status: sst };
  // internal silence
  const sil = a.longestInternalSilenceS;
  c.internal_silence = { value: r3(sil), status: sil < GATE.silencePassMax ? PASS : sil <= GATE.silenceWarnMax ? WARN : FAIL };
  // loudness (per file; range spread is checked in runGate)
  const L = integratedLufs(s, sr);
  const d = Math.abs(L - LOUDNESS.targetLufs);
  c.loudness = { value: r3(L), status: d <= GATE.lufsPassTol ? PASS : d <= 3 ? WARN : FAIL };
  c._analysis = a;
  return c;
}

/**
 * Run the gate for a passage.
 * files: Map(fileName -> ArrayBuffer) of what is available (e.g. from IndexedDB or a folder the user picked).
 * textSource: optional { wordCount(id) } for the duration check. metaById: optional take metadata.
 * Returns { passage, checked_at, overall, verses:[{id, ref, file, sha256, checks}], range:{...} }.
 */
export async function runGate(passage, files, { textSource = null, metaById = {}, rateWps = GATE.wordsPerSecond, now = new Date() } = {}) {
  const ids = expandPassage(passage);
  const verses = []; const lufs = [];
  const names = [...files.keys()];
  for (const id of ids) {
    const file = fileNameOf(id);
    const v = { id, ref: refOf(id), file, sha256: null, checks: {} };
    const dupes = names.filter(n => n === file).length; // Map keys are unique; dupes come from case variants
    const caseDupes = names.filter(n => n.toLowerCase() === file.toLowerCase() && n !== file).length;
    if (!files.has(file)) { v.checks.exists = { value: 'missing', status: FAIL }; verses.push(v); continue; }
    v.checks.exists = { value: caseDupes ? 'duplicate (case)' : 'ok', status: caseDupes || dupes > 1 ? FAIL : PASS };
    const buf = files.get(file);
    v.sha256 = await sha256Hex(buf);
    let wav;
    try { wav = decodeWav(buf); } catch (e) { v.checks.format = { value: e.message, status: FAIL }; verses.push(v); continue; }
    const words = textSource && textSource.wordCount ? textSource.wordCount(id) : null;
    const checks = checkVerse(wav, { words, rateWps, meta: metaById[id] });
    const a = checks._analysis; delete checks._analysis;
    if (a) v.speech = { onset_s: r3(a.onsetSample / wav.sampleRate), offset_s: r3(a.offsetSample / wav.sampleRate) };
    Object.assign(v.checks, checks);
    if (checks.loudness && Number.isFinite(checks.loudness.value)) lufs.push(checks.loudness.value);
    verses.push(v);
  }
  const range = {};
  if (lufs.length > 1) {
    const spread = Math.max(...lufs) - Math.min(...lufs);
    range.loudness_spread = { value: r3(spread), status: spread <= GATE.spreadPassMax ? PASS : spread <= GATE.spreadWarnMax ? WARN : FAIL };
  }
  const all = [...verses.flatMap(v => Object.values(v.checks).map(c => c.status)), ...Object.values(range).map(c => c.status)];
  return { passage: formatPassage(passage), checked_at: now.toISOString(), overall: worst(all), verses, range };
}

/** Readable markdown version of a gate report. */
export function gateReportMarkdown(rep) {
  const lines = [`# Gate report: ${rep.passage}`, '', `Checked: ${rep.checked_at}  `, `Overall: **${rep.overall}**`, ''];
  for (const v of rep.verses) {
    const bad = Object.entries(v.checks).filter(([, c]) => c.status === FAIL || c.status === WARN);
    lines.push(`- ${v.ref} (${v.file}): ${bad.length ? bad.map(([k, c]) => `${k} ${c.status} (${c.value})`).join(', ') : 'all PASS'}`);
  }
  for (const [k, c] of Object.entries(rep.range)) lines.push(`- range ${k}: ${c.status} (${c.value})`);
  return lines.join('\n') + '\n';
}
export const STATUS = { PASS, WARN, FAIL, SKIP };
