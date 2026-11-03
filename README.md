# KJV reading site (v1)

This is a static site: plain HTML and ES modules, with no build step and no dependencies. It is meant for GitHub Pages at
`https://afatherofthefatherless-png.github.io/A-father-of-the-fatherless/`, and every path in it is relative.

It does three things:

- **Record** a passage one verse at a time. The site arms the mic, starts on your voice (or a tap), and you Stop, review, then Accept or Re-record.
- **Save** each accepted verse to Google Drive as `KJV Recordings/01 Genesis/Genesis 3/Genesis 3-14.wav` (mono, 16-bit, 48 kHz).
- **StitchBot** runs the pass/fail gate, then joins the verses in order with a fixed gap. It outputs `Genesis 3-14 to 3-19.wav` and `Genesis 3-14 to 3-19.timings.json`.

The old pages (Tracker, Voice Recorder, Rolling Reader, Cross-refs, Concordance) are linked from Home and are not changed.
This pass doesn't touch the tracker's localStorage keys at all.

## No Bible text or audio in this repo

The repo and the deployed site contain **no KJV text and no audio**. They hold only book names, reference IDs and verse
counts. Verse text comes from exactly one place: a JSON file in **your own Google Drive** (private, shared with no one),
the CrossWire KJV export in slim form (`{ "verses": [ { "id", "read_aloud_text" } ] }`). There is no fixed path, no
device file picker and no other fallback.

How the text loads (`js/kjv/text-source.js`):

1. Sign in with Google on the Drive tab (GIS token model, `drive.file` scope only).
2. The first time, Home and Record show **Choose the verse text file from Google Drive**. It opens the Google Picker,
   limited to JSON files. Picking the file is what lets the site read it under `drive.file`.
3. The site remembers the picked file id in `localStorage` (`kjv-site.textDriveFileId.v1`) and downloads it with
   `files.get?alt=media` using the sign-in token.
4. It checks the sha256 (`TEXT_SHA256`), that there are 31,102 verses, the shape, and that every id is a real verse.
5. The checked file is cached in the site's IndexedDB, so it also works offline and signed out. The same checks run
   again every time it is read from the cache.

**Choose a different file** forgets the id and clears the cache. If the remembered file can't be opened (404 or 403),
the site forgets it and shows the choose button again. If a file fails a check, the site says why and shows no text.
Plain messages: "Google API key not set up yet" (while `GOOGLE_API_KEY` in `js/config.js` is empty) and
"Sign in with Google (Drive tab) to load the verse text."

The Picker needs a browser API key (`GOOGLE_API_KEY`, restricted to the Pages referrer and the Picker and Drive APIs)
and the app id `GOOGLE_APP_ID` (the project number, `456053541349`). The key is public by design, but it is only
committed once Robin approves.

The tests use only fake text such as "Sample verse one." and synthetic audio. Run this before every push:

    python3 scripts/check-no-kjv-text.py            # scans every file; exit 0 means clean
    python3 scripts/check-no-kjv-text.py --self-test

The check builds 8-word shingles from a **local** CrossWire export (default `/workspace/kjv-crosswire/kjv-crosswire-verses.json`,
or set `--kjv`/`KJV_JSON`) and fails on any match. It also fails on any audio or video file, any embedded audio/video data URI, and any
base64 run of 2000 or more characters.

## Run locally

    cd site && python3 -m http.server 8000     # open http://localhost:8000/

You need a mic, and the page must be served over http://localhost or https.

## Tests

    node tests/run.mjs                  # 75 tests, Node 18+
    python3 tests/browser-run.py        # the same 75 plus IndexedDB, AudioWorklet capture and app boot, in headless Chrome with a fake mic

The tests cover:

- Filenames: a round trip for all 31,102 verses, Psalm/Psalms, cross-chapter ranges and the global index.
- WAV encode/decode and BS.1770 loudness (997 Hz reference).
- Onset detection on synthetic speech-like bursts, with silence, noise, clicks, breaths and the Stop tap.
- Every gate pass/fail case, stitch timings and gaps, and the state machine.
- The Recorder driven by a fake mic.
- The Drive client and upload queue, against a **mock** fetch.
- The Drive text loader (Picker, download, checks, cache, forget), against mock fetch, gapi and Picker with fake text.

## Not tested yet

- **Google Drive and the Google Picker against the real APIs.** It needs Robin's sign-in and the OAuth origin set up for the Pages URL. Only the
  request logic has been checked, against a mock.
- Real voice, real rooms, iPad/Safari, Bluetooth mics, and a phone call or lock screen interrupting a recording.
- The 44.1 kHz resample fallback (`OfflineAudioContext`), which only runs when the device won't open at 48 kHz.

## Constants to tune with Robin (`js/config.js`)

These are not settings in the app.

- `STITCH.GAP_S` (0.4 s): the gap between verses.
- `ONSET.*`: the trim (150 ms pre-roll, 250 ms tail, thresholds).
- `GATE.wordsPerSecond` (2.5): this needs Robin's real reading rate.
- The gate floor limits (pass ≤ -55 dBFS after loudness normalisation). A room at -65 dBFS raw comes out around -54 after
  the gain to -16 LUFS, which is a WARN.

## Rules the code follows

- Nothing is ever deleted. A re-record keeps the old take locally (marked `superseded`). On Drive the old file moves to
  `<chapter>/_replaced/` as `Genesis 3-14 take 1 20261103-094012.wav`. Stitched files that get replaced move to `Stitched/_replaced/`.
- Google sign-in uses the GIS token model with the `drive.file` scope only. There's a public client ID and **no client secret**.
  The token is kept in memory only.
- Already-posted videos are not touched. v1 has no re-render or import features.

## Layout

    index.html  assets/css/site.css
    js/app.js                 router and views (#/record, #/stitch, #/drive)
    js/config.js              constants
    js/kjv/                   books (counts only), ref/filename utilities, Drive text loader (Picker)
    js/recorder/              capture (AudioWorklet), onset, loudness, WAV, state machine, Recorder controller
    js/stitch/                gate, StitchBot, hashes
    js/drive/                 GIS auth, Drive REST client, upload queue
    js/store/                 IndexedDB store (plus an in-memory store for tests)
    tests/                    harness, synthetic audio, node and headless-Chrome runners
    scripts/check-no-kjv-text.py

Live test site: https://afatherofthefatherless-png.github.io/A-father-of-the-fatherless/
