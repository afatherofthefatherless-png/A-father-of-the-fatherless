// Site-wide constants. Release 12: no Google client id, API key or Drive settings (the site talks to no Google service).

export const SAMPLE_RATE = 48000;          // one rate everywhere (capture, files, stitch)
export const BIT_DEPTH = 16;               // per-verse WAV: mono, 16-bit PCM, 48 kHz


// Onset detection (PLAN.md section d). Analysis frames are 20 ms long on a 10 ms hop.
export const ONSET = Object.freeze({
  frameMs: 20,
  hopMs: 10,
  calibrationS: 0.5,        // noise calibration during ARMING
  floorPercentile: 10,
  floorEmaAlpha: 0.02,      // slow EMA, updated only by frames < floor + 3 dB
  floorUpdateDb: 3,
  onAboveFloorDb: 12,
  onMinDbfs: -55,
  offAboveFloorDb: 6,
  confirmMs: 60,            // >= 60 ms above the on-threshold ...
  confirmWindowMs: 100,     // ... within a 100 ms window (rejects clicks)
  backtrackDb: 3,           // onset = first frame > floor + 3 dB, walking back ...
  backtrackMaxMs: 300,      // ... at most 300 ms
  offsetSilenceMs: 700,
  preRollMs: 150,           // kept before the onset
  tailMs: 250,              // kept after the offset
  fadeInMs: 10,
  fadeOutMs: 30,
  stopTapDropMs: 150,       // drop the last 150 ms before a Stop tap (tap noise)
  armRingS: 1.0,            // audio kept from before the live onset while ARMED
});

// Stitching. NOT user-adjustable (Robin's decision): the gap and trim are tuned with Robin
// while writing the algorithm, then baked in here. Starting value 0.4 s.
export const STITCH = Object.freeze({
  GAP_S: 0.4,
  FADE_MS: 10,              // equal-power fades at every verse edge
});

// Loudness (BS.1770 integrated, mono).
export const LOUDNESS = Object.freeze({ targetLufs: -16, ceilingDbfs: -1.5 });

// Pass/fail gate thresholds (PLAN.md section e).
export const GATE = Object.freeze({
  wordsPerSecond: 2.5,                         // starting estimate of Robin's median rate
  durationPass: [0.65, 1.6], durationWarn: [0.5, 2.0],
  leadInPass: [0.08, 0.40], leadInWarnMax: 0.8, leadInFailMin: 0.05,
  clipLevel: 0.999, clipMaxRatio: 0.0001, clipMaxRun: 3,
  floorPassMax: -55, floorWarnMax: -45,
  snrPassMin: 25, snrWarnMin: 15,
  silencePassMax: 2.5, silenceWarnMax: 4.0,
  lufsPassTol: 1, spreadPassMax: 2, spreadWarnMax: 3,
});

// The older apps (still live). Linked from the shared bar at the top of every page; each opens in a new tab.
export const OLD = Object.freeze({
  tracker: 'https://xwzn961.sharehtml.org/',      // Reading Tracker
  recorder: 'https://h2bavvr.sharehtml.org/',     // King James Bible Voice Recorder
  reader: 'https://93fyr0c.sharehtml.org/',       // Rolling Reader
  xref: '#/xref',                                  // Cross-references: the new Cross Ref Map page in this site (old arc diagram was https://ugz9yeu.sharehtml.org/)
  concordance: 'https://q97d9yl.sharehtml.org/',  // Concordance of Even
});
export const OLD_APPS = Object.freeze([
  ['Reading Tracker', 'tracker'], ['Voice Recorder', 'recorder'], ['Rolling Reader', 'reader'],
  ['Cross-references', 'xref'], ['Concordance of Even', 'concordance'],
]);

// Reading Tracker keys from the old page. Listed so nothing in this site ever writes them by accident.
export const TRACKER_KEYS = Object.freeze([
  'bible-coverage-tracker.v2', 'bible-coverage-tracker.plan.v2',
  'bible-coverage-tracker.pace.v1', 'bible-coverage-tracker.breaks.v1',
]);
