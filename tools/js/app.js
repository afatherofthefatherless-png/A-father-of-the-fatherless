// App shell: hash router and views. Relative paths only (served from /A-father-of-the-fatherless/ on GitHub Pages).
import { parsePassage, formatPassage, expandPassage, refOf, fileNameOf, passageStem } from './kjv/ref.js';
import { Store, requestPersistentStorage } from './store/db.js';
import { MemoryStore } from './store/memory.js';
import { loadTextSource, TextSource, MESSAGES, MISSING_MESSAGE } from './kjv/text-source.js';
import { viewRecord as recordView, closeRecorder, recorderPoke } from './ui/record-view.js';
import { viewXref, closeXref } from './ui/xref-view.js';
import { openMic } from './recorder/capture.js';
import { S, stitchBlockers } from './recorder/state.js';
import { stitchPassage } from './stitch/stitch.js';
import { gateReportMarkdown } from './stitch/gate.js';
import { STITCH, OLD, OLD_APPS } from './config.js';

const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

let store, text = new TextSource(), textStatus = { status: 'missing', message: MISSING_MESSAGE };

async function init() {
  try { store = new Store(); await store.getKv('ping'); } catch { store = new MemoryStore(); }
  requestPersistentStorage();
  // Forget what the older releases kept (file ids and their cached copies); data now comes from data/.
  for (const k of ['textSource', 'textCache.v1', 'refsCache.v1']) store.setKv(k, null).catch(() => {});
  // Release 12: forget the Drive-era keys too (folder ids, sign-in token). Nothing here talks to Google any more.
  try { for (const k of ['kjv-site.textDriveFileId.v1', 'kjv-site.refsDriveFileId.v1', 'kjv-site.driveFolders.v1']) localStorage.removeItem(k); } catch {}
  try { for (const k of Object.keys(sessionStorage)) if (k === 'kjv-site.drive-token.v1') sessionStorage.removeItem(k); } catch {}
  reloadText().then(rerenderTextViews);   // not awaited: the page draws at once and shows "Loading the verse text…"
  window.addEventListener('hashchange', render);
  render();
}
/** Shared bar, second row: every older app, on every page (filled once; the header itself is in index.html). */
function renderAppsNav() {
  const nav = $('#apps-nav'); if (!nav || nav.childElementCount) return;
  nav.append(h('span', { class: 'apps-label' }, 'Other apps:'),
    ...OLD_APPS.map(([label, key]) => OLD[key].startsWith('#') ? h('a', { href: OLD[key] }, label) : h('a', { href: OLD[key], target: '_blank', rel: 'noopener' }, label, h('span', { class: 'ext', 'aria-hidden': 'true' }, ' \u2197'), h('span', { class: 'sr-only' }, ' (opens in a new tab)'))));
}
renderAppsNav();
// ---------- Verse text (data/kjv-crosswire.json, served with the site) ----------
let textLoading = null;
/** Load (or re-check) the verse text from the checked IndexedDB copy or data/. text keeps its identity so an open Recorder sees it. */
function reloadText() {
  if (textLoading) return textLoading;
  textLoading = (async () => {
    const r = await loadTextSource({ store });
    text.replaceWith(r.source); textStatus = r; try { window.dispatchEvent(new Event('kjv-text-changed')); } catch {}
  })().finally(() => { textLoading = null; });
  return textLoading;
}
function rerenderTextViews() { if (!store) return; const n = route().name; if (n === 'home') render(); else if (n === 'record') recorderPoke(); else if (n === 'xref') window.dispatchEvent(new Event('kjv-text-changed')); }
/** One status line, shared by Home and Record. */
function textStatusLine() {
  if (textLoading && !text.loaded) return MESSAGES.loading;
  return text.loaded ? `CrossWire KJV text loaded from ${text.label} (${text.map.size} verses).` : (textStatus.message || MISSING_MESSAGE);
}
/** Buttons that go with the status line (same on Home and Record). */
function textActions() {
  const s = textStatus.status;
  if (s === 'error') return h('div', { class: 'row text-actions' }, h('button', { onclick: async () => { await reloadText(); rerenderTextViews(); } }, 'Try again'));
  return h('div', { class: 'row text-actions' });
}


function route() {
  const [path, qs] = (location.hash.replace(/^#/, '') || '/').split('?');
  return { name: path.replace(/^\//, '') || 'home', params: new URLSearchParams(qs || '') };
}

async function render() {
  const r = route(), main = $('#main'); main.replaceChildren();
  document.querySelectorAll('nav.tabs a').forEach(a => { const on = a.getAttribute('href').startsWith('#/' + r.name); a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (r.name !== 'record') await closeRecorder();
  if (r.name !== 'xref') closeXref();
  try {
    if (r.name === 'record') return await recordView(main, { h, params: r.params, store, text, openMic, reloadText, textStatusLine, textStatus: () => textStatus });
    if (r.name === 'stitch') return await viewStitch(main, r.params.get('passage'));
    if (r.name === 'xref') return await viewXref(main, { h, store, text, textStatusLine, textActions });
    return viewHome(main);
  } catch (e) { main.append(h('p', { class: 'err' }, e.message)); }
}

function passageForm(target, value = '') {
  const inp = h('input', { type: 'text', value, placeholder: 'e.g. Genesis 3:14-19 or Psalm 23', 'aria-label': 'Passage' });
  const err = h('span', { class: 'err' });
  const go = ev => { ev.preventDefault(); try { location.hash = `#/${target}?passage=${encodeURIComponent(formatPassage(parsePassage(inp.value)))}`; } catch (e) { err.textContent = e.message; } };
  return h('form', { class: 'row', onsubmit: go }, inp, h('button', { type: 'submit' }, target === 'record' ? 'Open recorder' : 'Open stitcher'), err);
}

function viewHome(main) {
  main.append(
    h('h1', {}, 'KJV reading site'),
    h('p', { class: 'lead' }, 'Record your own verse and save it to your own computer: one WAV file per verse, then join a passage with StitchBot. Nothing is uploaded.'),
    h('section', { class: 'card' }, h('h2', {}, 'Record'), passageForm('record')),
    h('section', { class: 'card' }, h('h2', {}, 'Stitch'), passageForm('stitch')),
    h('section', { class: 'card' }, h('h2', {}, 'Verse text'),
      h('p', { class: 'text-status' }, textStatusLine()), textActions()),
  );
}


// ---------- StitchBot view ----------
async function viewStitch(main, passage) {
  if (!passage) { main.append(h('h1', {}, 'StitchBot'), passageForm('stitch')); return; }
  const p = parsePassage(passage), label = formatPassage(p), ids = expandPassage(p);
  main.append(h('h1', {}, `StitchBot: ${label}`), h('p', {}, `Joins the accepted take of each verse in verse order with a fixed ${STITCH.GAP_S} s gap. Output: ${passageStem(p)}.wav and .timings.json.`));
  const files = new Map(), metaById = {};
  for (const id of ids) { const t = await store.acceptedTake(id); if (t) { files.set(fileNameOf(id), t.wav); } }
  const missing = ids.filter(id => !files.has(fileNameOf(id)));
  if (missing.length) main.append(h('p', { class: 'err' }, `Not recorded yet: ${missing.map(refOf).join(', ')}. Stitching is blocked until every verse is recorded.`));
  const out = h('div', {});
  const run = async acceptWarnings => {
    out.replaceChildren(h('p', {}, 'Checking…'));
    const r = await stitchPassage(p, files, { acceptWarnings, textSource: text.loaded ? text : null, metaById });
    out.replaceChildren(h('pre', { class: 'report' }, gateReportMarkdown(r.gate)), dl('gate-report.json', JSON.stringify(r.gate, null, 2), 'application/json'));
    if (r.blocked) {
      out.append(h('p', { class: 'err' }, r.blocked));
      if (r.gate.overall === 'WARN') out.append(h('button', { onclick: () => run(true) }, 'OK the warnings and stitch'));
      return;
    }
    const tj = JSON.stringify(r.timings, null, 2);
    out.append(h('audio', { controls: true, src: URL.createObjectURL(new Blob([r.wav], { type: 'audio/wav' })) }),
      dl(r.wavName, r.wav, 'audio/wav'), dl(r.timingsName, tj, 'application/json'));
  };
  main.append(h('button', { onclick: () => run(false), disabled: missing.length ? true : false }, 'Run gate and stitch'), out);
}
function dl(name, data, type) {
  return h('a', { class: 'dl', download: name, href: URL.createObjectURL(new Blob([data], { type })) }, `Download ${name}`);
}

init().catch(e => { window.__bootError = e.message; console.error(e); });
