import { test, eq, ok, near, throws, deepEq } from './lib.js';
import { Synth, SR } from './synth.js';
import { S, U, transition, canDo, uploadTransition, firstUnsaved, stitchBlockers, backoffMs } from '../js/recorder/state.js';
import { Recorder } from '../js/recorder/recorder.js';
import { MemoryStore } from '../js/store/memory.js';
import { MicDeniedError } from '../js/recorder/capture.js';
import { DriveClient, AuthExpiredError, MULTIPART_LIMIT } from '../js/drive/drive-api.js';
import { UploadQueue } from '../js/drive/queue.js';
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
test('state: upload sub-machine and backoff', () => {
  let u = U.NONE; for (const e of ['queue', 'start', 'fail', 'retry', 'start', 'authexpired', 'signedin', 'start', 'done']) u = uploadTransition(u, e);
  eq(u, U.UPLOADED); eq(uploadTransition(U.UPLOADED, 'queue'), U.QUEUED);
  eq(backoffMs(1), 2000); eq(backoffMs(2), 4000); eq(backoffMs(20), 300000);
  eq(firstUnsaved(['a', 'b'], { a: S.SAVED }), 1); deepEq(stitchBlockers(['a', 'b', 'c'], { a: S.SAVED, b: S.SKIPPED }), ['b', 'c']);
});

// ---------- Recorder with a fake microphone ----------
function fakeMic({ deny = false } = {}) {
  const m = { opened: 0, closed: 0 };
  m.open = async ({ onChunk, onLost }) => { if (deny) throw new MicDeniedError(); m.opened++; m.onChunk = onChunk; m.onLost = onLost; return { sampleRate: SR, close: async () => { m.closed++; }, flush() {} }; };
  m.feed = x => { for (let i = 0; i < x.length; i += 4096) m.onChunk(x.slice(i, i + 4096)); };
  return m;
}
const fakeQueue = () => ({ items: [], enqueue(t) { this.items.push(t); return Promise.resolve(); } });
async function readVerse(rec, mic, seed, { stop = true } = {}) {
  await rec.record(); eq(rec.state, S.ARMING);
  mic.feed(new Synth({ seed: seed + 50 }).silence(0.55).render()); eq(rec.state, S.ARMED);
  const s = new Synth({ seed }).silence(0.4).phrase(7).silence(0.9); const x = s.render();
  mic.feed(x); eq(rec.state, S.RECORDING, 'onset should auto-start recording');
  if (stop) await rec.stop();
}
test('recorder: arm -> auto onset -> stop -> review -> accept -> saved -> next verse; upload queued', async () => {
  const store = new MemoryStore(), mic = fakeMic(), q = fakeQueue();
  const rec = await new Recorder({ passage: 'Genesis 3:14-15', store, queue: q, openMic: mic.open }).load();
  eq(rec.verseId, 'GEN.3.14'); await readVerse(rec, mic, 1);
  eq(rec.state, S.REVIEW, rec.message); const t = rec.review; eq(t.takeId, 'GEN.3.14#1');
  const d = decodeWav(t.wav); eq(d.sampleRate, 48000); eq(d.channels, 1); eq(d.bitsPerSample, 16);
  near(t.meta.onsetInFileS, 0.15, 0.03, 'pre-roll'); near(t.meta.lufs, -16, 0.2);
  await rec.accept(); eq(rec.statuses['GEN.3.14'], S.SAVED); eq(rec.state, S.IDLE); eq(rec.verseId, 'GEN.3.15');
  eq(q.items.length, 1); eq(q.items[0].status, 'accepted'); eq(mic.opened, 1, 'mic stays open between verses');
});
test('recorder: re-record keeps the old take (superseded), never deletes', async () => {
  const store = new MemoryStore(), mic = fakeMic();
  const rec = await new Recorder({ passage: 'Genesis 3:14', store, openMic: mic.open }).load();
  await readVerse(rec, mic, 1); await rec.accept();
  rec.select(0); await readVerse(rec, mic, 2); eq(rec.state, S.REVIEW);
  await rec.record(); mic.feed(new Synth({ seed: 9 }).silence(0.55).render()); mic.feed(new Synth({ seed: 3 }).silence(0.4).phrase(6).silence(0.9).render()); await rec.stop();
  await rec.accept();
  const takes = await store.takesFor('GEN.3.14');
  deepEq(takes.map(t => [t.takeNo, t.status]), [[1, 'superseded'], [2, 'superseded'], [3, 'accepted']]);
  ok(takes.every(t => t.wav && t.wav.byteLength > 44), 'audio of every take is kept');
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

// ---------- Drive client + queue against a MOCK fetch (not the real Drive API) ----------
function mockDrive() {
  const files = new Map(); let n = 0; const log = [];
  const res = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body, text: async () => JSON.stringify(body), headers: { get: k => headers[k] ?? null } });
  const fetch = async (url, init = {}) => {
    const method = init.method || 'GET'; log.push(`${method} ${url.replace(/\?.*/, '')}`);
    if (mock.fail401) return res(401, {});
    if (mock.failNext) { mock.failNext--; return res(503, { error: 'busy' }); }
    const u = new URL(url);
    if (method === 'GET' && u.pathname.endsWith('/files')) {
      const qy = u.searchParams.get('q'); const name = /name = '((?:\\'|[^'])*)'/.exec(qy)[1].replace(/\\'/g, "'"); const parent = /'([^']+)' in parents/.exec(qy)[1];
      const folder = qy.includes("mimeType = 'application/vnd.google-apps.folder'");
      return res(200, { files: [...files.values()].filter(f => f.name === name && f.parents.includes(parent) && (f.mimeType === 'application/vnd.google-apps.folder') === folder) });
    }
    if (method === 'POST' && u.pathname === '/drive/v3/files') { const m = JSON.parse(init.body); const f = { id: 'f' + ++n, ...m, createdTime: '2026-11-03T09:00:00Z' }; files.set(f.id, f); return res(200, f); }
    if (method === 'POST' && u.searchParams.get('uploadType') === 'multipart') {
      const b = new TextDecoder('latin1').decode(init.body); const meta = JSON.parse(b.split('\r\n\r\n')[1].split('\r\n')[0]);
      const start = init.body.indexOf(0x52) ; // not used
      const head = b.indexOf('\r\n\r\n', b.indexOf('Content-Type: audio') ) + 4; const bytes = init.body.subarray(head, init.body.length - (b.length - b.lastIndexOf('\r\n--')));
      const f = { id: 'f' + ++n, ...meta, md5Checksum: mock.badMd5 ? 'x' : md5Hex(bytes), createdTime: '2026-11-03T09:40:12Z' }; files.set(f.id, f); return res(200, f);
    }
    if (method === 'POST' && u.searchParams.get('uploadType') === 'resumable') { mock.pending = JSON.parse(init.body); mock.got = 0; return res(200, {}, { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=abc' }); }
    if (method === 'PUT') {
      const cr = init.headers['Content-Range'];
      if (cr.startsWith('bytes */')) return mock.got ? res(308, {}, { Range: `bytes=0-${mock.got - 1}` }) : res(308, {});
      const from = +cr.split(' ')[1].split('-')[0];
      if (mock.dropResumable) { mock.dropResumable = false; mock.got = from + 1000000; throw new TypeError('network dropped'); }
      mock.resumedFrom = from; const f = { id: 'f' + ++n, ...mock.pending, md5Checksum: mock.fullMd5, createdTime: '2026-11-03T09:40:12Z' }; files.set(f.id, f); return res(200, f);
    }
    if (method === 'PATCH') { const id = u.pathname.split('/').pop(); const f = files.get(id); const m = JSON.parse(init.body); f.name = m.name; f.parents = f.parents.filter(p => p !== u.searchParams.get('removeParents')).concat(u.searchParams.get('addParents')); return res(200, f); }
    if (method === 'DELETE') throw new Error('DELETE must never be called');
    return res(404, {});
  };
  const mock = { files, log, fetch, failNext: 0 };
  return mock;
}
const bytes = n => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 255; return b; };
const pathOf = (files, f) => { const p = []; let cur = f; while (cur) { p.unshift(cur.name); cur = files.get(cur.parents?.[0]); } return p.join('/'); };

test('drive (mock): folders created once, verse uploaded to the canonical path with appProperties', async () => {
  const m = mockDrive(), d = new DriveClient({ getToken: () => 'tok', fetch: m.fetch });
  const f = await d.uploadVerse('GEN.3.14', bytes(5000), { takeId: 'GEN.3.14#1', takeNo: 1 });
  eq(pathOf(m.files, m.files.get(f.id)), 'KJV Recordings/01 Genesis/Genesis 3/Genesis 3-14.wav'); eq(f.appProperties.takeNo, '1');
  const before = m.log.filter(l => l.startsWith('POST https://www.googleapis.com/drive')).length; eq(before, 3);
  await d.uploadVerse('GEN.3.15', bytes(5000), { takeId: 'GEN.3.15#1', takeNo: 1 });
  eq(m.log.filter(l => l.startsWith('POST https://www.googleapis.com/drive')).length, 3, 'no new folders for the same chapter');
  const p = await d.uploadVerse('PSA.23.1', bytes(100), { takeId: 'PSA.23.1#1', takeNo: 1 });
  eq(pathOf(m.files, m.files.get(p.id)), 'KJV Recordings/19 Psalms/Psalm 23/Psalm 23-1.wav');
});
test('drive (mock): a new take moves the old file to _replaced with a take name; nothing deleted; same take is idempotent', async () => {
  const m = mockDrive(), d = new DriveClient({ getToken: () => 'tok', fetch: m.fetch });
  const a = await d.uploadVerse('GEN.3.14', bytes(5000), { takeId: 'GEN.3.14#1', takeNo: 1 });
  const again = await d.uploadVerse('GEN.3.14', bytes(5000), { takeId: 'GEN.3.14#1', takeNo: 1 }); eq(again.id, a.id);
  const b = await d.uploadVerse('GEN.3.14', bytes(6000), { takeId: 'GEN.3.14#2', takeNo: 2 });
  eq(pathOf(m.files, m.files.get(b.id)), 'KJV Recordings/01 Genesis/Genesis 3/Genesis 3-14.wav');
  const old = m.files.get(a.id); ok(/^KJV Recordings\/01 Genesis\/Genesis 3\/_replaced\/Genesis 3-14 take 1 \d{8}-\d{6}\.wav$/.test(pathOf(m.files, old)), pathOf(m.files, old));
  ok(!m.log.some(l => l.startsWith('DELETE')));
});
test('drive (mock): >=5 MB uses resumable upload and resumes after a dropped connection', async () => {
  const m = mockDrive(), d = new DriveClient({ getToken: () => 'tok', fetch: m.fetch }); const big = bytes(MULTIPART_LIMIT + 10);
  m.fullMd5 = md5Hex(big); m.dropResumable = true;
  const f = await d.uploadVerse('GEN.1.1', big, { takeId: 'GEN.1.1#1', takeNo: 1 }); ok(f.id); eq(m.resumedFrom, 1000000);
});
test('drive (mock): 401 -> AuthExpiredError; md5 mismatch is an error', async () => {
  const m = mockDrive(); m.fail401 = true;
  await throws(() => new DriveClient({ getToken: () => 'tok', fetch: m.fetch }).uploadVerse('GEN.1.1', bytes(10), { takeId: 'x', takeNo: 1 }), /expired/);
  await throws(() => new DriveClient({ getToken: () => null, fetch: m.fetch }).ensurePath(['KJV Recordings']), /expired/);
  const m2 = mockDrive(); m2.badMd5 = true;
  await throws(() => new DriveClient({ getToken: () => 'tok', fetch: m2.fetch }).uploadVerse('GEN.1.1', bytes(10), { takeId: 'x', takeNo: 1 }), /md5/);
});
test('drive (mock): stitched output goes to Stitched/, old one moved to Stitched/_replaced', async () => {
  const m = mockDrive(), d = new DriveClient({ getToken: () => 'tok', fetch: m.fetch });
  const a = await d.uploadStitched('Genesis 3-14 to 3-19.wav', bytes(100), 'audio/wav');
  await d.uploadStitched('Genesis 3-14 to 3-19.wav', bytes(120), 'audio/wav');
  eq(pathOf(m.files, m.files.get(a.id)), 'KJV Recordings/Stitched/_replaced/Genesis 3-14 to 3-19 20261103-094012.wav');
});
test('queue (mock): signed out -> AUTH_EXPIRED, sign in -> UPLOADED; failure backs off and retries', async () => {
  const store = new MemoryStore(), m = mockDrive(); let token = null, t = 1000, timers = [];
  const q = new UploadQueue({ store, drive: new DriveClient({ getToken: () => token, fetch: m.fetch }), now: () => t, setTimer: (f, ms) => { timers.push({ f, ms }); return 1; } });
  const take = { takeId: 'GEN.3.14#1', verseId: 'GEN.3.14', takeNo: 1, status: 'accepted', wav: bytes(2000) };
  await store.putTake(take); await q.enqueue(take);
  eq((await store.getUpload(take.takeId)).state, U.AUTH_EXPIRED);
  token = 'tok'; m.failNext = 1; await q.resumeAfterSignIn();
  let u = await store.getUpload(take.takeId); eq(u.state, U.UPLOAD_FAILED); eq(u.attempts, 1); eq(u.nextAt, 3000); eq(timers[0].ms, 2000);
  t = 3000; timers.shift().f(); await new Promise(r => setTimeout(r, 0)); await q.kick();
  u = await store.getUpload(take.takeId); eq(u.state, U.UPLOADED); ok(u.driveFileId);
  ok((await store.getTake(take.takeId)).wav, 'local copy kept after upload');
});
test('queue: recover() re-queues an upload interrupted by a reload', async () => {
  const store = new MemoryStore(), m = mockDrive();
  const take = { takeId: 'GEN.3.14#1', verseId: 'GEN.3.14', takeNo: 1, status: 'accepted', wav: bytes(200) };
  await store.putTake(take); await store.putUpload({ takeId: take.takeId, verseId: 'GEN.3.14', takeNo: 1, state: U.UPLOADING, attempts: 0, nextAt: 0 });
  await new UploadQueue({ store, drive: new DriveClient({ getToken: () => 'tok', fetch: m.fetch }) }).recover();
  eq((await store.getUpload(take.takeId)).state, U.UPLOADED);
});
test('tracker keys are only referenced, never written by this pass', () => {
  deepEq([...TRACKER_KEYS].sort(), ['bible-coverage-tracker.breaks.v1', 'bible-coverage-tracker.pace.v1', 'bible-coverage-tracker.plan.v2', 'bible-coverage-tracker.v2']);
});
