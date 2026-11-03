// App shell: hash router and views. Relative paths only (served from /A-father-of-the-fatherless/ on GitHub Pages).
import { parsePassage, formatPassage, expandPassage, refOf, fileNameOf, passageStem } from './kjv/ref.js';
import { Store, requestPersistentStorage } from './store/db.js';
import { MemoryStore } from './store/memory.js';
import { loadTextSource, pickTextFile, rememberFileId, forgetTextFile, TextSource, MESSAGES, MISSING_MESSAGE } from './kjv/text-source.js';
import { Recorder } from './recorder/recorder.js';
import { openMic } from './recorder/capture.js';
import { S, U, stitchBlockers } from './recorder/state.js';
import { DriveClient } from './drive/drive-api.js';
import { UploadQueue } from './drive/queue.js';
import * as auth from './drive/auth.js';
import { stitchPassage } from './stitch/stitch.js';
import { gateReportMarkdown } from './stitch/gate.js';
import { STITCH } from './config.js';

const OLD = { tracker: 'https://xwzn961.sharehtml.org/', recorder: 'https://h2bavvr.sharehtml.org/', reader: 'https://93fyr0c.sharehtml.org/', xref: 'https://ugz9yeu.sharehtml.org/', concordance: 'https://q97d9yl.sharehtml.org/' };
const $ = (sel, root = document) => root.querySelector(sel);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

let store, text = new TextSource(), textStatus = { status: 'missing', message: MISSING_MESSAGE }, drive, queue, recorder = null;
const folderCache = new Map();

async function init() {
  try { store = new Store(); await store.getKv('ping'); } catch { store = new MemoryStore(); }
  requestPersistentStorage();
  store.setKv('textSource', null).catch(() => {}); // forget any file picked under the old Text page
  await reloadText();
  try { for (const [k, v] of JSON.parse(localStorage.getItem('kjv-site.driveFolders.v1') || '[]')) folderCache.set(k, v); } catch {}
  drive = new DriveClient({ getToken: auth.getToken, folderCache });
  queue = new UploadQueue({ store, drive, onChange: () => { saveFolders(); if (route().name === 'drive') render(); renderDriveBadge(); } });
  auth.onAuthChange(() => { renderDriveBadge(); if (!text.loaded) reloadText().then(rerenderTextViews); });
  queue.recover().catch(() => {});
  window.addEventListener('online', () => queue.kick());
  window.addEventListener('hashchange', render);
  render(); renderDriveBadge();
}
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
  if (s === 'signed-out') return h('div', { class: 'row text-actions' }, h('a', { href: '#/drive' }, 'Go to the Drive tab to sign in'));
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
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('on', a.getAttribute('href').startsWith('#/' + r.name)));
  if (recorder && r.name !== 'record') { await recorder.close(); recorder = null; }
  try {
    if (r.name === 'record') return await viewRecord(main, r.params.get('passage'));
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
    h('section', { class: 'older' }, h('h2', {}, 'Older pages (still live)'),
    h('ul', {}, ...Object.entries({ 'Reading Tracker': OLD.tracker, 'Voice Recorder (old)': OLD.recorder, 'Rolling Reader': OLD.reader, 'Cross-references': OLD.xref, 'Concordance of Even': OLD.concordance })
      .map(([k, v]) => h('li', {}, h('a', { href: v, target: '_blank', rel: 'noopener' }, k))))),
  );
}

async function viewDrive(main) {
  const ups = (await store.allUploads()).sort((a, b) => b.updatedAt - a.updatedAt);
  const btn = h('button', { onclick: async () => { try { await auth.signIn(); await queue.resumeAfterSignIn(); render(); } catch (e) { alert(e.message); } } }, auth.isSignedIn() ? 'Sign in again' : 'Sign in with Google');
  main.append(h('h1', {}, 'Google Drive'),
    h('p', { class: 'lead' }, 'Recordings are saved to "KJV Recordings" in your Drive. This site can only see files it saved itself (drive.file permission). Replaced takes are moved to a "_replaced" folder, never deleted.'),
    h('div', { class: 'row' }, btn, auth.isSignedIn() ? h('button', { onclick: () => { auth.signOut(); render(); } }, 'Sign out') : null,
      h('button', { onclick: async () => { for (const u of await store.allUploads()) if (u.state === U.UPLOAD_FAILED) await store.putUpload({ ...u, nextAt: 0 }); queue.kick(); } }, 'Retry failed uploads')),
    h('div', { class: 'table-wrap' }, h('table', {}, h('tr', {}, h('th', {}, 'Verse'), h('th', {}, 'Take'), h('th', {}, 'Upload'), h('th', {}, 'Note')),
      ...ups.map(u => h('tr', {}, h('td', {}, refOf(u.verseId)), h('td', {}, u.takeNo), h('td', { class: 'st-' + u.state }, u.state), h('td', {}, u.error || ''))))));
}

// ---------- Recorder view ----------
async function viewRecord(main, passage) {
  if (!passage) { main.append(h('h1', {}, 'Record'), passageForm('record')); return; }
  const p = parsePassage(passage);
  if (recorder && recorder.passage !== formatPassage(p)) { await recorder.close(); recorder = null; }
  if (!recorder) recorder = await new Recorder({ passage: p, store, queue, openMic, textSource: text, onUpdate: () => paint() }).load();
  const rec = recorder;
  const title = h('h1', {}), verseRef = h('div', { class: 'ref' }), verseText = h('div', { class: 'verse' }), status = h('div', { class: 'status' });
  const msg = h('div', { class: 'msg' }), controls = h('div', { class: 'row big' }), reviewBox = h('div', {}), list = h('ol', { class: 'verses' });
  main.append(title, h('section', { class: 'card reading' }, verseRef, verseText, text.loaded ? h('div', {}) : textActions()), h('section', { class: 'card controls' }, status, msg, controls, reviewBox), h('h2', {}, 'Verses'), list,
    h('p', {}, h('a', { href: `#/stitch?passage=${encodeURIComponent(rec.passage)}` }, 'Go to StitchBot for this passage')));

  async function paint() {
    if (recorder !== rec) return;
    title.textContent = `Record ${rec.passage}`;
    verseRef.textContent = refOf(rec.verseId);
    verseText.textContent = text.text(rec.verseId) ?? (text.loaded ? '(No text for this verse.)' : textStatusLine());
    status.textContent = ({ IDLE: 'Ready', ARMING: 'Listening to the room…', ARMED: 'Speak now', RECORDING: 'Recording… tap Stop when done', PROCESSING: 'Processing…', REVIEW: 'Listen back, then Accept or Re-record', FAILED_CHECK: 'This take failed a check. Please re-record.', SAVING: 'Saving…', SAVED: 'Saved', SKIPPED: 'Skipped', MIC_DENIED: 'Microphone blocked', MIC_LOST: 'Microphone lost', NO_SPEECH: 'No speech heard', STORAGE_FULL: 'Storage full' })[rec.state] || rec.state;
    status.className = 'status s-' + rec.state;
    msg.textContent = rec.message || '';
    const b = (label, fn, cls = '') => h('button', { class: cls, onclick: fn }, label);
    controls.replaceChildren(...({
      ARMING: [b('Cancel', () => rec.cancel())],
      ARMED: [b('Start now', () => rec.tapStart(), 'rec'), b('Cancel', () => rec.cancel())],
      RECORDING: [b('Stop', () => rec.stop(), 'stop')],
      REVIEW: [b('Accept', () => rec.accept(), 'ok'), b('Re-record', () => rec.record()), b('Skip', () => rec.skip())],
      FAILED_CHECK: [b('Re-record', () => rec.record(), 'rec'), b('Skip', () => rec.skip())],
      STORAGE_FULL: [b('Try saving again', () => rec.accept())],
      PROCESSING: [], SAVING: [],
    }[rec.state] || [b(rec.state === S.SAVED || rec.statuses[rec.verseId] === S.SAVED ? 'Re-record this verse' : 'Record', () => rec.record(), 'rec'), b('Skip', () => rec.skip())]));
    reviewBox.replaceChildren();
    if (rec.review && (rec.state === S.REVIEW || rec.state === S.FAILED_CHECK)) {
      const url = URL.createObjectURL(new Blob([rec.review.wav], { type: 'audio/wav' }));
      const bad = Object.entries(rec.review.checks).filter(([, c]) => c.status === 'FAIL' || c.status === 'WARN');
      reviewBox.append(h('audio', { controls: true, src: url }), drawWave(rec.review.wav),
        h('ul', { class: 'checks' }, ...(bad.length ? bad.map(([k, c]) => h('li', { class: 'c-' + c.status }, `${k}: ${c.status} (${c.value})`)) : [h('li', { class: 'c-PASS' }, 'All checks passed')])));
    }
    const ups = await store.allUploads().catch(() => []);
    const upBy = {}; for (const u of ups) { const t = await store.getTake(u.takeId); if (t && t.status === 'accepted') upBy[u.verseId] = u.state; }
    list.replaceChildren(...rec.ids.map((id, i) => h('li', { class: (i === rec.index ? 'cur ' : '') + 'v-' + (rec.statuses[id] || 'NONE') },
      h('button', { class: 'link', onclick: () => { try { rec.select(i); } catch (e) { rec.message = e.message; paint(); } } }, refOf(id)),
      ' ', rec.statuses[id] || '', upBy[id] ? ` · Drive ${upBy[id]}` : '')));
  }
  paint();
}

function drawWave(wavBuf) {
  const c = h('canvas', { width: 600, height: 80, class: 'wave' }); const g = c.getContext('2d');
  const dv = new DataView(wavBuf); const n = (wavBuf.byteLength - 44) >> 1; g.fillStyle = '#356';
  for (let x = 0; x < 600; x++) {
    let mx = 0; const s = Math.floor(x * n / 600), e = Math.floor((x + 1) * n / 600);
    for (let i = s; i < e; i += 8) mx = Math.max(mx, Math.abs(dv.getInt16(44 + i * 2, true)) / 32768);
    g.fillRect(x, 40 - mx * 40, 1, Math.max(1, mx * 80));
  }
  return c;
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
