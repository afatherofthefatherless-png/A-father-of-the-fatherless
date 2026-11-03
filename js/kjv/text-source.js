// Pluggable verse-text source. This repo contains NO verse text. Text is loaded at runtime from:
//   1. a file the user picks on their own device (kept in that device's IndexedDB, never uploaded), or
//   2. data/kjv-text.json next to index.html, if present (data/ is .gitignored and is never pushed).
// Accepted formats: { verses: [{ id, read_aloud_text }] }  (CrossWire export format),
//                   [{ id, text }]  or  { "GEN.1.1": "..." }.
export class TextSource {
  constructor(map = new Map(), label = 'none') { this.map = map; this.label = label; }
  get loaded() { return this.map.size > 0; }
  text(id) { return this.map.get(id) ?? null; }
  wordCount(id) { const t = this.text(id); return t ? t.trim().split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length : null; }
  static fromJson(obj, label = 'file') {
    const m = new Map();
    const list = Array.isArray(obj) ? obj : Array.isArray(obj?.verses) ? obj.verses : null;
    if (list) for (const v of list) { const t = v.read_aloud_text ?? v.text; if (v.id && typeof t === 'string') m.set(v.id, t); }
    else if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) if (typeof v === 'string') m.set(k, v);
    return new TextSource(m, label);
  }
}

export async function loadTextSource(store) {
  const saved = store ? await store.getKv('textSource').catch(() => undefined) : undefined;
  if (saved) return TextSource.fromJson(JSON.parse(saved.json), saved.label);
  try {
    const r = await fetch('data/kjv-text.json', { cache: 'no-store' });
    if (r.ok) return TextSource.fromJson(await r.json(), 'data/kjv-text.json');
  } catch {}
  return new TextSource();
}
export async function saveTextFile(store, file) {
  const json = await file.text(); const src = TextSource.fromJson(JSON.parse(json), file.name);
  if (!src.loaded) throw new Error('No verses found in that file');
  await store.setKv('textSource', { label: file.name, json });
  return src;
}
