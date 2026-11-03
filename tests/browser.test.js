// Browser-only tests: IndexedDB store and AudioWorklet capture (headless Chrome with a fake microphone).
import { test, eq, ok, deepEq } from './lib.js';
import { Store } from '../js/store/db.js';
import { openMic } from '../js/recorder/capture.js';

test('browser: IndexedDB store keeps every take; accept supersedes, never deletes', async () => {
  const s = new Store('kjv-site-test-' + Date.now());
  const wav = new Uint8Array([1, 2, 3]).buffer;
  await s.putTake({ takeId: 'GEN.1.1#1', verseId: 'GEN.1.1', takeNo: 1, status: 'review', wav });
  await s.acceptTake('GEN.1.1#1');
  eq(await s.nextTakeNo('GEN.1.1'), 2);
  await s.putTake({ takeId: 'GEN.1.1#2', verseId: 'GEN.1.1', takeNo: 2, status: 'review', wav });
  await s.acceptTake('GEN.1.1#2');
  deepEq((await s.takesFor('GEN.1.1')).map(t => t.status), ['superseded', 'accepted']);
  eq((await s.acceptedTake('GEN.1.1')).takeNo, 2);
  await s.saveSession({ passage: 'Genesis 1:1', statuses: { 'GEN.1.1': 'SAVED' } }); eq((await s.getSession('Genesis 1:1')).statuses['GEN.1.1'], 'SAVED');
  await s.putUpload({ takeId: 'GEN.1.1#2', state: 'QUEUED' }); eq((await s.allUploads()).length, 1);
  await s.setKv('k', { a: 1 }); eq((await s.getKv('k')).a, 1);
});
test('browser: AudioWorklet capture delivers Float32 blocks from the (fake) microphone', async () => {
  const chunks = []; let lost = null;
  const mic = await openMic({ onChunk: c => chunks.push(c), onLost: w => { lost = w; } });
  await new Promise(r => setTimeout(r, 1500));
  mic.flush && mic.flush(); await new Promise(r => setTimeout(r, 100));
  const n = chunks.reduce((t, c) => t + c.length, 0);
  ok(chunks.length > 3, 'chunks ' + chunks.length); ok(chunks[0] instanceof Float32Array);
  ok(n > mic.sampleRate * 0.8, `got ${n} samples at ${mic.sampleRate} Hz`);
  let energy = 0; for (const c of chunks) for (const v of c) energy += v * v; ok(energy > 0, 'fake device tone should be non-silent');
  window.__micRate = mic.sampleRate;
  await mic.close(); eq(lost, null);
});
test('browser: app.js boots without errors and never writes tracker keys', async () => {
  const before = Object.keys(localStorage).filter(k => k.startsWith('bible-coverage-tracker')).sort().join();
  const f = document.createElement('iframe'); f.src = '../index.html#/home'; document.body.append(f);
  await new Promise(r => f.onload = r); await new Promise(r => setTimeout(r, 800));
  ok(f.contentDocument.querySelector('#main h1'), 'home view rendered'); eq(f.contentWindow.__bootError || null, null);
  f.contentWindow.location.hash = '#/record?passage=Psalm%2023%3A1-3'; await new Promise(r => setTimeout(r, 600));
  eq(f.contentDocument.querySelector('#main h1').textContent, 'Record Psalm 23:1-3');
  ok(/not loaded/.test(f.contentDocument.querySelector('.verse').textContent), 'placeholder when no text');
  f.contentWindow.location.hash = '#/stitch?passage=Genesis%203%3A14-15'; await new Promise(r => setTimeout(r, 600));
  ok(/Not recorded yet/.test(f.contentDocument.querySelector('#main').textContent));
  eq(Object.keys(localStorage).filter(k => k.startsWith('bible-coverage-tracker')).sort().join(), before);
});
