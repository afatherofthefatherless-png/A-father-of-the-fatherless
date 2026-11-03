// Upload queue: accepted takes go QUEUED -> UPLOADING -> UPLOADED, with backoff on failure and a pause on AUTH_EXPIRED.
// The local copy in IndexedDB is kept in every case. UNTESTED against the real Drive API.
import { uploadTransition, backoffMs, U } from '../recorder/state.js';
import { AuthExpiredError } from './drive-api.js';

export class UploadQueue {
  constructor({ store, drive, onChange = () => {}, now = () => Date.now(), setTimer = (f, ms) => setTimeout(f, ms) }) {
    Object.assign(this, { store, drive, onChange, now, setTimer }); this.running = false; this.timer = null;
  }
  async enqueue(take) {
    const prev = await this.store.getUpload(take.takeId);
    const state = uploadTransition(prev ? prev.state : U.NONE, 'queue');
    await this.store.putUpload({ takeId: take.takeId, verseId: take.verseId, takeNo: take.takeNo, state, attempts: 0, nextAt: 0, error: null });
    this.onChange(); return this.kick();
  }
  async move(u, ev, extra = {}) { const n = { ...u, ...extra, state: uploadTransition(u.state, ev) }; await this.store.putUpload(n); this.onChange(n); return n; }
  /** After a reload: an upload that was in flight when the page closed goes back to the queue. */
  async recover() {
    for (const u of await this.store.allUploads()) if (u.state === U.UPLOADING) await this.store.putUpload({ ...u, state: U.QUEUED, nextAt: 0 });
    return this.kick();
  }
  async resumeAfterSignIn() {
    for (const u of await this.store.allUploads()) if (u.state === U.AUTH_EXPIRED) await this.move(u, 'signedin', { nextAt: 0 });
    return this.kick();
  }
  async kick() {
    if (this.running) return; this.running = true;
    try {
      for (;;) {
        const all = await this.store.allUploads();
        for (const u of all) if (u.state === U.UPLOAD_FAILED && u.nextAt <= this.now()) await this.move(u, 'retry');
        const ready = (await this.store.allUploads()).filter(u => u.state === U.QUEUED && u.nextAt <= this.now()).sort((a, b) => a.updatedAt - b.updatedAt);
        if (!ready.length) {
          const waiting = all.filter(u => u.state === U.UPLOAD_FAILED).map(u => u.nextAt);
          if (waiting.length && !this.timer) this.timer = this.setTimer(() => { this.timer = null; this.kick(); }, Math.max(0, Math.min(...waiting) - this.now()));
          return;
        }
        let u = await this.move(ready[0], 'start');
        try {
          const take = await this.store.getTake(u.takeId);
          if (take.status !== 'accepted') { await this.store.putUpload({ ...u, state: U.UPLOADED, note: 'superseded before upload; kept locally' }); continue; }
          const file = await this.drive.uploadVerse(take.verseId, take.wav, take);
          await this.move(u, 'done', { driveFileId: file.id, error: null });
        } catch (e) {
          if (e instanceof AuthExpiredError) {
            await this.move(u, 'authexpired', { error: e.message });
            for (const o of await this.store.allUploads()) if (o.state === U.QUEUED) await this.store.putUpload({ ...o, state: U.AUTH_EXPIRED });
            this.onChange(); return;
          }
          const attempts = (u.attempts || 0) + 1;
          await this.move(u, 'fail', { attempts, error: e.message, nextAt: this.now() + backoffMs(attempts) });
        }
      }
    } finally { this.running = false; }
  }
}
