/* Words of Christ in red. Spans come from Database bot's annex
   /home/box/kjv-repository-annex/red-letter/red-letter.json (offsets into the
   verified repository `text` field). KJV wording is never changed. */
const DATA_URL = '/A-father-of-the-fatherless/data/red-letter.json';
const CLASS_NAME = 'words-of-christ';

let entries = null;
let loadPromise = null;

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export async function loadRedLetter() {
  if (entries) return entries;
  if (!loadPromise) {
    loadPromise = fetch(DATA_URL).then((res) => {
      if (!res.ok) throw new Error('Could not load the red-letter data');
      return res.json();
    }).then((data) => {
      entries = data.entries || {};
      return entries;
    }).catch((err) => {
      loadPromise = null;
      console.warn(err);
      entries = entries || {};
      return entries;
    });
  }
  return loadPromise;
}

export function spansFor(id, variant = 'repo') {
  if (!entries || !id) return null;
  const entry = entries[id];
  if (!entry) return null;
  if (Array.isArray(entry)) return variant === 'cw' ? entry : entry;
  if (variant === 'cw' && entry.cw) return entry.cw;
  return entry.s || null;
}

function validSpans(text, spans) {
  if (!spans || !spans.length) return false;
  let pos = 0;
  for (const pair of spans) {
    const start = pair[0];
    const end = pair[1];
    if (!(pos <= start && start < end && end <= text.length)) return false;
    if (text[start] === ' ' || text[end - 1] === ' ') return false;
    pos = end;
  }
  return true;
}

export function colorizeHtml(text, id, variant = 'repo') {
  const value = text ?? '';
  if (!value) return '';
  const spans = spansFor(id, variant);
  if (!validSpans(value, spans)) return escapeHtml(value);
  let pos = 0;
  let out = '';
  for (const [start, end] of spans) {
    out += escapeHtml(value.slice(pos, start));
    out += `<span class="${CLASS_NAME}">${escapeHtml(value.slice(start, end))}</span>`;
    pos = end;
  }
  out += escapeHtml(value.slice(pos));
  return out;
}

export function verseIdFromPath(path) {
  if (!path) return null;
  const match = String(path).match(/\/([A-Za-z0-9][A-Za-z0-9-]*)\/(\d+)\/?#?(\d+)?/);
  if (!match || !match[3]) return null;
  return { slug: match[1], chapter: Number(match[2]), verse: Number(match[3]) };
}

export function verseIdFromTitle(title) {
  if (!title) return null;
  const match = String(title).trim().match(/^(.*)\s+(\d+):(\d+)\s*$/);
  if (!match) return null;
  return { name: match[1], chapter: Number(match[2]), verse: Number(match[3]) };
}
