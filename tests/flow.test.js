import { test, eq, ok, near, throws, deepEq } from './lib.js';
import { Synth, SR } from './synth.js';
import { S, transition, canDo, firstUnsaved, stitchBlockers } from '../js/recorder/state.js';
import { Recorder } from '../js/recorder/recorder.js';
import { MemoryStore } from '../js/store/memory.js';
import { MicDeniedError } from '../js/recorder/capture.js';
import { DeviceSaver, SAVED_KEY } from '../js/save/device-save.js';
import { md5Hex, sha256Hex } from '../js/stitch/hash.js';
import { TextSource } from '../js/kjv/text-source.js';
import { decodeWav } from '../js/recorder/wav.js';
import { TRACKER_KEYS } from '../js/config.js';

// ---------- state machine ----------
test('state: happy path idle -> ... -> saved -> next idle', () => {
  let s = S.IDLE; for (const e of ['record', 'armed', 'onset', 'stop', 'processed', 'accept', 'saved', 'next']) s = transition(s, e);
  eq(s, S.IDLE);
});
test('state: re-record, no speech, mic errors, storage full', () => {
  eq(transition(S.REVIEW, 'rerecord'), S.ARMING); eq(transition(S.PROCESSING, 'nospeech'), S.NO_SPEECH); eq(transition(S.NO_SPEECH, 'record'), S.ARMING);
  eq(transition(S.ARMING, 'micdenied'), S.MIC_DENIED); eq(transition(S.RECORDING, 'miclost'), S.MIC_LOST); eq(transition(S.SAVING, 'storagefull'), S.STORAGE_FULL);
  eq(transition(S.PROCESSING, 'failcheck'), S.FAILED_CHECK); ok(!canDo(S.FAILED_CHECK, 'accept'), 'hard fail cannot be accepted');
});
test('state: illegal events throw; cannot jump verse mid-recording', async () => {
  await throws(() => transition(S.IDLE, 'accept'), /Illegal/); await throws(() => transition(S.RECORDING, 'select'), /Cannot jump/);
  eq(transition(S.SAVED, 'select'), S.IDLE);
});
test('state: resume helpers', () => {
  eq(firstUnsaved(['a', 'b'], { a: S.SAVED }), 1); deepEq(stitchBlockers(['a', 'b', 'c'], { a: S.SAVED, b: S.SKIPPED }), ['b', 'c']);
});

// ---------- Recorder with a fake microphone ----------
function fakeMic({ deny = false } = {}) {
  const m = { opened: 0, closed: 0 };
  m.open = async ({ onChunk, onLost }) => { if (deny) throw new MicDeniedError(); m.opened++; m.onChunk = onChunk; m.onLost = onLost; return { sampleRate: SR, close: async () => { m.closed++; }, flush() {} }; };
  m.feed = x => { for (let i = 0; i < x.length; i += 4096) m.onChunk(x.slice(i, i + 4096)); };
  return m;
}
const fakeSaver = store => { const files = []; const sv = new DeviceSaver({ store, save: (name, bytes, type) => { files.push({ name, bytes, type }); return { how: 'download' }; } }); sv.files = files; return sv; };
async function readVerse(rec, mic, seed, { stop = true } = {}) {
  await rec.record(); eq(rec.state, S.ARMING);
  mic.feed(new Synth({ seed: seed + 50 }).silence(0.55).render()); eq(rec.state, S.ARMED);
  const s = new Synth({ seed }).silence(0.4).phrase(7).silence(0.9); const x = s.render();
  mic.feed(x); eq(rec.state, S.RECORDING, 'onset should auto-start recording');
  if (stop) await rec.stop();
}
test('recorder: arm -> auto onset -> stop -> review -> accept -> saved -> next verse; downloaded to the device', async () => {
  const store = new MemoryStore(), mic = fakeMic(), q = fakeSaver(store);
  const rec = await new Recorder({ passage: 'Genesis 3:14-15', store, saver: q, openMic: mic.open }).load();
  eq(rec.verseId, 'GEN.3.14'); await readVerse(rec, mic, 1);
  eq(rec.state, S.REVIEW, rec.message); const t = rec.review; eq(t.takeId, 'GEN.3.14#1');
  const d = decodeWav(t.wav); eq(d.sampleRate, 48000); eq(d.channels, 1); eq(d.bitsPerSample, 16);
  near(t.meta.onsetInFileS, 0.15, 0.03, 'pre-roll'); near(t.meta.lufs, -16, 0.2);
  await rec.accept(); eq(rec.statuses['GEN.3.14'], S.SAVED); eq(rec.state, S.IDLE); eq(rec.verseId, 'GEN.3.15');
  eq(q.files.length, 1); eq(q.files[0].name, 'Genesis 3-14.wav'); eq(q.files[0].type, 'audio/wav'); eq((await store.getKv(SAVED_KEY + 'GEN.3.14')).takeId, 'GEN.3.14#1'); eq(mic.opened, 1, 'mic stays open between verses');
});
test('recorder: a retake overwrites the verse on this device (one take, one file name per verse)', async () => {
  const store = new MemoryStore(), mic = fakeMic();
  const rec = await new Recorder({ passage: 'Genesis 3:14', store, openMic: mic.open }).load();
  await readVerse(rec, mic, 1); await rec.accept();
  rec.select(0); await readVerse(rec, mic, 2); eq(rec.state, S.REVIEW);
  await rec.record(); mic.feed(new Synth({ seed: 9 }).silence(0.55).render()); mic.feed(new Synth({ seed: 3 }).silence(0.4).phrase(6).silence(0.9).render()); await rec.stop();
  await rec.accept();
  const takes = await store.takesFor('GEN.3.14');
  deepEq(takes.map(t => [t.takeNo, t.status]), [[3, 'accepted']], 'only the accepted retake is kept');
  ok(takes[0].wav.byteLength > 44);
});
test('recorder: tap start works and session resumes at first unsaved verse', async () => {
  const store = new MemoryStore(), mic = fakeMic();
  const rec = await new Recorder({ passage: 'Psalm 23:1-3', store, openMic: mic.open }).load();
  await rec.record(); mic.feed(new Synth({ seed: 5 }).silence(0.55).render()); rec.tapStart(); eq(rec.state, S.RECORDING);
  mic.feed(new Synth({ seed: 6 }).silence(0.2).phrase(6).silence(0.8).render()); await rec.stop(); await rec.accept();
  await rec.close();
  const again = await new Recorder({ passage: 'Psalm 23:1-3', store, openMic: fakeMic().open }).load();
  eq(again.verseId, 'PSA.23.2'); eq(again.statuses['PSA.23.1'], S.SAVED);
});
test('recorder: no speech, mic denied, mic lost, skip', async () => {
  const store = new MemoryStore(), mic = fakeMic();
  const rec = await new Recorder({ passage: 'Genesis 3:14-15', store, openMic: mic.open }).load();
  await rec.record(); mic.feed(new Synth({ seed: 5 }).silence(0.55).render()); rec.tapStart(); mic.feed(new Synth({ seed: 7 }).silence(2).render()); await rec.stop();
  eq(rec.state, S.NO_SPEECH);
  await rec.record(); mic.feed(new Synth({ seed: 5 }).silence(0.55).render()); mic.feed(new Synth({ seed: 8 }).silence(0.3).phrase(4).render()); eq(rec.state, S.RECORDING);
  mic.onLost('ended'); eq(rec.state, S.MIC_LOST); eq((await store.takesFor('GEN.3.14')).length, 0);
  await rec.skip(); eq(rec.statuses['GEN.3.14'], S.SKIPPED); eq(rec.verseId, 'GEN.3.15');
  const denied = await new Recorder({ passage: 'Genesis 3:14', store: new MemoryStore(), openMic: fakeMic({ deny: true }).open }).load();
  await denied.record(); eq(denied.state, S.MIC_DENIED); ok(/denied/.test(denied.message));
});
test('recorder: hard gate fail (raw clipping) -> FAILED_CHECK, take kept as failed', async () => {
  const store = new MemoryStore(), mic = fakeMic();
  const rec = await new Recorder({ passage: 'Genesis 3:14', store, openMic: mic.open }).load();
  await rec.record(); mic.feed(new Synth({ seed: 5 }).silence(0.55).render());
  mic.feed(new Synth({ seed: 8 }).silence(0.3).phrase(3, { db: -2 }).click(40, 14).phrase(3, { db: -2 }).silence(0.9).render()); await rec.stop();
  eq(rec.state, S.FAILED_CHECK); eq((await store.takesFor('GEN.3.14'))[0].status, 'failed');
});
test('recorder: fake text source gives word counts for the duration check', async () => {
  const ts = TextSource.fromJson({ verses: [{ id: 'GEN.3.14', read_aloud_text: 'Sample verse one.' }] });
  eq(ts.wordCount('GEN.3.14'), 3); eq(ts.text('GEN.3.15'), null);
  const store = new MemoryStore(), mic = fakeMic();
  const rec = await new Recorder({ passage: 'Genesis 3:14', store, openMic: mic.open, textSource: ts }).load();
  await readVerse(rec, mic, 1); ok(rec.review.checks.duration.status !== 'SKIP');
  eq(TextSource.fromJson([{ id: 'GEN.1.1', text: 'Sample verse one.' }]).loaded, false, 'only the CrossWire slim shape is accepted');
});

// ---------- hashes ----------
test('hash: md5 / sha256 known vectors', async () => {
  const e = s => new TextEncoder().encode(s);
  eq(md5Hex(e('')), 'd41d8cd98f00b204e9800998ecf8427e'); eq(md5Hex(e('abc')), '900150983cd24fb0d6963f7d28e17f72');
  eq(md5Hex(e('The quick brown fox jumps over the lazy dog')), '9e107d9d372bb6826bd81d3542a419d6');
  eq(await sha256Hex(e('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('tracker keys are only referenced, never written by this pass', () => {
  deepEq([...TRACKER_KEYS].sort(), ['bible-coverage-tracker.breaks.v1', 'bible-coverage-tracker.pace.v1', 'bible-coverage-tracker.plan.v2', 'bible-coverage-tracker.v2']);
});

// ---------- release 12: save to this device ----------
test('device-save: saveFile clicks a download link with the verse file name', async () => {
  const { saveFile, canShareFiles } = await import('../js/save/device-save.js');
  const clicked = [], doc = { body: { append() {}, }, createElement: () => ({ style: {}, click() { clicked.push(this.download); }, remove() {} }) };
  const urlApi = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
  eq(saveFile('Genesis 3-14.wav', new Uint8Array(50), 'audio/wav', { doc, urlApi }).how, 'download');
  deepEq(clicked, ['Genesis 3-14.wav']);
  eq(canShareFiles({}), false);
});
test('device-save: save again re-downloads the kept take; failure is reported, take kept', async () => {
  const store = new MemoryStore(); let fail = false; const names = [];
  const sv = new DeviceSaver({ store, save: name => { if (fail) throw new Error('blocked'); names.push(name); return { how: 'download' }; } });
  const take = { takeId: 'PSA.23.1#2', verseId: 'PSA.23.1', takeNo: 2, status: 'accepted', wav: new Uint8Array(100) };
  await store.putTake(take); await store.acceptTake(take.takeId);
  ok((await sv.saveTake(take)).ok); ok((await sv.saveAgain('PSA.23.1')).ok);
  deepEq(names, ['Psalm 23-1.wav', 'Psalm 23-1.wav'], 'same name every time: no version suffix');
  fail = true; const r = await sv.saveTake(take); eq(r.ok, false); ok(/blocked/.test(r.message));
  eq((await store.takesFor('PSA.23.1')).length, 1);
});
test('release 12: no Google or Drive code left in js/', async () => {
  if (typeof process === 'undefined') return; // node only (reads the files)
  const fs = await import('node:fs'), path = await import('node:path');
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const bad = walk('js').filter(f => /googleapis|accounts\.google|gapi|apis\.google|GOOGLE_|DRIVE_|drive\//.test(fs.readFileSync(f, 'utf8')));
  deepEq(bad, []);
});
