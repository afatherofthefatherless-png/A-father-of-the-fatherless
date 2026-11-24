// Tests for the recorder rebuilt on the old Voice Recorder: per-verse Record / Stop / Send, Record again,
// Send -> saved to this device (one WAV per verse), the after-Send pipeline (with "waiting for renderer"), the tracker list, the Reader hand-off.
import { test, eq, ok, deepEq } from './lib.js';
import { Synth, SR } from './synth.js';
import { VerseRecorder, V } from '../js/recorder/verse-flow.js';
import { PassagePipeline, STAGES, RENDERER_MISSING } from '../js/recorder/pipeline.js';
import { SAVED_KEY } from '../js/save/device-save.js';
import { parseChunkParam, chunkParam, takeHandoff, chunkStatuses, nextChunkIndex, CHUNKS_KEY } from '../js/recorder/chunks.js';
import { readerInfo, sendToReader, READER_ORIGIN } from '../js/reader/handoff.js';
import { MemoryStore } from '../js/store/memory.js';
import { decodeWav } from '../js/recorder/wav.js';

function fakeMic() {
  const m = { opened: 0 };
  m.open = async ({ onChunk }) => { m.opened++; m.onChunk = onChunk; return { sampleRate: SR, close: async () => {}, flush() {} }; };
  m.feed = x => { for (let i = 0; i < x.length; i += 4096) m.onChunk(x.slice(i, i + 4096)); };
  return m;
}
function fakeQueue(store) { const q = { items: [], names: [] }; q.saveTake = async t => { q.items.push(t); q.names.push(t.fileName); await store.setKv(SAVED_KEY + t.verseId, { takeId: t.takeId, name: t.fileName, savedAt: 1, how: 'download' }); return { ok: true, how: 'download' }; }; return q; }
const verse = (seed, words = 6) => new Synth({ seed }).silence(0.5).phrase(words).silence(0.8).render();
async function readOne(rec, mic, seed, words) { await rec.record(); eq(rec.state, V.RECORDING); mic.feed(verse(seed, words)); await rec.stop(); }
const fakeLs = () => { const m = new Map(); return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k, v) => m.set(k, String(v)), m }; };

test('rebase: multi-verse passage -> one file per verse, hyphen names (Genesis 3-14.wav ...)', async () => {
  const store = new MemoryStore(), mic = fakeMic(), q = fakeQueue(store);
  const rec = await new VerseRecorder({ passage: 'Genesis 3:14-16', store, saver: q, openMic: mic.open, flushWaitMs: 0 }).load();
  const names = [];
  for (const [i, s] of [11, 12, 13].entries()) { names.push(rec.fileName); await readOne(rec, mic, s); eq(rec.state, V.READY, `verse ${i}`); await rec.send(); }
  deepEq(names, ['Genesis 3-14.wav', 'Genesis 3-15.wav', 'Genesis 3-16.wav']);
  ok(rec.complete, 'all sent'); eq(rec.sentCount, 3);
  deepEq(q.items.map(t => t.verseId), ['GEN.3.14', 'GEN.3.15', 'GEN.3.16']);
  for (const id of ['GEN.3.14', 'GEN.3.15', 'GEN.3.16']) { const t = await store.acceptedTake(id); ok(t && decodeWav(t.wav).sampleRate === SR, id + ' saved as its own WAV'); }
  ok(names.every(n => !n.includes(':')), 'no colons in file names');
});
test('rebase: Record again replaces the take (before Send and after Send)', async () => {
  const store = new MemoryStore(), mic = fakeMic(), q = fakeQueue(store);
  const rec = await new VerseRecorder({ passage: 'Psalm 23:1', store, saver: q, openMic: mic.open, flushWaitMs: 0 }).load();
  await readOne(rec, mic, 21, 4); const first = rec.take;
  await readOne(rec, mic, 22, 8); ok(rec.take !== first, 'new take replaces the unsent one'); ok(rec.take.wav.byteLength !== first.wav.byteLength, 'different audio');
  await rec.send(); const a = await store.acceptedTake('PSA.23.1');
  await readOne(rec, mic, 23, 5); await rec.send(); const b = await store.acceptedTake('PSA.23.1');
  ok(a.takeId !== b.takeId, 'new accepted take'); eq(b.fileName, 'Psalm 23-1.wav'); eq(a.fileName, b.fileName, 'same file name -> one file per verse, no version suffix');
  eq((await store.takesFor('PSA.23.1')).length, 1, 'retake overwrites: one take kept per verse');
  eq(q.items.length, 2); eq(q.items[1].takeId, b.takeId, 'second Send saves the new take');
});
test('rebase: Send saves that verse to this device as John 3-16.wav (state SAVED)', async () => {
  const store = new MemoryStore(), mic = fakeMic(), q = fakeQueue(store);
  const rec = await new VerseRecorder({ passage: 'John 3:16', store, saver: q, openMic: mic.open, flushWaitMs: 0 }).load();
  eq(q.items.length, 0); await readOne(rec, mic, 31); await rec.send();
  eq(q.items.length, 1); eq(q.items[0].verseId, 'JHN.3.16'); eq(q.items[0].status, 'accepted'); eq(q.items[0].fileName, 'John 3-16.wav');
  eq(rec.state, V.SAVED);
  deepEq(q.names, ['John 3-16.wav']);
});

async function sendAll(passage, store, seeds) {
  const mic = fakeMic(); const rec = await new VerseRecorder({ passage, store, saver: fakeQueue(store), openMic: mic.open, flushWaitMs: 0 }).load();
  for (const s of seeds) { await readOne(rec, mic, s); await rec.send(); }
  return rec;
}
test('rebase: pipeline before all verses are sent -> counts, gate waits; renderer stages always "waiting for renderer"', async () => {
  const store = new MemoryStore(); await sendAll('Genesis 1:1', store, [41]);
  const p = new PassagePipeline({ passage: 'Genesis 1:1-2', store }); await p.run();
  eq(p.stage.captured.state, 'busy'); ok(/1 of 2/.test(p.stage.captured.text)); eq(p.stage.gate.state, 'todo');
  for (const s of ['rendered', 'mp4']) { eq(p.stage[s].state, 'wait'); eq(p.stage[s].text, RENDERER_MISSING); }
  deepEq(STAGES, ['captured', 'saved', 'gate', 'stitched', 'rendered', 'mp4']);
  ok(/1 of 2/.test(p.stage.saved.text));
});
test('rebase: pipeline after the last Send -> gate, stitch, stitched WAV + timings downloaded; never fakes the MP4', async () => {
  const store = new MemoryStore(); await sendAll('Genesis 1:1-2', store, [51, 52]);
  const saved = []; const p = new PassagePipeline({ passage: 'Genesis 1:1-2', store, save: (n, b, t) => { saved.push([n, t]); return { how: 'download' }; } });
  await p.run({ acceptWarnings: true });
  eq(p.stage.captured.state, 'done'); eq(p.stage.saved.state, 'done', p.stage.saved.text); ok(['done', 'warn'].includes(p.stage.gate.state), p.stage.gate.text);
  eq(p.stage.stitched.state, 'done', p.stage.stitched.text); ok(/0\.4 s gap/.test(p.stage.stitched.text)); ok(/saved to this device/.test(p.stage.stitched.text));
  deepEq(saved, [['Genesis 1-1 to 1-2.wav', 'audio/wav'], ['Genesis 1-1 to 1-2.timings.json', 'application/json']]);
  await p.run(); eq(saved.length, 2, 'downloads once per stitch');
  eq(p.stage.rendered.state, 'wait'); eq(p.stage.mp4.state, 'wait'); ok(/waiting for renderer/.test(p.stage.mp4.text)); ok(/Only the audio/.test(p.stage.mp4.text));
});
test('rebase: pipeline gate FAIL names the verse; WARN waits for an OK', async () => {
  const store = new MemoryStore(); const mic = fakeMic();
  const rec = await new VerseRecorder({ passage: 'Genesis 2:1-2', store, openMic: mic.open, flushWaitMs: 0 }).load();
  await readOne(rec, mic, 61); await rec.send(); await readOne(rec, mic, 62); await rec.send();
  // break verse 2's file so the gate fails it
  const t = await store.acceptedTake('GEN.2.2'); await store.putTake({ ...t, wav: new Uint8Array([1, 2, 3]).buffer });
  const p = new PassagePipeline({ passage: 'Genesis 2:1-2', store }); await p.run();
  eq(p.stage.gate.state, 'bad'); ok(/Genesis 2:2/.test(p.stage.gate.text), p.stage.gate.text); eq(p.result, null);
});

test('rebase: tracker chunks param round-trips and survives in this device\'s storage', () => {
  const list = parseChunkParam('12~Genesis 3:14-19|13~Genesis 3:20-24|Genesis 4:1-7');
  deepEq(list, [{ n: '12', ref: 'Genesis 3:14-19' }, { n: '13', ref: 'Genesis 3:20-24' }, { n: '', ref: 'Genesis 4:1-7' }]);
  eq(chunkParam(list), '12~Genesis 3:14-19|13~Genesis 3:20-24|Genesis 4:1-7');
  const ls = fakeLs();
  const got = takeHandoff(new URLSearchParams('passage=Genesis+3:14-19&next=Genesis+3:14-19&chunks=12~Genesis+3:14-19|13~Genesis+3:20-24'), ls, 5);
  eq(got.next, 'Genesis 3:14-19'); eq(got.chunks.length, 2); eq(got.receivedAt, 5); ok(ls.getItem(CHUNKS_KEY));
  const again = takeHandoff(new URLSearchParams('passage=Genesis+3:20-24'), ls); deepEq(again.chunks, got.chunks, 'list kept when a chunk link has no list');
  eq(takeHandoff(new URLSearchParams(''), fakeLs()), null);
});
test('rebase: "Record this one next" = tracker NEXT unless already sent here; cross-book chunks explained', async () => {
  const store = new MemoryStore(); await sendAll('Genesis 3:14', store, [71]);
  const h = { chunks: [{ n: 1, ref: 'Genesis 3:14' }, { n: 2, ref: 'Genesis 3:15-16' }, { n: 3, ref: 'Genesis 50:26 to Exodus 1:2' }] };
  const st = await chunkStatuses(h, store);
  ok(st[0].done); eq(st[1].sent, 0); eq(st[1].total, 2); ok(st[2].error && /two books/.test(st[2].error), st[2].error);
  eq(nextChunkIndex(st, 'Genesis 3:14'), 1, 'NEXT already sent here -> the one after');
  eq(nextChunkIndex(st, 'Gen 3 15-16'), 1, 'forgiving match');
  eq(nextChunkIndex(st.map(s => ({ ...s, done: true })), null), -1);
});

test('rebase: Reader info carries word timings, and no text when text is not loaded', async () => {
  const timings = { sample_rate: 48000, total_samples: 48000 * 5, gap_s: 0.4, verses: [{ id: 'GEN.1.1', speech_start_s: 0.1, speech_end_s: 2 }, { id: 'GEN.1.2', speech_start_s: 2.5, speech_end_s: 4.8 }] };
  const fakeText = { loaded: true, text: id => id === 'GEN.1.1' ? 'aa bb cc' : 'dd ee' };
  const info = readerInfo({ code: 'GEN', start: { chapter: 1, verse: 1 }, end: { chapter: 1, verse: 2 } }, timings, 'Genesis 1-1-2.wav', fakeText);
  eq(info.words.length, 5); ok(info.words.every((w, i, a) => i === 0 || w.start >= a[i - 1].start), 'word times in order');
  const none = readerInfo({ code: 'GEN', start: { chapter: 1, verse: 1 }, end: { chapter: 1, verse: 2 } }, timings, 'x.wav', null);
  eq(none.text, ''); eq(none.words.length, 0);
});
test('rebase: Send to Rolling Reader posts tt-audio after rr-ready, finishes on rr-got; blocked tab is reported', async () => {
  let fn = null; const posted = [];
  const win = { postMessage: (m, o) => posted.push([m, o]) };
  const says = [];
  const pr = sendToReader({ wav: new ArrayBuffer(8), info: { name: 'a.wav', passage: 'P', text: '', words: [] }, say: (t, b) => says.push([t, b]), open: () => win, listen: f => { fn = f; return () => { fn = null; }; } });
  fn({ origin: 'https://evil.example', source: win, data: { type: 'rr-ready' } }); eq(posted.length, 0, 'other origins ignored');
  fn({ origin: READER_ORIGIN, source: win, data: { type: 'rr-ready' } }); eq(posted.length, 1); eq(posted[0][0].type, 'tt-audio'); eq(posted[0][1], READER_ORIGIN);
  fn({ origin: READER_ORIGIN, source: win, data: { type: 'rr-got', ok: true, duration: 3 } });
  const r = await pr; ok(r.ok); eq(says[says.length - 1][1], false);
  const b = await sendToReader({ wav: new ArrayBuffer(8), info: { name: 'a.wav' }, open: () => null, say: (t, bad) => says.push([t, bad]) });
  eq(b.reason, 'blocked'); ok(/Download WAV/.test(says[says.length - 1][0]));
});
