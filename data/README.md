# data/

Release 11: the site's data is hosted in this repo and served with the site (GitHub Pages or localhost).

| File | What | Check |
|---|---|---|
| `kjv-crosswire.json` | CrossWire KJV 3.1 text, 31,102 verses, `{verses:[{id, read_aloud_text}]}` | sha256 pinned in `manifest.json`, `js/kjv/text-source.js` and `scripts/check-no-kjv-text.py` |
| `openbible-cross-references.txt` | OpenBible.info cross-references, unchanged, 344,799 rows. **CC-BY**, credit: [OpenBible.info](https://www.openbible.info/labs/cross-references/) | sha256 pinned in `manifest.json` and the check script |
| `manifest.json` | names, byte sizes, sha256 and row/verse counts | |
| `README.md` | this file | |

The browser fetches `data/manifest.json`, then each file by a plain relative URL, checks its sha256 with WebCrypto and
keeps it in IndexedDB keyed by checksum. Reloads work offline; a file downloads again only when its manifest checksum changes.

`kjv-crosswire.json` is built from `read_aloud_text` in the CrossWire export (titles, colophons, italic brackets and
pilcrows left out, curly quotes/dashes/Æ mapped to ASCII, per that export's DECISIONS.md). Every verse was checked
equal to the source.

Nothing else may live here: `.gitignore` ignores every other file in `data/`, and `scripts/check-no-kjv-text.py` fails on
any other file, a modified copy of either file, Bible text anywhere else in the site, and audio/video.

Licensing of the hosted text (the CrossWire module is marked GPL in KJV.conf) is Robin's decision. Geoblocking is not
part of this build: GitHub Pages cannot geoblock, so that is left as a later decision.
