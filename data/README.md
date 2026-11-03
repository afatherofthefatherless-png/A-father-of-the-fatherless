# data/ (empty on purpose)

This folder holds no verse text, on this computer, in the repo or on the live site.

The site loads its verse text only from a JSON file in the signed-in user's own Google Drive, chosen once with the
Google Picker. It then keeps a checked copy in the browser's IndexedDB for offline use. See "No Bible text or audio
in this repo" in the top-level README.

Everything in this folder except this README is gitignored. `scripts/check-no-kjv-text.py` scans this folder too
and fails if any KJV text turns up here.
