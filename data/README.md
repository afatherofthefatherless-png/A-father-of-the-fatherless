# data/ (local only, gitignored)

Put a local verse-text file here as `data/kjv-text.json` if you want the site to load it
automatically when served from this folder. Everything in this folder except this README
is gitignored and must never be pushed.

Accepted formats:

- `{ "verses": [ { "id": "GEN.1.1", "read_aloud_text": "..." } ] }` (the CrossWire export format)
- `[ { "id": "GEN.1.1", "text": "..." } ]`
- `{ "GEN.1.1": "..." }`

On the live site, use the **Text** page instead. It loads a file from your device into that
browser's storage only.
