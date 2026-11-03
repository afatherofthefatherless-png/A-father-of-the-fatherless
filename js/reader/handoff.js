// Rolling Reader hand-off, ported from the old Voice Recorder (transcript-tidier.html): the same postMessage protocol,
// the same reference formats and the same word-timing estimate, so the Reader gets exactly what it got before.
//   1. "Send to Rolling Reader" opens READER_URL (?from=tidier) in a new tab, straight from the tap (Safari needs that).
//   2. The Reader posts {type:'rr-ready'}; we answer {type:'tt-audio', name, passage, text, footer, covered, title, words, bytes}
//      with the WAV bytes transferred, not copied.
//   3. The Reader answers {type:'rr-got', ok, duration, filled} (or ok:false with error).
// KNOWN LIMIT: the live Reader only accepts tt-audio from the old recorder's origin (https://h2bavvr.sharehtml.org).
// From this site's origin it will ignore the message until the Reader's allowed-origin check also lists this site.
// That is a one-line change in the Reader and is NOT made here (the old apps are not changed). Download WAV still works.
// Also builds the render-job JSON that is saved to Drive for the headless renderer (see README "Rolling Reader and MP4").
import { OLD } from '../config.js';
import { BOOKS } from '../kjv/books.js';

export const READER_ORIGIN = new URL(OLD.reader).origin;
export const READER_URL = READER_ORIGIN + '/?from=tidier';

const byCode = new Map(BOOKS.map(b => [b.code, b]));
/** Old tidier shortRef: "Genesis 1:1-5", "Genesis 1:3", "Genesis 1:29-2:3", whole chapters "Genesis 1" / "Genesis 1-2", a whole book its name. */
export function shortRef(p) {
  const b = byCode.get(p.code), n = b.refBook, cv = b.counts, s = { c: p.start.chapter, v: p.start.verse }, e = { c: p.end.chapter, v: p.end.verse };
  const wholeStart = s.v === 1, wholeEnd = e.v === cv[e.c - 1];
  if (cv.length === 1) return (wholeStart && wholeEnd) ? n : n + ' ' + (s.v === e.v ? s.v : s.v + '-' + e.v);
  if (wholeStart && wholeEnd) return s.c === e.c ? n + ' ' + s.c : n + ' ' + s.c + '-' + e.c;
  if (s.c === e.c) return n + ' ' + s.c + ':' + s.v + (s.v === e.v ? '' : '-' + e.v);
  return n + ' ' + s.c + ':' + s.v + '-' + e.c + ':' + e.v;
}
/** Old tidier longRef / coveredRef: always chapter and verses ("Genesis 1:1-5"), the form the tracker reads. */
export function coveredRef(p) {
  const n = byCode.get(p.code).refBook, s = p.start, e = p.end;
  return n + ' ' + s.chapter + ':' + s.verse + (s.chapter === e.chapter ? (e.verse !== s.verse ? '-' + e.verse : '') : '-' + e.chapter + ':' + e.verse);
}

// so no word is placed in a silence), and the pauses inside the verse are lined up with the commas, semicolons, colons and full
// stops of the text when their positions agree, so the words after a pause start when the voice starts again.
// speech: [[start, end]] voiced runs in output seconds (from simpleClean). Without it, falls back to a plain proportional spread.
// Shape matches what the Reader accepts: [{ word, start, end }] in seconds of the output WAV.
export function estimateWords(verseTexts, spans, duration, speech) {
  var out = [], last = 0, BRIDGE = 0.2, PAUSE = 0.25;
  function r3(x) { return Math.round(x * 1000) / 1000; }
  function wlen(w) { return w.replace(/[^A-Za-z0-9]/g, '').length + 1 + [0, 1, 1.5, 2][punct(w)]; } // words before punctuation are drawn out a little
  function punct(w) { return /[.?!]['\u2019)]*$/.test(w) ? 3 : (/[;:]['\u2019)]*$/.test(w) ? 2 : (/,['\u2019)]*$/.test(w) ? 1 : 0)); }
  (spans || []).forEach(function (sp) {
    var toks = [];
    for (var v = sp.from; v <= sp.to && v < verseTexts.length; v++)
      String(verseTexts[v] || '').trim().split(/\s+/).forEach(function (w) { if (/[A-Za-z0-9]/.test(w)) toks.push(w); });
    if (!toks.length) return;
    var a = Math.max(last, Math.min(duration, sp.start)), b = Math.max(a, Math.min(duration, sp.end)), i, k;
    // voiced runs inside this span; gaps under 0.2 s (between words, stop consonants) count as speech
    var runs = [];
    (speech || []).forEach(function (r) {
      var s0 = Math.max(a, r[0]), e0 = Math.min(b, r[1]); if (e0 <= s0) return;
      var lr = runs[runs.length - 1]; if (lr && s0 - lr[1] < BRIDGE) lr[1] = Math.max(lr[1], e0); else runs.push([s0, e0]);
    });
    var W = toks.map(wlen), N = toks.length, cum = [0];
    for (i = 0; i < N; i++) cum.push(cum[i] + W[i]);
    var tot = cum[N], st = new Array(N), en = new Array(N);
    if (!runs.length) { // no speech detail: plain proportional spread over the span
      for (i = 0; i < N; i++) { st[i] = a + (b - a) * cum[i] / tot; en[i] = a + (b - a) * cum[i + 1] / tot; }
    } else {
      var vc = [0]; for (k = 0; k < runs.length; k++) vc.push(vc[k] + runs[k][1] - runs[k][0]);
      var Vt = vc[runs.length];
      // voiced time -> output time; a start lands after a pause, an end before it
      var wall = function (t, isEnd) {
        if (t <= 0) return runs[0][0]; if (t >= Vt) return runs[runs.length - 1][1];
        for (var q = 0; q < runs.length; q++) if (isEnd ? vc[q + 1] >= t - 1e-9 : vc[q + 1] > t + 1e-9) return runs[q][0] + (t - vc[q]);
        return runs[runs.length - 1][1];
      };
      // pauses (>= 0.25 s) inside the verse, by the voiced time before them; punctuation boundaries, by letters before them
      var P = []; for (k = 1; k < runs.length; k++) if (runs[k][0] - runs[k - 1][1] >= PAUSE) P.push({ u: vc[k], len: runs[k][0] - runs[k - 1][1] });
      var Bd = []; for (i = 0; i < N - 1; i++) { var pc = punct(toks[i]); if (pc) Bd.push({ i: i + 1, x: cum[i + 1] / tot, s: pc }); }
      var anch = [{ i: 0, t: 0 }];
      if (P.length && Bd.length) {
        // in-order match of pauses to punctuation (dynamic programming): near the expected place, stronger punctuation and longer pauses preferred
        var K = P.length, M = Bd.length, INF = 1e18, dp = [], bk = [], m;
        var mc = function (kk, mm) { var d = Math.abs(P[kk].u - Bd[mm].x * Vt) / Vt; if (d > 0.2) return INF; return 4 * d + [0, 0.15, 0.08, 0][Bd[mm].s] - 0.1 * Math.min(1, P[kk].len); };
        var skipP = function (kk) { return 0.35 + 0.15 * Math.min(1, P[kk].len); };
        for (k = 0; k <= K; k++) { dp.push(new Float64Array(M + 1).fill(INF)); bk.push(new Int8Array(M + 1)); }
        dp[0][0] = 0;
        for (k = 0; k <= K; k++) for (m = 0; m <= M; m++) {
          if (k === 0 && m === 0) continue;
          var best = INF, how = 0, c;
          if (m > 0 && dp[k][m - 1] < best) { best = dp[k][m - 1]; how = 1; }                         // punctuation with no pause
          if (k > 0 && (c = dp[k - 1][m] + skipP(k - 1)) < best) { best = c; how = 2; }                // pause not at punctuation (a breath)
          if (k > 0 && m > 0 && (c = dp[k - 1][m - 1] + mc(k - 1, m - 1)) < best) { best = c; how = 3; } // pause at this punctuation
          dp[k][m] = best; bk[k][m] = how;
        }
        var mt = []; k = K; m = M;
        while (k > 0 || m > 0) { var h = bk[k][m]; if (h === 3) { mt.push({ i: Bd[m - 1].i, t: P[k - 1].u }); k--; m--; } else if (h === 2) k--; else m--; }
        mt.reverse().forEach(function (x) { anch.push(x); });
      }
      anch.push({ i: N, t: Vt });
      // between anchors, letters follow voiced time
      for (k = 0; k + 1 < anch.length; k++) {
        var A0 = anch[k], A1 = anch[k + 1], L0 = cum[A0.i], L1 = cum[A1.i];
        for (i = A0.i; i < A1.i; i++) {
          st[i] = wall(A0.t + (A1.t - A0.t) * (cum[i] - L0) / Math.max(1e-9, L1 - L0), false);
          en[i] = wall(A0.t + (A1.t - A0.t) * (cum[i + 1] - L0) / Math.max(1e-9, L1 - L0), true);
        }
      }
      b = Math.max(b, runs[runs.length - 1][1]);
    }
    for (i = 0; i < N; i++) out.push({ word: toks[i], start: r3(st[i]), end: r3(Math.max(st[i], en[i])) });
    last = b;
  });
  for (var j = 0; j < out.length; j++) { // keep rounding monotonic
    if (j && out[j].start < out[j - 1].end) out[j].start = out[j - 1].end;
    if (out[j].end < out[j].start) out[j].end = out[j].start;
  }
  return out;
}

/**
 * Everything the Reader needs, from a stitch result. verseTexts come from the Drive text (never from the repo).
 * timings: StitchBot timings ({ verses: [{ id, start_s, end_s, speech_start_s, speech_end_s }] }).
 */
export function readerInfo(passage, timings, wavName, textSource = null) {
  const vs = timings.verses, texts = vs.map(v => (textSource && textSource.loaded ? textSource.text(v.id) : '') || '');
  const spans = vs.map((v, i) => ({ from: i, to: i, start: v.speech_start_s, end: v.speech_end_s }));
  const speech = vs.map(v => [v.speech_start_s, v.speech_end_s]);
  const duration = timings.total_samples / timings.sample_rate;
  const hasText = texts.some(Boolean);
  return {
    name: wavName, passage: coveredRef(passage), text: texts.filter(Boolean).join(' '), footer: shortRef(passage), covered: coveredRef(passage), title: shortRef(passage),
    words: hasText ? estimateWords(texts, spans, duration, speech) : [],
  };
}

/** The small render-job file written to Drive ("KJV Recordings/Render jobs/<stem>.render-job.json") for the headless renderer. */
export function renderJob({ passage, stem, wavName, timingsName, wavFileId = null, timingsFileId = null, info, now = new Date() }) {
  return {
    kind: 'kjv-rolling-reader-render-job', version: 1, createdAt: now.toISOString(), status: 'queued',
    passage: coveredRef(passage), title: info.title, footer: info.footer, covered: info.covered,
    audio: { name: wavName, folder: 'KJV Recordings/Stitched', driveFileId: wavFileId },
    timings: { name: timingsName, folder: 'KJV Recordings/Stitched', driveFileId: timingsFileId },
    words: info.words, // word timings for the rolling text (text itself comes from the Drive verse file)
    output: { name: `${stem}.mp4`, folder: 'KJV Recordings/Videos' },
    renderer: 'Headless Rolling Reader on Robin\'s computer (not in this repo yet). Read this job, render, upload the MP4, then set status to "done".',
  };
}

/**
 * Send to the Reader. win/open/addListener are injectable for tests. Calls say(text, bad) with progress.
 * Must be called straight from a tap (window.open).
 */
export function sendToReader({ wav, info, say = () => {}, open = (u) => window.open(u, '_blank'), listen = (fn) => { window.addEventListener('message', fn); return () => window.removeEventListener('message', fn); }, origin = READER_ORIGIN, url = READER_URL, readyMs = 20000, gotMs = 30000 }) {
  let win = null; try { win = open(url); } catch { win = null; }
  const tail = ' You can still tap Download WAV and choose the file in Rolling Reader.';
  if (!win) { say('Your browser blocked the new tab, so the audio was not sent. Allow pop-ups for this page and try again.' + tail, true); return Promise.resolve({ ok: false, reason: 'blocked' }); }
  return new Promise(res => {
    let sent = false, timer = 0, off = () => {};
    const done = (r, text, bad) => { clearTimeout(timer); off(); say(text + (bad ? tail : ''), bad); res(r); };
    say('Opening Rolling Reader\u2026');
    timer = setTimeout(() => done({ ok: false, reason: 'no-ready' }, 'Rolling Reader did not answer within 20 seconds, so the audio was not sent. (The Reader only accepts audio from the old recorder\'s address until it is updated to accept this site.)', true), readyMs);
    off = listen(e => {
      if (e.origin !== origin || e.source !== win) return;
      const d = e.data; if (!d || typeof d !== 'object') return;
      if (d.type === 'rr-ready' && !sent) {
        sent = true; clearTimeout(timer);
        const buf = wav.slice(0);
        win.postMessage({ type: 'tt-audio', name: info.name, passage: info.passage, text: info.text, footer: info.footer || '', covered: info.covered || '', title: info.title || '', words: info.words || [], bytes: buf }, origin, [buf]);
        say('Sent audio. Waiting for Rolling Reader to load it\u2026');
        timer = setTimeout(() => done({ ok: false, reason: 'no-got' }, 'Rolling Reader did not confirm that it loaded the audio. Check the Rolling Reader tab.', true), gotMs);
      } else if (d.type === 'rr-got') {
        if (d.ok) done({ ok: true, duration: +d.duration || 0 }, `Sent. Rolling Reader has ${info.name}${d.filled ? ' and the passage text with its title as a footer' : ''}. Switch to the Rolling Reader tab to make the video.`, false);
        else done({ ok: false, reason: 'rejected' }, 'Rolling Reader could not use the audio: ' + String(d.error || 'unknown problem') + '.', true);
      }
    });
  });
}
