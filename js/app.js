// App shell: hash router and views. Relative paths only (served from /A-father-of-the-fatherless/ on GitHub Pages).
import { parsePassage, formatPassage, expandPassage, refOf, fileNameOf, passageStem } from './kjv/ref.js';
import { Store, requestPersistentStorage } from './store/db.js';
import { MemoryStore } from './store/memory.js';
import { loadTextSource, pickTextFile, rememberFileId, forgetTextFile, TextSource, MESSAGES, MISSING_MESSAGE } from './kjv/text-source.js';
import { viewRecord as recordView, closeRecorder, recorderPoke } from './ui/record-view.js';
import { openMic } from './recorder/capture.js';
import { S, U, stitchBlockers } from './recorder/state.js';
import { DriveClient } from './drive/drive-api.js';
import { UploadQueue } from './drive/queue.js';
import * as auth from './drive/auth.js';
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

let store, text = new TextSource(), textStatus = { status: 'missing', message: MISSING_MESSAGE }, drive, queue;
const folderCache = new Map();

async function init() {
  try { store = new Store(); await store.getKv('ping'); } catch { store = new MemoryStore(); }
  requestPersistentStorage();
  store.setKv('textSource', null).catch(() => {}); // forget any file picked under the old Text page
  await reloadText();
  try { for (const [k, v] of JSON.parse(localStorage.getItem('kjv-site.driveFolders.v1') || '[]')) folderCache.set(k, v); } catch {}
  drive = new DriveClient({ getToken: auth.getToken, folderCache });
  queue = new UploadQueue({ store, drive, onChange: () => { saveFolders(); if (route().name === 'drive') render(); if (route().name === 'record') recorderPoke(); renderDriveBadge(); } });
  auth.onAuthChange(() => { renderDriveBadge(); if (!text.loaded) reloadText().then(rerenderTextViews); });
  queue.recover().catch(() => {});
  window.addEventListener('online', () => queue.kick());
  window.addEventListener('hashchange', render);
  render(); renderDriveBadge();
}
/** Shared bar, second row: every older app, on every page (filled once; the header itself is in index.html). */
function renderAppsNav() {
  const nav = $('#apps-nav'); if (!nav || nav.childElementCount) return;
  nav.append(h('span', { class: 'apps-label' }, 'Other apps:'),
    ...OLD_APPS.map(([label, key]) => h('a', { href: OLD[key], target: '_blank', rel: 'noopener' }, label, h('span', { class: 'ext', 'aria-hidden': 'true' }, ' \u2197'), h('span', { class: 'sr-only' }, ' (opens in a new tab)'))));
}
renderAppsNav();
// ---------- Verse text (Google Drive only) ----------
let textLoading = null;
/** Load (or re-check) the verse text from the offline cache or Drive. text keeps its identity so an open Recorder sees it. */
function reloadText() {
  if (textLoading) return textLoading;
  textLoading = (async () => {
    const r = await loadTextSource({ store, getToken: auth.getToken });
    text.replaceWith(r.source); textStatus = r;
  })().finally(() => { textLoading = null; });
  return textLoading;
}
function rerenderTextViews() { const n = route().name; if (n === 'home' || n === 'record') render(); }
/** One status line, shared by Home and Record. */
function textStatusLine() {
  if (textLoading && !text.loaded) return MESSAGES.loading;
  return text.loaded ? `CrossWire KJV text loaded from Google Drive (${text.map.size} verses).` : (textStatus.message || MISSING_MESSAGE);
}
async function chooseTextFile(ev, { different = false } = {}) {
  const btn = ev && ev.target; if (btn) btn.disabled = true;
  try {
    if (different) { await forgetTextFile({ store }); text.replaceWith(new TextSource()); await reloadText(); }
    const token = auth.getToken();
    if (!token) { await reloadText(); return; }
    const id = await pickTextFile({ token });
    if (id) { rememberFileId(id); textStatus = { status: 'loading', message: MESSAGES.loading }; rerenderTextViews(); await reloadText(); }
  } catch (e) { textStatus = { ...textStatus, message: e.message }; }
  finally { if (btn) btn.disabled = false; rerenderTextViews(); }
}
/** Buttons that go with the status line (same on Home and Record). */
function textActions() {
  const s = textStatus.status;
  if (text.loaded) return h('div', { class: 'row text-actions' }, h('button', { onclick: ev => chooseTextFile(ev, { different: true }) }, 'Choose a different file'));
  if (s === 'signed-out') return h('div', { class: 'row text-actions' }, h('button', { onclick: async ev => { ev.target.disabled = true; try { await auth.needToken(); await reloadText(); if (textStatus.status === 'choose') await chooseTextFile(); } catch (e) { textStatus = { ...textStatus, message: e.message }; } finally { rerenderTextViews(); } } }, 'Sign in to show the verse text'));
  if (s === 'choose' || s === 'invalid') return h('div', { class: 'row text-actions' }, h('button', { onclick: ev => chooseTextFile(ev) }, MESSAGES.choose));
  if (s === 'error') return h('div', { class: 'row text-actions' }, h('button', { onclick: async () => { await reloadText(); rerenderTextViews(); } }, 'Try again'));
  return h('div', { class: 'row text-actions' });
}

function saveFolders() { try { localStorage.setItem('kjv-site.driveFolders.v1', JSON.stringify([...folderCache])); } catch {} }

function route() {
  const [path, qs] = (location.hash.replace(/^#/, '') || '/').split('?');
  return { name: path.replace(/^\//, '') || 'home', params: new URLSearchParams(qs || '') };
}
async function renderDriveBadge() {
  const el = $('#drive-badge'); if (!el) return;
  const ups = await store.allUploads().catch(() => []);
  const pending = ups.filter(u => u.state !== U.UPLOADED).length;
  el.textContent = (auth.isSignedIn() ? 'Drive: signed in' : 'Drive: signed out') + (pending ? ` · ${pending} waiting` : '');
}

async function render() {
  const r = route(), main = $('#main'); main.replaceChildren();
  document.querySelectorAll('nav.tabs a').forEach(a => { const on = a.getAttribute('href').startsWith('#/' + r.name); a.classList.toggle('on', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (r.name !== 'record') await closeRecorder();
  try {
    if (r.name === 'record') return await recordView(main, { h, params: r.params, store, queue, drive, text, auth, openMic, reloadText, chooseTextFile, textStatusLine, textStatus: () => textStatus });
    if (r.name === 'stitch') return await viewStitch(main, r.params.get('passage'));
    if (r.name === 'drive') return await viewDrive(main);
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
    h('p', { class: 'lead' }, 'Record one verse at a time, save each verse to Google Drive, and join a passage with StitchBot.'),
    h('section', { class: 'card' }, h('h2', {}, 'Record'), passageForm('record')),
    h('section', { class: 'card' }, h('h2', {}, 'Stitch'), passageForm('stitch')),
    h('section', { class: 'card' }, h('h2', {}, 'Verse text'),
      h('p', { class: 'text-status' }, textStatusLine()), textActions()),
  );
}

async function viewDrive(main) {
  const ups = (await store.allUploads()).sort((a, b) => b.updatedAt - a.updatedAt);
  const btn = h('button', { onclick: async () => { try { await auth.signIn(); await queue.resumeAfterSignIn(); render(); } catch (e) { alert(e.message); } } }, auth.isSignedIn() ? 'Sign in again' : 'Sign in with Google');
  main.append(h('h1', {}, 'Google Drive'),
    h('p', { class: 'lead' }, 'Recordings are saved to "KJV Recordings" in your Drive. This site can only see files it saved itself (drive.file permission). There is one file per verse: recording a verse again overwrites its old file.'),
    h('div', { class: 'row' }, btn, auth.isSignedIn() ? h('button', { onclick: () => { auth.signOut(); render(); } }, 'Sign out') : null,
      h('button', { onclick: async () => { for (const u of await store.allUploads()) if (u.state === U.UPLOAD_FAILED) await store.putUpload({ ...u, nextAt: 0 }); queue.kick(); } }, 'Retry failed uploads')),
    h('div', { class: 'table-wrap' }, h('table', {}, h('tr', {}, h('th', {}, 'Verse'), h('th', {}, 'Take'), h('th', {}, 'Upload'), h('th', {}, 'Note')),
      ...ups.map(u => h('tr', {}, h('td', {}, refOf(u.verseId)), h('td', {}, u.takeNo), h('td', { class: 'st-' + u.state }, u.state), h('td', {}, u.error || ''))))));
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
      dl(r.wavName, r.wav, 'audio/wav'), dl(r.timingsName, tj, 'application/json'),
      h('button', { onclick: async ev => { ev.target.disabled = true; try { await drive.uploadStitched(r.wavName, r.wav, 'audio/wav'); await drive.uploadStitched(r.timingsName, new TextEncoder().encode(tj), 'application/json'); ev.target.textContent = 'Saved to Drive'; } catch (e) { ev.target.disabled = false; alert(e.message); } } }, 'Save to Drive (Stitched)'));
  };
  main.append(h('button', { onclick: () => run(false), disabled: missing.length ? true : false }, 'Run gate and stitch'), out);
}
function dl(name, data, type) {
  return h('a', { class: 'dl', download: name, href: URL.createObjectURL(new Blob([data], { type })) }, `Download ${name}`);
}

init().catch(e => { window.__bootError = e.message; console.error(e); });
