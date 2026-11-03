# Where the code came from

This file maps the unified site to the four older apps. It was written on 3 Nov 2026 from three sources: the rebuild
plan (`PLAN.md`, `REVIEW-NOTES.md`), the comments in this code, and a side-by-side read of the old app files.

There are three labels:

- **Ported**: the code was carried over and adapted. The structure is recognisably the old code.
- **Same rules, new code**: the behaviour or numbers match the old app, but the code was written again.
- **New**: written for the rebuild. No old app had it.

No code was copied line for line. Everything is ES modules now, and the old apps were single HTML files.

## The text: CrossWire KJV, the only source

- All verse text comes from the CrossWire SWORD KJV module (v3.1, 31,102 verses).
- It is loaded at run time from a JSON file in your own Google Drive. You choose the file once with the Google Picker,
  and the site keeps a checked copy in the browser for offline use (`js/kjv/text-source.js`).
- The repo has **no verse text**, and `scripts/check-no-kjv-text.py` fails the build if any shows up.
- `js/kjv/books.js` holds only book names, codes and the verse counts for each chapter, generated from CrossWire.

## 1. King James Voice Recorder (old page `transcript-tidier.html`, h2bavvr.sharehtml.org)

The new recorder came mostly from this app. The capture and the verse-break method were changed on purpose.

| Unified repo | Label | What it does |
|---|---|---|
| `js/recorder/wav.js` `encodeWav` | Ported | Writes the 16-bit PCM WAV file, with the same header layout as the old `encodeWav`. It is now mono only, and `decodeWav` was added. |
| `js/recorder/loudness.js` `integratedLufs`, normalise | Same rules, new code | Measures loudness to the BS.1770 standard and sets every take to −16 LUFS with a −1.5 dB ceiling. The old `kBiquads`/`measureLevel`/`normalize` used the same targets. The filter maths was written again. |
| `js/recorder/recorder.js` `this.gen` guard | Same rules, new code | Ignores a take that was cancelled or lost while it was still processing. This is the old `recGen` idea. |
| `js/recorder/onset.js` | Same rules, new code | Finds where the voice starts and stops in each verse. It keeps the old `analyse` ideas: 20 ms frames, a 10th-percentile noise floor, and the 60 ms click rule. The thresholds, the hysteresis and the fricative check are new (PLAN section d). |
| Passage links (`#/record?passage=Genesis+3:14-19`) | Same rules, new code | Takes the same `?passage=` value the tracker already sends to the old recorder. |
| `assets/css/recorder.css` | Ported | The old page's card styles (dark cards, big Record/Send buttons, status and warning boxes, verse text box with A−/A+), scoped under `.tt` so the shared site nav and restyle stay. Additions: the passage list, the step lines and the review checks. |
| `js/ui/record-view.js` layout | Ported layout, new code | The old card order and wording style ("Your reading", Record / Stop / Send, verse text box with size and verse-number toggles stored as `tt.ptSize` / `tt.ptNums`). The code is new and drives the new `Recorder`. |
| `js/reader/handoff.js` `sendToReader` | Same rules, new code | The old `tt-audio` postMessage handoff (`rr-ready` → `tt-audio` → `rr-got`), restored. The Reader only accepts it from the old recorder's origin, so it needs a Reader change before it works from the new site. |

**New, replacing old recorder parts:**
- `capture-worklet.js` and `capture.js` record true lossless audio through an AudioWorklet. The old page used MediaRecorder (`pickMime`, `startRecording`), which compresses the audio before the WAV is made.
- `state.js` is the one-verse-at-a-time state machine.

**Not taken from the old recorder (dropped on purpose):**
- The verse-break guessing (`pickBreaks`, `simpleClean`) and `estimateWords`. Each verse is now its own file.
- The `tt.breakSec.v2` setting and the single long take with guessed breaks.

**New in the rebase (Nov 2026):** `js/recorder/pipeline.js` runs everything after the last Send (Drive save, gate, stitch,
render job) and reports seven steps; the two MP4 steps always say "waiting for renderer" because no renderer exists yet.
`js/ui/record-view.js` also shows the tracker's passage list. Sign-in is lazy (only on a tap).

## 2. Reading Tracker (old page `bible-coverage-tracker.html`, xwzn961.sharehtml.org)

The tracker has **not been ported**. Your decision was that it stays as it is. The new site links to the old page
from Home, and it never writes the tracker's saved data. The keys it avoids are listed in `TRACKER_KEYS` in `js/config.js`.

| Unified repo | Label | What it does |
|---|---|---|
| `js/kjv/ref.js` `formatPassage` | Same rules, new code | Writes passage labels by the tracker's `canon()` rules, for example `Genesis 3:14-19`, `Genesis 1:24-2:3` and `Psalm 23:1-6`. |
| `js/kjv/ref.js` `globalIndexOf` / `idFromGlobalIndex` | Same rules, new code | Numbers every verse from 0 up, the same way as the tracker's `gi()`, so saved tracker marks would still line up. |
| `js/kjv/books.js` verse counts | Same rules, new code | Generated from CrossWire. It matches the tracker's `COUNTS` table in every chapter, with 0 mismatches. |
| `js/config.js` `TRACKER_KEYS` | New | A guard list, so the new site never touches the tracker's saved progress. |

**Not extracted yet:** everything else, including the dot map, plan CSV, pace, moved breaks (`applyBreaks`, `moveBreak`)
and export/import. The live tracker's Record link still points to the old recorder. A local, unpublished copy
(`/workspace/tracker-local/bible-coverage-tracker.html`, outside the repo) points it at `#/record?passage=…&next=…&chunks=…`.

## 3. Rolling Reader (old page `rolling-reader.html`, 93fyr0c.sharehtml.org)

**No code from the Rolling Reader is in the repo yet.** It is still linked from Home as an old page.

What the new code does to prepare for it:
- `js/kjv/ref.js` `passageStem` makes names like `Genesis 3-14 to 3-19`. This replaces the old `baseName`, which
  turned `:` into `.`. It is the agreed new naming, not code from the Reader.
- `js/stitch/stitch.js` writes `timings.json` with exact start and end times for each verse, for the Reader to use later.

**Not extracted yet:**
- The layout and drawing code (`buildLayout`, `drawFrame`, `renderChunk`, `wordSprite`).
- The backing music (`loadBacking`, `renderMix`, `makeLimiter`) and the Whisper sync (`syncRun`, `refineEstimatedTimings`).
- The video export (`pickRecorderFormat`, `recordVideo`, `recordZip`), and the video titles and descriptions (`videoTitle`, `videoDescription`).

## 4. Biblia Dyslexia

No Biblia Dyslexia app code was found on this computer. What exists is the project's plans: the website mind maps
(`biblia-dyslexia-website-plan*.mm`) and the pipeline spec (`biblia-dyslexia-pipeline-spec.md`). The project also
held the verified KJV text.

**No code in the repo came from Biblia Dyslexia.** Its decisions shaped the behaviour:
- Record one verse at a time.
- A retake overwrites the old file, so there is one file per verse.
- Clips go to Google Drive after a one-time Google sign-in, and you are told when sign-in has expired.
- The text is the verified KJV, which here is CrossWire.

**Not extracted yet:** the planned reader display (OpenDyslexic font and other settings), the study tools, and the
settings and accessibility hub. These are plans only, with no code to extract.

Two details differ from the spec. It suggested `Book_CCC_VVV.wav` names in a `Biblia Dyslexia Audio` folder, and the
site uses `Genesis 3-14.wav` in `KJV Recordings`, as set out in PLAN.md.

## Written new for the rebuild (from no old app)

| File | What it does |
|---|---|
| `index.html`, `js/app.js` | The site shell, the tabs (Home, Record, Stitch, Drive) and the "Other apps" bar linking the five old apps (new tab). |
| `assets/css/site.css`, `assets/fonts/` | The look, restyled to match the old apps: OpenDyslexic (the same woff2 files Rolling Reader, the Reading Tracker, the Voice Recorder and Cross-references embed; OFL 1.1), black page, white 2px borders and tabs from the Reading Tracker, buttons and inputs from the Voice Recorder, the verse panel and notice colours from Rolling Reader, and the bordered links and table headers from the Concordance of Even. |
| `js/config.js` | Settings and constants: sample rate, gate limits, the 0.4 s gap, the Google client ID and API key (both public). |
| `js/kjv/ref.js` (rest) | Verse ids, file names (`Genesis 3-14.wav`), Drive folder paths, and passage parsing and expansion. |
| `js/kjv/text-source.js` | Loads the CrossWire text from your Drive through the Picker, checks it, and caches it. |
| `js/drive/auth.js` | Google sign-in with the `drive.file` permission only. The token is kept in memory and in `sessionStorage` for this tab, so you sign in once per session. Sign-in only starts on a tap. |
| `js/drive/drive-api.js` | Drive uploads, including resumable uploads for big files and md5 checks. A retake overwrites the verse file in place, and stitched files that get replaced move to `Stitched/_replaced`. |
| `js/drive/queue.js` | The upload queue, with retry and backoff and a pause when sign-in has expired. |
| `js/stitch/gate.js` | The pass/fail checks before joining: missing verses, format, length, lead-in, clipping, noise, silence and loudness. |
| `js/stitch/stitch.js` | StitchBot. It joins the verse WAVs with a 0.4 s gap and writes the passage WAV and `timings.json`. No StitchBot existed before. |
| `js/recorder/pipeline.js` | Runs and reports the steps after the last Send: Drive save, gate, stitch, render-job JSON on Drive. The two MP4 steps are placeholders that say "waiting for renderer". |
| `js/recorder/chunks.js` | Reads the tracker's passage list from the Record link, keeps it on the device, and picks the next one. |
| `js/stitch/hash.js` | Makes the sha256 and md5 checksums. |
| `js/store/db.js`, `js/store/memory.js` | Device storage (IndexedDB) for sessions, takes and uploads. |
| `scripts/check-no-kjv-text.py` | Guard that fails if Bible text or audio gets into the repo. |
| `tests/*` | Node and headless-browser tests with synthetic audio and a mock Drive. They use no real voice and no Bible text. |

## Provenance not recorded

I found nothing that is undocumented. Two limits apply:
- The "Same rules, new code" rows rest on comparing behaviour and names with the old files. The commit history does
  not record any copying.
- I checked the old apps' function names in their latest saved copies on this computer, not in their live versions.
