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
  // headless Chrome sometimes starts the fake device late: wait up to 8 s for about 1 s of audio (was a fixed 1.5 s; flaky)
  const t0 = Date.now(); let started = 0;
  while (Date.now() - t0 < 8000) { await new Promise(r => setTimeout(r, 100)); if (!started && chunks.length) started = Date.now() - t0; if (chunks.length > 12) break; }
  mic.flush && mic.flush(); await new Promise(r => setTimeout(r, 100));
  const n = chunks.reduce((t, c) => t + c.length, 0); window.__micStartMs = started;
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
  eq(f.contentDocument.querySelector('.text-status').textContent, 'Not signed in to Google. Tap Sign in to show the verse text when you want it; you can record without it.', 'Home and Record show the same text status');
  ok([...f.contentDocument.querySelectorAll('.text-actions button')].some(b => b.textContent === 'Sign in to show the verse text'), 'lazy sign-in button on Home (no Drive-tab detour)');
  ok(!/null/.test(f.contentDocument.querySelector('#main').textContent), 'no stray "null" in Home');
  { const apps = [...f.contentDocument.querySelectorAll('#apps-nav a')];
    eq(apps.map(a => a.firstChild.textContent.trim()).join(), 'Reading Tracker,Voice Recorder,Rolling Reader,Cross-references,Concordance of Even', 'apps nav lists the five old apps');
    ok(apps.every(a => a.target === '_blank' && /noopener/.test(a.rel) && /^https:\/\//.test(a.href)), 'old-app links open in a new tab');
    eq(f.contentDocument.querySelector('.older'), null, 'no "Older pages" list'); }
  f.contentWindow.location.hash = '#/record?passage=Psalm%2023%3A1-3'; await new Promise(r => setTimeout(r, 600));
  const d = f.contentDocument, $ = q => d.querySelector(q);
  eq($('#main h1').textContent, 'Record Psalm 23:1-3');
  eq($('.pttext .ptmsg').textContent, 'Not signed in to Google. Tap Sign in to show the verse text when you want it; you can record without it.', 'plain message while signed out and nothing is cached');
  ok([...d.querySelectorAll('.pttext button')].some(b => b.textContent === 'Sign in to show the verse text'), 'sign-in offered, not forced');
  eq(d.querySelector('script[src*="accounts.google.com"]'), null, 'opening the recorder does not start a Google sign-in');
  eq(f.contentWindow.getComputedStyle(d.body).fontFamily.split(',')[0].replace(/["']/g, ''), 'OpenDyslexic');
  eq($('.readtitle strong').textContent, 'Psalm 23:1'); ok(/Psalm 23-1\.wav/.test($('.readtitle span').textContent), 'hyphen file name shown');
  eq([...d.querySelectorAll('.tt h2')].map(x => x.textContent).join('|'), 'Passages to record|Passage|1. Your reading|2. Make the clean version|3. Your audio');
  { const pt = $('.pttext'), rb = $('button.rec'), sb = $('button.send');
    ok(pt && rb && (pt.compareDocumentPosition(rb) & Node.DOCUMENT_POSITION_FOLLOWING), 'verse text comes before the Record button in DOM order');
    ok(pt.compareDocumentPosition(sb) & Node.DOCUMENT_POSITION_FOLLOWING, 'verse text comes before Send');
    eq(pt.closest('section'), rb.closest('section'), 'verse text and Record button are in the same card (1. Your reading)');
    ok($('.ptbox').contains($('#ptNums')) && $('.ptbox').querySelectorAll('.ptsize button').length === 2, 'A-/A+ and verse-number toggle stay with the verse text');
    ok(pt.getBoundingClientRect().top < rb.getBoundingClientRect().top, 'verse text is drawn above the Record button'); }
  const lines = [...d.querySelectorAll('.steps.pipeline li')];
  eq(lines.map(l => l.dataset.s).join(), 'captured,drive,gate,stitched,queued,rendered,mp4');
  ok(/waiting for renderer/.test(lines[5].textContent) && /waiting for renderer/.test(lines[6].textContent), 'MP4 stages honest');
  ok(lines[5].classList.contains('st-wait') && !d.querySelector('.steps li[data-s=mp4].st-done'), 'MP4 never shown as done');
  ok($('#result').hidden, 'card 3 hidden until stitched');
  const recBtn = $('button.rec'), sendBtn = $('button.send');
  eq(recBtn.textContent, 'Record'); ok(sendBtn.disabled, 'Send waits for a take');
  recBtn.click(); for (let i = 0; i < 40 && !recBtn.classList.contains('on'); i++) await new Promise(r => setTimeout(r, 100));
  ok(recBtn.classList.contains('on') && /^Stop recording/.test(recBtn.textContent), 'Record turns into Stop recording: ' + recBtn.textContent);
  await new Promise(r => setTimeout(r, 1200)); recBtn.click();
  for (let i = 0; i < 40 && recBtn.classList.contains('on'); i++) await new Promise(r => setTimeout(r, 100));
  await new Promise(r => setTimeout(r, 600));
  ok(!recBtn.classList.contains('on'), 'Stop ends the recording'); ok(/Listen back|No speech|failed a check/.test($('.tt .status').textContent), 'Snip result shown: ' + $('.tt .status').textContent);
  // tracker hand-off: the list, NEXT marked, tapping opens that chunk
  f.contentWindow.location.hash = '#/record?passage=Genesis+3:14-15&next=Genesis+3:14-15&chunks=7~Genesis+3:14-15|8~Genesis+3:16|9~Genesis+50:26+to+Exodus+1:2'; await new Promise(r => setTimeout(r, 800));
  const chunks = [...d.querySelectorAll('.chunkol li')];
  eq(chunks.length, 3); ok(chunks[0].classList.contains('next') && /Record this one next/.test(chunks[0].textContent), 'NEXT marked');
  eq(d.querySelectorAll('.nexttag').length, 1); ok(/two books/.test(chunks[2].textContent), 'cross-book chunk explained');
  eq(chunks[1].querySelector('a').getAttribute('href'), '#/record?passage=Genesis%203%3A16');
  f.contentWindow.location.hash = chunks[1].querySelector('a').getAttribute('href'); await new Promise(r => setTimeout(r, 800));
  eq($('#main h1').textContent, 'Record Genesis 3:16'); eq(d.querySelectorAll('.chunkol li').length, 3, 'list kept after tapping a chunk');
  ok(d.querySelector('.chunkol li.cur a[aria-current=true]'), 'current chunk marked');
  eq(d.querySelector('input[type=file]'), null, 'no file input on Record');
  eq([...f.contentDocument.querySelectorAll('nav.tabs a')].map(a => a.textContent).join(), 'Home,Record,Stitch,Drive,Cross refs');
  f.contentWindow.location.hash = '#/text'; await new Promise(r => setTimeout(r, 400));
  eq(f.contentDocument.querySelector('#main h1').textContent, 'KJV reading site', '#/text falls back to Home');
  eq(f.contentDocument.querySelector('input[type=file]'), null, 'no file input anywhere');
  f.contentWindow.location.hash = '#/stitch?passage=Genesis%203%3A14-15'; await new Promise(r => setTimeout(r, 600));
  ok(/Not recorded yet/.test(f.contentDocument.querySelector('#main').textContent));
  eq(Object.keys(localStorage).filter(k => k.startsWith('bible-coverage-tracker')).sort().join(), before);
});
test('browser: Cross Ref Map loads a synthetic refs file, slider sets minimum votes, link box updates, animation toggles', async () => {
  localStorage.removeItem('kjv-site.xrefStep.v1');
  const f = document.createElement('iframe'); f.style.cssText = 'width:1180px;height:820px';
  f.src = '../index.html?refs=tests/fixtures/xref-synthetic.txt#/xref'; document.body.append(f);
  await new Promise(r => f.onload = r);
  const d = f.contentDocument, $ = q => d.querySelector(q);
  for (let i = 0; i < 50 && !(($('#xr-map') || {}).dataset || {}).total; i++) await new Promise(r => setTimeout(r, 100));
  eq($('#xr-map').dataset.total, '400', 'synthetic file loaded');
  ok([...d.querySelectorAll('nav.tabs a')].some(a => a.textContent === 'Cross refs' && a.classList.contains('on')), 'Cross refs tab is on');
  eq([...d.querySelectorAll('.xr-top h2')].map(x => x.textContent).join('|'), 'X ref map info|Link of the Day');
  ok(/OpenBible\.info/.test($('.xr-credit').textContent) && /CC-BY/.test($('.xr-credit').textContent), 'credit shown');
  eq(d.querySelectorAll('.xr-tick').length, 66, 'ruler has 66 books');
  const s = $('#xr-slider'); eq(s.min, '0'); eq(s.max, '5');
  eq($('#xr-count').textContent, 'Showing 180 refs (at least 10 votes)', 'default step is 10 votes');
  s.value = '0'; s.dispatchEvent(new Event('input')); eq($('#xr-count').textContent, 'Showing all 400 refs');
  s.value = '3'; s.dispatchEvent(new Event('input')); eq($('#xr-count').textContent, 'Showing 100 refs (at least 20 votes)');
  eq($('#xr-shown').textContent, '100');
  eq($('#xr-link-ref').textContent, 'No link chosen yet');
  $('#xr-pick').click(); ok(/→/.test($('#xr-link-ref').textContent), 'link box shows a link after Pick');
  ok(/Rank \d+ of 400/.test($('#xr-link-meta').textContent));
  d.querySelector('.xr-tick[data-book="0"]').click(); ok(/^Genesis|→ .*Genesis/.test($('#xr-link-ref').textContent) || /Genesis/.test($('#xr-link-ref').textContent), 'ruler tap selects a Genesis link');
  // tap the selected arc's apex on the canvas
  const W = f.contentWindow, st = W.__xref.state(), L = W.__xref.layout();
  $('#xr-save').click(); ok(/Prepared for later, no send route yet/.test($('#xr-note').textContent));
  ok(JSON.parse(W.localStorage.getItem('kjv-site.xrefSaved.v1')).length >= 1, 'saved locally');
  const b = $('#xr-play'), was = b.getAttribute('aria-pressed'); b.click();
  ok(b.getAttribute('aria-pressed') !== was, 'animation toggle'); eq($('#xr-map').dataset.playing, String(b.getAttribute('aria-pressed')));
  ok(st.sel >= 0 && L.x0 > 0);
  eq(d.querySelector('script[src*="accounts.google.com"]'), null, 'no sign-in started');
  f.remove();
});
function synthSet(N) {
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const s = { total: N, skipped: 0, from: new Int32Array(N), to: new Int32Array(N), toEnd: new Int32Array(N), votes: new Int32Array(N) };
  for (let i = 0; i < N; i++) { s.from[i] = Math.floor(rnd() * 31102); s.to[i] = s.toEnd[i] = Math.floor(rnd() * 31102); s.votes[i] = Math.max(-5, Math.round(400 * Math.pow(1 - i / N, 6))); }
  return s;
}
async function openXref(qs = '') {
  const f = document.createElement('iframe'); f.style.cssText = 'width:1180px;height:820px';
  f.src = '../index.html?refs=tests/fixtures/xref-synthetic.txt' + qs + '#/xref'; document.body.append(f);
  await new Promise(r => f.onload = r);
  for (let i = 0; i < 50 && !(f.contentDocument.querySelector('#xr-map') || { dataset: {} }).dataset.total; i++) await new Promise(r => setTimeout(r, 100));
  return f;
}
const frames = (W, ms) => new Promise(res => { const t = W.performance.now(); const f = () => W.performance.now() - t > ms ? res() : W.requestAnimationFrame(f); W.requestAnimationFrame(f); });
test('browser: Cross Ref Map perf: base layer and overlay frame times at 117,466 refs and at the "all" step', async () => {
  const f = await openXref(), W = f.contentWindow, X = W.__xref, out = [];
  for (const [N, step] of [[117466, 1], [344799, 0]]) {
    const set = synthSet(N); let c = 0; for (let i = 0; i < N; i++) if (set.votes[i] >= 5) c++;
    X.state().shown = step; X.setData(set); await X.redrawBase();
    const p0 = X.perf().baseMs; X.resetPerf(); await frames(W, 1500); const p = X.perf();
    out.push(`N=${N} step=${step} drawn=${f.contentDocument.querySelector('#xr-map').dataset.drawn} base=${p0.toFixed(0)}ms overlay avg=${p.avg.toFixed(2)}ms max=${p.max.toFixed(1)}ms frames=${p.frames}`);
    eq(Number(f.contentDocument.querySelector('#xr-map').dataset.drawn), 60000, 'draw cap holds');
    ok(p.avg < 16, 'overlay average under one 60 fps frame: ' + p.avg);
    const t = W.performance.now(); X.nearest(500, 300, 12); out.push(`index build+query ${(W.performance.now() - t).toFixed(0)}ms`);
  }
  window.__xrefPerf = out.join(' | '); console.log(window.__xrefPerf);
  f.remove();
});
test('browser: Cross Ref Map touch tap selects the nearest arc via the spatial index', async () => {
  const f = await openXref(), W = f.contentWindow, d = f.contentDocument, X = W.__xref;
  X.state().shown = 0; X.setData(X.state().set); await X.redrawBase();
  const ov = d.querySelector('.xr-over'), b = ov.getBoundingClientRect(), L = X.layout(), S = X.state().set;
  // apex of rank 0 arc
  const N = S.total; let x = 0, y = 0;
  { const y1 = L.y(S.from[0]), y2 = L.y((S.to[0] + S.toEnd[0]) / 2), ry = Math.max(0.5, Math.abs(y2 - y1) / 2); x = L.x0 + Math.max(2, L.maxW * Math.sqrt(ry * 2 / L.h)); y = (y1 + y2) / 2; }
  ov.dispatchEvent(new W.PointerEvent('pointerdown', { pointerType: 'touch', clientX: b.left + x, clientY: b.top + y, bubbles: true }));
  eq(X.state().sel, 0, 'tap on the top arc selects rank 1'); ok(/Rank 1 of 400/.test(d.querySelector('#xr-link-meta').textContent));
  ok(N === 400); f.remove();
});
test('browser: Cross Ref Map reduced motion: every animation off, changes jump', async () => {
  const f = await openXref('&motion=reduce'), d = f.contentDocument, m = d.querySelector('#xr-map');
  eq(m.dataset.reduced, 'true'); eq(m.dataset.playing, 'false'); eq(m.dataset.transition, 'jump', 'first load jumps (no wave)');
  ok(d.querySelector('#xr-play').disabled && /reduced motion/.test(d.querySelector('#xr-play').textContent));
  const s = d.querySelector('#xr-slider'); s.value = '1'; s.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 150));
  eq(m.dataset.transition, 'jump', 'slider jumps');
  f.remove();
  const g = await openXref(), m2 = g.contentDocument.querySelector('#xr-map');
  eq(m2.dataset.transition, 'wave', 'with motion: first-load wave'); eq(m2.dataset.playing, 'true');
  const s2 = g.contentDocument.querySelector('#xr-slider'); s2.value = '0'; s2.dispatchEvent(new Event('input')); await new Promise(r => setTimeout(r, 150));
  eq(m2.dataset.transition, 'draw-in', 'small slider change draws in');
  g.remove();
});
