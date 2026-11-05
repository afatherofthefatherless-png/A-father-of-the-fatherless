# KJV reading site (v1)

This is a static site: plain HTML and ES modules, with no build step and no dependencies. It is meant for GitHub Pages at
`https://afatherofthefatherless-png.github.io/A-father-of-the-fatherless/`, and every path in it is relative.

It does three things:

- **Record** a passage one verse at a time. The site arms the mic, starts on your voice (or a tap), and you Stop, review, then Accept or Re-record.
- **Save** each accepted verse to Google Drive as `KJV Recordings/01 Genesis/Genesis 3/Genesis 3-14.wav` (mono, 16-bit, 48 kHz).
- **StitchBot** runs the pass/fail gate, then joins the verses in order with a fixed gap. It outputs `Genesis 3-14 to 3-19.wav` and `Genesis 3-14 to 3-19.timings.json`.

The old pages (Tracker, Voice Recorder, Rolling Reader, Cross-refs, Concordance) are linked from Home and are not changed.
This pass doesn't touch the tracker's localStorage keys at all.

## Data in this repo (release 11)

The site now hosts its own data in `data/` (see `data/README.md`). No Google sign-in or Picker is used for text or refs.

- `data/kjv-crosswire.json`: CrossWire KJV 3.1, 31,102 verses, `{ "verses": [ { "id", "read_aloud_text" } ] }`, 5,330,531 bytes,
  sha256 `0641311b…c592` (pinned in `data/manifest.json`, `js/kjv/text-source.js` and the check script).
- `data/openbible-cross-references.txt`: the OpenBible.info file, unchanged (8,303,003 bytes, 344,799 rows). **CC-BY, credit OpenBible.info.**
- `data/manifest.json`: names, byte sizes, sha256 and counts. `data/README.md`: notes.

How it loads (`js/data/repo-data.js`): fetch `data/manifest.json` (relative URL, so it works under
`/A-father-of-the-fatherless/` and on localhost), fetch the file, check its sha256 with WebCrypto, keep it in IndexedDB
keyed by checksum. Reloads use the stored copy (works offline); a file downloads again only when the manifest checksum
changes. A failed fetch or checksum shows a plain error with **Try again**.

Licensing of the hosted text (the CrossWire module says GPL) is Robin's decision. Geoblocking is not part of this build:
GitHub Pages cannot geoblock, so it is left as a later decision.

Run this before every push:

    python3 scripts/check-no-kjv-text.py            # exit 0 means clean
    python3 scripts/check-no-kjv-text.py --self-test

The check allows only the four `data/` files, with the kjv json (and refs file) locked to pinned sha256s. It fails on any
other file in `data/`, a modified kjv/refs file, KJV text anywhere else (8-word shingles), audio/video files (by name or
magic bytes), audio/video data URIs and base64 runs of 2000+ characters. `--self-test` copies the tree and proves it passes
clean and fails on each of those. Tests use only fake text and synthetic audio.

## Recording a passage (Record tab)

The Record tab is rebuilt on the old Voice Recorder (`transcript-tidier.html`): the same dark OpenDyslexic cards
(`assets/css/recorder.css`, scoped under `.tt`), inside the shared site nav.

1. **Passages to record.** The Reading Tracker's Record link opens `#/record?passage=…&next=…&chunks=n~ref|…`. The
   recorder shows that list, marks the next one **Record this one next**, and keeps it on this device
   (`kjv-site.trackerChunks.v1`). Tap a passage to open it. A passage that spans two books can't be one recording yet,
   and the list says so. Typing a passage (`gen 3 14-16`, `Ps 23`, `1 cor 13:4`) or **Pick from the Bible** is the fallback.
2. **Record / Stop / Send**, one verse at a time. Record again replaces the take (before or after Send). Send keeps a
   WAV per verse and queues it for Drive as `Book C-V.wav` (for example `Genesis 3-14.wav`). A resend overwrites the same Drive file.
3. After the last verse, everything runs by itself and each step has its own line: WAV captured, saved to Drive, gate,
   stitched (0.4 s gap), queued for the Rolling Reader (a `Render jobs/<passage>.render-job.json` file on Drive, holding
   names, timings and file ids, never verse text), MP4 rendered, MP4 on Drive.
4. **The MP4 renderer is not in this repo.** The last two lines always say "waiting for renderer". Until it exists, use
   **Download WAV**, **Save or share**, or **Send to Rolling Reader** (which opens the old Reader; the old Reader only
   accepts audio from the old recorder's address, so it will not take this file until the Reader is changed).

If you are not signed in when a verse is sent, the WAV stays on the device and the Drive line shows
**Sign in to save to Drive**; after sign-in the queue continues.

## Run locally

    cd site && python3 -m http.server 8000     # open http://localhost:8000/

You need a mic, and the page must be served over http://localhost or https.

## Tests

    node tests/run.mjs                  # 88 tests, Node 18+
    python3 tests/browser-run.py        # 91: the same 88 plus IndexedDB, AudioWorklet capture and app boot, in headless Chrome with a fake mic

The tests cover:

- Filenames: a round trip for all 31,102 verses, Psalm/Psalms, cross-chapter ranges and the global index.
- WAV encode/decode and BS.1770 loudness (997 Hz reference).
- Onset detection on synthetic speech-like bursts, with silence, noise, clicks, breaths and the Stop tap.
- Every gate pass/fail case, stitch timings and gaps, and the state machine.
- The Recorder driven by a fake mic.
- The Drive client and upload queue, against a **mock** fetch.
- The Drive text loader (Picker, download, checks, cache, forget), against mock fetch, gapi and Picker with fake text.
- The rebuilt recorder: separate hyphen-named files per verse, Record again overwrites, Send queues an upload, the
  automated pipeline and render-job JSON (mock Drive), tracker hand-off chunks and the next-passage choice, and the
  Rolling Reader send's origin check.
- In headless Chrome: opening Record does not load Google sign-in, the seven step lines (renderer lines say waiting),
  the tracker passage list, and a Record → Stop run with the fake mic.

## Not tested yet

- **Google Drive and the Google Picker against the real APIs.** It needs Robin's sign-in and the OAuth origin set up for the Pages URL. Only the
  request logic has been checked, against a mock.
- The MP4 renderer (not built) and the Rolling Reader accepting audio from the new site (needs a Reader change).
- Real voice, real rooms, iPad/Safari (only emulated screen sizes were checked), Bluetooth mics, and a phone call or lock screen interrupting a recording.
- The 44.1 kHz resample fallback (`OfflineAudioContext`), which only runs when the device won't open at 48 kHz.

## Constants to tune with Robin (`js/config.js`)

These are not settings in the app.

- `STITCH.GAP_S` (0.4 s): the gap between verses.
- `ONSET.*`: the trim (150 ms pre-roll, 250 ms tail, thresholds).
- `GATE.wordsPerSecond` (2.5): this needs Robin's real reading rate.
- The gate floor limits (pass ≤ -55 dBFS after loudness normalisation). A room at -65 dBFS raw comes out around -54 after
  the gain to -16 LUFS, which is a WARN.

## Rules the code follows

- One file per verse on Drive. Recording a verse again overwrites its old file (`Genesis 3-14.wav`), with no version
  suffixes. On the device, the old take is still kept locally (marked `superseded`). Stitched files that get replaced
  still move to `Stitched/_replaced/` (unchanged).
- Google sign-in uses the GIS token model with the `drive.file` scope only. There's a public client ID and **no client secret**.
  The token (about 1 hour) is kept in memory and in `sessionStorage` for this tab only, never in `localStorage`.
- Already-posted videos are not touched. v1 has no re-render or import features.

## Layout

    index.html  assets/css/site.css   (look copied from the old apps; see the comment at the top of site.css)
    assets/fonts/             OpenDyslexic 400/700 woff2 (same files the old apps embed) and OFL.txt (SIL OFL 1.1)
    js/app.js                 router and views (#/record, #/stitch, #/drive)
    js/config.js              constants
    js/kjv/                   books (counts only), ref/filename utilities, Drive text loader (Picker)
    js/recorder/              capture (AudioWorklet), onset, loudness, WAV, state machine, Recorder controller,
                              pipeline (steps after Send), chunks (tracker passage list)
    js/ui/record-view.js      the Record tab (old Voice Recorder layout); assets/css/recorder.css its styles
    js/reader/handoff.js      Rolling Reader handoff and render-job contents
    js/stitch/                gate, StitchBot, hashes
    js/drive/                 GIS auth, Drive REST client, upload queue
    js/store/                 IndexedDB store (plus an in-memory store for tests)
    tests/                    harness, synthetic audio, node and headless-Chrome runners
    scripts/check-no-kjv-text.py

Live test site: https://afatherofthefatherless-png.github.io/A-father-of-the-fatherless/

### Cross Ref Map animations (release 8)
Canvas has two layers: static arcs on the base canvas (drawn in batches, capped at 60,000), and everything that moves on an overlay canvas:
1. Yellow (#ffe81f) dots travel source→target on the top 400 arcs in view; size and speed scale with votes.
2. Slider moves: new arcs draw in over 0.4 s, dropped arcs fade over 0.2 s; more than 3,000 changed arcs → jump.
3. Soft yellow glow pulses every 2 s on the top 200 arcs.
4. First load: a wave reveals Genesis→Revelation over 1.5 s; aborted to the final state after 3 frames slower than 50 ms.
5. Hover (mouse) / tap (touch): nearest arc found through a grid spatial index (`ArcIndex`), others dim, both verse refs labelled, 0.15 s fade.
`prefers-reduced-motion: reduce` turns all of it off (Play button disabled, changes jump). Test-only emulation: `?motion=reduce` on localhost.

## Cross-reference map (#/xref)
The map scrolls from Genesis to Revelation (mouse, wheel or touch). The list on the right shows the links in view, ranked by votes. Hover or tap a row to highlight its arc and put it in Link of the Day. The info box has an OpenBible file-info note. The link box has a "Prepared for sharing" text box, but there is no send route yet. Only the visible part of the map is drawn.

Release 10: the map is long (at least 4x the old one-screen height and at least 1.5x its width, so tall A4-ish proportions). You scroll the page itself down through it; the arcs and the side list stay in view. Link of the Day shows just the two refs, with a scrollable text box for each verse. The text comes only from your Drive KJV file; when it isn't loaded, the usual sign-in message shows. The box no longer shows rank or votes, and Save for later is gone. Drive load status and the file picker help are at the bottom of the page.

Release 11: the verse text and the cross-references come from this site's `data/` folder (checked against `data/manifest.json`, kept on the device for offline use). No sign-in or file picker on the map; the bottom box is now "Data status".
