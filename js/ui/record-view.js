// Record page, rebuilt on the old Voice Recorder (transcript-tidier.html): the same cards, look and words
// ("Passage" with "Pick from the Bible" and the passage text box, "1. Your reading", "2. Make the clean version",
// "3. Your audio" with Send to Rolling Reader / Download WAV / Save or share), inside the shared site bar.
// Changed from the old page: recording is per verse (Record / Stop / Send), each verse is its own WAV saved to this device,
// card 2 runs StitchBot by itself when the last verse is sent, and a "Passages to record" list comes from the tracker.
// Card 1 shows the passage text box (with A-/A+ and verse numbers) ABOVE the Record / Send / Re-record buttons.
import { parsePassage, formatPassage, expandPassage, refOf, fileNameOf, parseId } from '../kjv/ref.js';
import { BOOKS } from '../kjv/books.js';
import { VerseRecorder, V } from '../recorder/verse-flow.js';
import { PassagePipeline } from '../recorder/pipeline.js';
import { takeHandoff, chunkStatuses, nextChunkIndex } from '../recorder/chunks.js';
import { readerInfo, sendToReader } from '../reader/handoff.js';
import { S } from '../recorder/state.js';
import { DeviceSaver, saveFile, shareFile, canShareFiles } from '../save/device-save.js';

let rec = null, pipe = null, paintNow = null, timer = 0;
export async function closeRecorder() { clearInterval(timer); timer = 0; paintNow = null; if (rec) await rec.close(); rec = null; pipe = null; }
/** Called by the app when the verse text changes. */
export function recorderPoke() { if (pipe) pipe.refresh().catch(() => {}); if (paintNow) paintNow(); }

const PT_SIZES = [0.95, 1.05, 1.15, 1.25, 1.4, 1.55, 1.75, 2, 2.3];
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const mmss = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export async function viewRecord(main, ctx) {
  const { h, params, store, text, openMic } = ctx;
  const saveFn = ctx.saveFile || saveFile, saver = new DeviceSaver({ store, save: saveFn });
  const passageParam = params.get('passage');
  const handoff = takeHandoff(params);
  let p = null, perr = '';
  if (passageParam) { try { p = parsePassage(passageParam); } catch (e) { perr = e.message; } }
  const label = p ? formatPassage(p) : '';
  if (rec && rec.passage !== label) await closeRecorder();
  if (p && !rec) {
    rec = await new VerseRecorder({ passage: p, store, saver, openMic, textSource: text, onUpdate: () => paintNow && paintNow() }).load();
    pipe = new PassagePipeline({ passage: p, store, save: saveFn, textSource: text, onUpdate: () => paintNow && paintNow() });
    pipe.run().catch(e => pipe && pipe.set('gate', 'bad', `Gate: ${e.message}`));
  }
  const R = rec, P = pipe;

  const wrap = h('div', { class: 'tt' + (p ? ' has-p' : '') });
  main.append(wrap);
  wrap.append(h('h1', {}, p ? `Record ${label}` : 'Record'));

  // ---------- Passages to record (from the tracker) ----------
  const chunkCard = h('section', { class: 'card chunks', 'aria-labelledby': 'h-chunks' }, h('h2', { id: 'h-chunks' }, 'Passages to record'));
  wrap.append(chunkCard);
  const chunkList = h('div', { class: 'chunklist' });
  chunkCard.append(chunkList);
  async function paintChunks() {
    if (!handoff || !handoff.chunks.length) {
      chunkList.replaceChildren(h('p', { class: 'note' }, 'Your list comes from the Reading Tracker: tap Record on any Lined up row there and the next passages appear here, with the one to record next marked. You can also type a passage below.'));
      return;
    }
    const sts = await chunkStatuses(handoff, store), ni = nextChunkIndex(sts, handoff.next);
    chunkList.replaceChildren(
      h('p', { class: 'note' }, `From the Reading Tracker (${new Date(handoff.receivedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}). Tap a passage to record it.`),
      h('ol', { class: 'chunkol' }, ...sts.map((c, i) => {
        const cur = c.passage && c.passage === label, nxt = i === ni;
        const st = c.error ? c.error : c.done ? 'All verses sent' : c.sent ? `${c.sent} of ${c.total} verses sent` : `${c.total} verse${c.total === 1 ? '' : 's'}`;
        const body = [nxt ? h('span', { class: 'nexttag' }, 'Record this one next') : null, h('strong', {}, c.passage || c.ref), h('span', { class: 'cmeta' }, (c.n ? `Plan video #${c.n} · ` : '') + st)];
        return h('li', { class: 'chunk' + (nxt ? ' next' : '') + (cur ? ' cur' : '') + (c.done ? ' done' : '') },
          c.passage ? h('a', { class: 'chunkbtn', href: `#/record?passage=${encodeURIComponent(c.passage)}`, 'aria-current': cur ? 'true' : false }, ...body) : h('div', { class: 'chunkbtn off' }, ...body));
      })));
    const n = chunkList.querySelector('.chunk.next'); if (n && !p && n.scrollIntoView) n.scrollIntoView({ block: 'nearest' });
  }
  paintChunks();

  // ---------- Passage card (old "Passage" card: Pick from the Bible, typed passage, passage text) ----------
  const inp = h('input', { type: 'text', id: 'passage', value: label || passageParam || '', autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'go', placeholder: 'e.g. Genesis 1 1-5, Gen 3:14-19, 1 John 2 3', 'aria-describedby': 'passageStatus' });
  const openBtn = h('button', { type: 'submit' }, 'Open recorder');
  const pstatus = h('div', { class: 'pstatus', id: 'passageStatus', 'aria-live': 'polite' });
  const say = (t, bad) => { pstatus.textContent = t; pstatus.classList.toggle('bad', !!bad); };
  const applyTyped = () => { try { const q = formatPassage(parsePassage(inp.value)); if (q === label) return say(`${q} is open.`); location.hash = `#/record?passage=${encodeURIComponent(q)}`; } catch (e) { say(e.message, true); } };
  let typeT = 0;
  inp.addEventListener('input', () => { clearTimeout(typeT); typeT = setTimeout(() => { // forgiving preview after 600 ms; opens on Enter / the button
    if (!inp.value.trim()) return say('');
    try { const q = parsePassage(inp.value), n = expandPassage(q).length; say(`${formatPassage(q)} · ${n} verse${n === 1 ? '' : 's'}. Tap Open recorder.`); } catch (e) { say(e.message, true); }
  }, 600); });
  const form = h('form', { class: 'prow', onsubmit: ev => { ev.preventDefault(); applyTyped(); } }, inp, openBtn);
  const sel = (id) => h('select', { id });
  const pkBook = sel('pkBook'), pkCh = sel('pkCh'), pkFrom = sel('pkFrom'), pkTo = sel('pkTo');
  const opt = (v, t, on) => { const o = h('option', { value: v }, t); if (on) o.selected = true; return o; };
  const fillPick = (bi, ch, fv, tv) => {
    const b = BOOKS[bi]; pkBook.replaceChildren(...BOOKS.map((x, i) => opt(i, x.name, i === bi)));
    pkCh.replaceChildren(...b.counts.map((_, i) => opt(i + 1, i + 1, i + 1 === ch)));
    const n = b.counts[ch - 1]; pkFrom.replaceChildren(...Array.from({ length: n }, (_, i) => opt(i + 1, i + 1, i + 1 === fv)));
    pkTo.replaceChildren(...Array.from({ length: n - fv + 1 }, (_, i) => opt(fv + i, fv + i, fv + i === tv)));
  };
  const bi0 = p ? BOOKS.findIndex(b => b.code === p.code) : 0;
  fillPick(bi0, p ? p.start.chapter : 1, p ? p.start.verse : 1, p && p.end.chapter === p.start.chapter ? p.end.verse : p ? p.start.verse : 1);
  const pickVal = () => ({ bi: +pkBook.value, ch: +pkCh.value, fv: +pkFrom.value, tv: +pkTo.value });
  pkBook.addEventListener('change', () => fillPick(+pkBook.value, 1, 1, 1));
  pkCh.addEventListener('change', () => { const v = pickVal(); fillPick(v.bi, v.ch, 1, 1); });
  pkFrom.addEventListener('change', () => { const v = pickVal(); fillPick(v.bi, v.ch, v.fv, Math.max(v.fv, v.tv)); });
  const pickGo = h('button', { type: 'button', onclick: () => { const v = pickVal(); location.hash = `#/record?passage=${encodeURIComponent(`${BOOKS[v.bi].refBook} ${v.ch}:${v.fv}${v.tv > v.fv ? '-' + v.tv : ''}`)}`; } }, 'Open these verses');
  const pf = (lab, s) => h('div', { class: 'pf' }, h('label', { for: s.id }, lab), s);
  const pick = h('details', { class: 'pick' }, h('summary', {}, 'Pick from the Bible'), h('div', { class: 'pickgrid' }, pf('Book', pkBook), pf('Chapter', pkCh), pf('From verse', pkFrom), pf('To verse', pkTo)), h('div', { class: 'btnrow', style: 'margin-top:12px' }, pickGo));

  // passage text box
  let ptSize = Math.min(PT_SIZES.length - 1, Math.max(0, parseInt(lsGet('tt.ptSize', '3'), 10) || 3)), ptNums = lsGet('tt.ptNums', '1') !== '0';
  const ptRef = h('strong', { id: 'ptRef' }, 'Passage text'), ptMeta = h('span', { id: 'ptMeta' });
  const ptNumsBox = h('input', { type: 'checkbox', id: 'ptNums' }); ptNumsBox.checked = ptNums;
  const ptSmaller = h('button', { type: 'button', class: 'ghost', 'aria-label': 'Smaller text' }, 'A\u2212'), ptBigger = h('button', { type: 'button', class: 'ghost', 'aria-label': 'Bigger text' }, 'A+');
  const ptText = h('div', { class: 'pttext', id: 'ptText', tabindex: '0', 'aria-label': 'Passage text to read aloud' });
  const ptPrefs = () => { ptText.style.fontSize = PT_SIZES[ptSize] + 'rem'; ptText.classList.toggle('nonum', !ptNums); ptSmaller.disabled = ptSize <= 0; ptBigger.disabled = ptSize >= PT_SIZES.length - 1; lsSet('tt.ptSize', String(ptSize)); lsSet('tt.ptNums', ptNums ? '1' : '0'); };
  ptSmaller.addEventListener('click', () => { ptSize--; ptPrefs(); }); ptBigger.addEventListener('click', () => { ptSize++; ptPrefs(); });
  ptNumsBox.addEventListener('change', () => { ptNums = ptNumsBox.checked; ptPrefs(); }); ptPrefs();
  const ptBox = h('div', { class: 'ptbox', role: 'region', 'aria-labelledby': 'ptRef' }, h('div', { class: 'pthead' }, ptRef, ptMeta),
    h('div', { class: 'ptctl' }, h('label', { class: 'check' }, ptNumsBox, ' Show verse numbers'), h('span', { class: 'ptsize' }, ptSmaller, ptBigger)), ptText);
  wrap.append(h('section', { class: 'card', 'aria-labelledby': 'h-pass' }, h('h2', { id: 'h-pass' }, h('label', { for: 'passage', style: 'display:inline;min-height:0;margin:0' }, 'Passage')),
    pick, form, pstatus));
  if (perr) say(perr, true); else if (p) say(`${label} · ${R.ids.length} verse${R.ids.length === 1 ? '' : 's'} · one file per verse, e.g. ${fileNameOf(R.ids[0])}`);
  else say('Tap a passage in your list, pick from the Bible, or type one (spaces, colons and short names all work: "Gen 1 1-5").');

  function ptMsg(m, actions = []) { ptText.replaceChildren(h('p', { class: 'ptmsg' }, m), ...actions); }
  let paintedLoaded = false;
  function paintText() {
    paintedLoaded = text.loaded;
    if (!p) return;
    ptRef.textContent = label; ptMeta.textContent = `${R.ids.length} verse${R.ids.length === 1 ? '' : 's'} · King James Version (CrossWire KJV)`;
    if (!text.loaded) {
      const s = ctx.textStatus().status, acts = [];
      if (s === 'error') acts.push(h('button', { type: 'button', onclick: async () => { await ctx.reloadText(); recorderPoke(); } }, 'Try again'));
      ptMsg(ctx.textStatusLine(), acts.length ? [h('div', { class: 'btnrow' }, ...acts)] : []);
      return;
    }
    let lastCh = null; const paras = [];
    for (const [i, id] of R.ids.entries()) {
      const { chapter, verse } = parseId(id);
      const sp = h('span', { class: 'pv' + (i === R.index ? ' cur' : '') + (R.statuses[id] === S.SAVED ? ' sent' : ''), 'data-i': i },
        h('span', { class: 'vn' }, chapter !== lastCh && R.ids.length > 1 && lastCh !== null ? `${chapter}:${verse}` : String(verse)), text.text(id) ?? '(no text for this verse)', ' ');
      if (chapter !== lastCh) { paras.push(h('p', {})); lastCh = chapter; }
      paras[paras.length - 1].append(sp);
    }
    ptText.replaceChildren(...paras);
    const c = ptText.querySelector('.pv.cur'); if (c && c.scrollIntoView && ptText.scrollHeight > ptText.clientHeight) { const top = c.offsetTop - ptText.offsetTop - 12; ptText.scrollTop = Math.max(0, top); }
  }

  if (!p) return;

  // ---------- 1. Your reading ----------
  const rtRef = h('strong', {}), rtFile = h('span', {});
  const recBtn = h('button', { type: 'button', class: 'rec', 'aria-pressed': 'false' }, 'Record');
  const sendBtn = h('button', { type: 'button', class: 'send' }, 'Send');
  const reBtn = h('button', { type: 'button', class: 'ghost' }, 'Re-record');
  const againBtn = h('button', { type: 'button', class: 'ghost save-again', hidden: true }, 'Save again');
  const shareBtn = h('button', { type: 'button', class: 'ghost share-verse', hidden: true }, 'Share or Save to Files');
  const saveNote = h('p', { class: 'note savenote', 'aria-live': 'polite' });
  const inStatus = h('div', { class: 'status', 'aria-live': 'polite' }), inWarn = h('div', { class: 'warn', hidden: true });
  const review = h('div', { class: 'review' }), verses = h('ol', { class: 'verses', 'aria-label': 'Verses in this passage' });
  recBtn.addEventListener('click', () => { if (R.state === V.RECORDING) R.stop(); else R.record(); });
  reBtn.addEventListener('click', () => R.record());
  const saveAgain = async id => { const r = await saver.saveAgain(id); R.message = r.ok ? '' : `Could not save ${r.name}: ${r.message}`; await pipe.refresh(); paint(); };
  againBtn.addEventListener('click', () => saveAgain(R.verseId));
  shareBtn.addEventListener('click', async () => { const t = await store.acceptedTake(R.verseId); if (!t) return; try { await shareFile(t.fileName || R.fileName, t.wav, 'audio/wav'); } catch (e) { if (e && e.name !== 'AbortError') { R.message = 'Could not share: ' + e.message; paint(); } } });
  sendBtn.addEventListener('click', async () => { await R.send(); if (R.complete) pipe && pipe.run({ force: true }); else pipe && pipe.refresh(); });
  wrap.append(h('section', { class: 'card', 'aria-labelledby': 'h-in' }, h('h2', { id: 'h-in' }, '1. Your reading'),
    h('p', { class: 'readtitle' }, rtRef, rtFile),
    ptBox, // Robin: the verse text sits ABOVE the Record / Send / Re-record buttons, in the same card
    h('div', { class: 'btnrow recrow' }, recBtn, sendBtn, reBtn), inStatus, inWarn, review,
    h('div', { class: 'btnrow saverow' }, againBtn, shareBtn), saveNote,
    h('details', { class: 'vlist', open: R.ids.length <= 12 }, h('summary', {}, 'Verses'), verses)));

  // ---------- 2. Make the clean version (runs by itself) ----------
  const steps = h('ul', { class: 'steps pipeline', 'aria-live': 'polite' });
  const stepBtns = h('div', { class: 'btnrow', style: 'margin-top:12px' });
  wrap.append(h('section', { class: 'card', 'aria-labelledby': 'h-go' }, h('h2', { id: 'h-go' }, '2. Make the clean version'),
    h('p', { class: 'note' }, 'This runs by itself after you send the last verse: each verse is trimmed (Snip Snip) when you tap Stop, the gate checks them all, StitchBot joins them with a 0.4 s break and saves the result to this device. Nothing is uploaded anywhere.'),
    steps, stepBtns));

  // ---------- 3. Your audio ----------
  const outTitle = h('span', {}, 'Your audio'), summary = h('div', { class: 'summary' }), player = h('audio', { controls: true, preload: 'metadata' });
  const toReader = h('button', { type: 'button' }, 'Send to Rolling Reader');
  const dlWav = h('a', { class: 'btn', download: 'reading.wav', href: '#' }, 'Download WAV');
  const share = h('button', { type: 'button', class: 'ghost', hidden: true }, 'Save or share');
  const dlTim = h('a', { class: 'btn ghost', download: 'timings.json', href: '#' }, 'Download timings');
  const sendStatus = h('p', { class: 'sendstatus', role: 'status', 'aria-live': 'polite', hidden: true });
  const result = h('section', { class: 'card', id: 'result', hidden: true, 'aria-labelledby': 'h-out' }, h('h2', { id: 'h-out' }, h('span', { 'aria-hidden': 'true' }, '3. '), outTitle),
    summary, player, h('div', { class: 'btnrow' }, toReader, dlWav, share, dlTim), sendStatus);
  wrap.append(result);
  const sendSay = (t, bad) => { sendStatus.textContent = t; sendStatus.classList.toggle('bad', !!bad); sendStatus.hidden = !t; };
  toReader.addEventListener('click', () => { const r = P.result; if (!r) return; sendToReader({ wav: r.wav, info: readerInfo(p, r.timings, r.wavName, text), say: sendSay }); });
  share.addEventListener('click', async () => { const r = P.result; if (!r) return; try { const f = new File([r.wav], r.wavName, { type: 'audio/wav' }); await navigator.share({ files: [f], title: r.wavName }); } catch (e) { if (e && e.name !== 'AbortError') sendSay('Could not share: ' + e.message, true); } });

  wrap.append(h('p', {}, h('a', { href: `#/stitch?passage=${encodeURIComponent(label)}` }, 'Open StitchBot for this passage (gate report)')));

  // ---------- painting ----------
  let reviewKey = null, resultKey = null, lastIndex = -1;
  async function paint() {
    if (rec !== R) return;
    rtRef.textContent = R.ref; rtFile.textContent = `Verse ${R.index + 1} of ${R.ids.length} · file ${R.fileName}`;
    const st = R.state, recording = st === V.RECORDING;
    recBtn.classList.toggle('on', recording); recBtn.setAttribute('aria-pressed', recording ? 'true' : 'false');
    recBtn.textContent = recording ? `Stop recording (${mmss(Date.now() - R.startedAt)})` : st === V.STARTING ? 'Starting the microphone\u2026' : (R.statuses[R.verseId] === S.SAVED ? 'Record this verse again' : 'Record');
    recBtn.disabled = st === V.STARTING || st === V.PROCESSING || st === V.SENDING;
    sendBtn.disabled = !(st === V.READY || st === V.STORAGE_FULL);
    reBtn.disabled = !(st === V.READY || st === V.FAILED_CHECK || st === V.NO_SPEECH);
    const words = ({
      IDLE: 'Tap Record and read the verse. Tap Stop when you finish.', STARTING: 'Starting the microphone\u2026',
      RECORDING: 'Recording\u2026 tap Stop recording when you finish the verse.', PROCESSING: 'Snip Snip: trimming the start and end\u2026',
      READY: 'Listen back if you like, then tap Send. Record again replaces this take.', FAILED_CHECK: 'This take failed a check. Tap Re-record.',
      NO_SPEECH: 'No speech heard. Tap Record and read the verse.', SENDING: 'Saving this verse\u2026',
      SAVED: R.complete ? 'Every verse is sent. Card 2 is making the clean version.' : 'Sent. Tap Record for the next verse.',
      MIC_DENIED: 'Microphone blocked.', MIC_LOST: 'Microphone lost.', STORAGE_FULL: 'This device is out of storage. Free some space, then tap Send again.',
    })[st] || st;
    inStatus.textContent = words; inStatus.className = 'status s-' + st;
    inWarn.hidden = !R.message; inWarn.textContent = R.message || '';
    // review player for the snipped take
    const tk = R.take;
    if (tk !== reviewKey) {
      reviewKey = tk; review.replaceChildren();
      if (tk) {
        const bad = Object.entries(tk.checks).filter(([, c]) => c.status === 'FAIL' || c.status === 'WARN');
        review.append(h('audio', { controls: true, src: URL.createObjectURL(new Blob([tk.wav], { type: 'audio/wav' })) }),
          h('p', { class: 'note' }, `Snipped: ${tk.meta.durationS.toFixed(1)} s, level ${tk.meta.lufs.toFixed(1)} LUFS.`),
          h('ul', { class: 'checks' }, ...(bad.length ? bad.map(([k, c]) => h('li', { class: 'c-' + c.status }, `${k}: ${c.status} (${c.value})`)) : [h('li', { class: 'c-PASS' }, 'All checks passed')])));
      }
    }
    // verse list with per-verse status (kept here / downloaded) and Save again
    const savedBy = {};
    for (const id of R.ids) { const t = await store.acceptedTake(id); if (t) { const s = await saver.savedInfo(id); savedBy[id] = s && s.takeId === t.takeId ? s : false; } }
    if (rec !== R) return;
    const when = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    verses.replaceChildren(...R.ids.map((id, i) => h('li', { class: (i === R.index ? 'cur ' : '') + (R.statuses[id] === S.SAVED ? 'sent' : '') },
      h('button', { type: 'button', class: 'link', onclick: () => { try { R.select(i); } catch (e) { R.message = e.message; paint(); } } }, refOf(id)),
      h('span', { class: 'vst' }, R.statuses[id] === S.SAVED ? (savedBy[id] ? ` saved to this device as ${fileNameOf(id)} (${when(savedBy[id].savedAt)})` : ` kept on this device · not downloaded yet`) : i === R.index ? ' recording this one' : ' not sent yet'),
      R.statuses[id] === S.SAVED && id in savedBy ? h('button', { type: 'button', class: 'ghost small save-again-v', onclick: () => saveAgain(id) }, 'Save again') : null)));
    { const sent = R.statuses[R.verseId] === S.SAVED && R.verseId in savedBy;
      againBtn.hidden = !sent; shareBtn.hidden = !sent || !canShareFiles();
      saveNote.textContent = sent ? (savedBy[R.verseId] ? `${R.fileName} was saved to this device (your Downloads; on iPad, Files \u203a Downloads). Recording this verse again replaces it under the same name. Save again downloads it again.` : `${R.fileName} is kept on this device but was not downloaded. Tap Save again.`) : ''; }
    if (lastIndex !== R.index) { lastIndex = R.index; paintText(); } else if (!text.loaded || paintedLoaded !== text.loaded) paintText();
    // pipeline lines
    const lines = [['captured', P.stage.captured], ['saved', P.stage.saved], ['gate', P.stage.gate], ['stitched', P.stage.stitched],
      ['rendered', { ...P.stage.rendered, text: 'MP4 rendered: ' + P.stage.rendered.text }], ['mp4', { ...P.stage.mp4, text: 'MP4 saved: ' + P.stage.mp4.text }]];
    steps.replaceChildren(...lines.map(([k, s]) => h('li', { class: 'st-' + s.state, 'data-s': k }, h('span', { class: 'sr-only' }, s.state + ': '), s.text || '')));
    const btns = [];
    if (P.stage.gate.state === 'wait') btns.push(h('button', { type: 'button', onclick: () => { P.acceptWarnings = true; P.run({ acceptWarnings: true, force: true }); } }, 'OK the warnings and stitch'));
    stepBtns.replaceChildren(...btns);
    // card 3
    const r = P.result;
    result.hidden = !r;
    if (r && r !== resultKey) {
      resultKey = r; outTitle.textContent = `Your audio: ${label}`;
      const url = URL.createObjectURL(new Blob([r.wav], { type: 'audio/wav' }));
      player.src = url; dlWav.href = url; dlWav.download = r.wavName; dlWav.textContent = `Download ${r.wavName}`;
      dlTim.href = URL.createObjectURL(new Blob([JSON.stringify(r.timings, null, 2)], { type: 'application/json' })); dlTim.download = r.timingsName;
      summary.textContent = `${R.ids.length} verse${R.ids.length === 1 ? '' : 's'}, ${(r.timings.total_samples / r.timings.sample_rate).toFixed(1)} s, ${r.timings.gap_s} s between verses.`;
      try { share.hidden = !(navigator.canShare && navigator.canShare({ files: [new File([new Uint8Array(1)], 'x.wav', { type: 'audio/wav' })] })); } catch { share.hidden = true; }
    }
  }
  paintNow = () => { paint().catch(e => console.error(e)); };
  clearInterval(timer); timer = setInterval(() => { if (rec === R && R.state === V.RECORDING) recBtn.textContent = `Stop recording (${mmss(Date.now() - R.startedAt)})`; }, 500);
  paintText(); paintNow();
}
