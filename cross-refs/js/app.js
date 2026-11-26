// Cross Ref only. Copied tools modules live beside this file; data is loaded from ../data/.
import { Store, requestPersistentStorage } from './store/db.js';
import { MemoryStore } from './store/memory.js';
import { loadTextSource, TextSource, MESSAGES, MISSING_MESSAGE } from './kjv/text-source.js';
import { viewXref } from './ui/xref-view.js';
import { loadRedLetter } from '../../js/red-letter.js';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) { if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

let store, text = new TextSource(), textStatus = { status: 'missing', message: MISSING_MESSAGE };
let textLoading = null;

function reloadText() {
  if (textLoading) return textLoading;
  textLoading = (async () => {
    const r = await loadTextSource({ store });
    text.replaceWith(r.source); textStatus = r; try { window.dispatchEvent(new Event('kjv-text-changed')); } catch {}
  })().finally(() => { textLoading = null; });
  return textLoading;
}

function textStatusLine() {
  if (textLoading && !text.loaded) return MESSAGES.loading;
  return text.loaded ? `CrossWire KJV text loaded from ${text.label} (${text.map.size} verses).` : (textStatus.message || MISSING_MESSAGE);
}

function textActions() {
  if (textStatus.status === 'error') return h('div', { class: 'row text-actions' }, h('button', { onclick: async () => { await reloadText(); window.dispatchEvent(new Event('kjv-text-changed')); } }, 'Try again'));
  return h('div', { class: 'row text-actions' });
}

async function init() {
  try { store = new Store(); await store.getKv('ping'); } catch { store = new MemoryStore(); }
  requestPersistentStorage();
  for (const k of ['textSource', 'textCache.v1', 'refsCache.v1']) store.setKv(k, null).catch(() => {});
  reloadText();
  await loadRedLetter();
  const main = document.getElementById('main');
  await viewXref(main, { h, store, text, textStatusLine, textActions });
}

init().catch(e => { window.__bootError = e.message; console.error(e); });
