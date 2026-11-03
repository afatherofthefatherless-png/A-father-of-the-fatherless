// In-memory Store with the same interface as db.js Store (used by tests, and as a fallback if IndexedDB is unavailable).
export class MemoryStore {
  constructor() { this.s = { sessions: new Map(), takes: new Map(), uploads: new Map(), kv: new Map() }; }
  async getSession(p) { return clone(this.s.sessions.get(p)); }
  async saveSession(x) { this.s.sessions.set(x.passage, clone({ ...x, updatedAt: Date.now() })); }
  async takesFor(v) { return [...this.s.takes.values()].filter(t => t.verseId === v).sort((a, b) => a.takeNo - b.takeNo).map(clone); }
  async nextTakeNo(v) { const t = await this.takesFor(v); return t.length ? t[t.length - 1].takeNo + 1 : 1; }
  async putTake(t) { this.s.takes.set(t.takeId, clone(t)); }
  async getTake(id) { return clone(this.s.takes.get(id)); }
  async acceptedTake(v) { return (await this.takesFor(v)).filter(t => t.status === 'accepted').pop() || null; }
  async acceptTake(id) {
    const t = this.s.takes.get(id); if (!t) throw new Error('No such take');
    for (const o of this.s.takes.values()) if (o.verseId === t.verseId && o.status === 'accepted' && o.takeId !== id) o.status = 'superseded';
    t.status = 'accepted'; t.acceptedAt = Date.now();
  }
  async putUpload(u) { this.s.uploads.set(u.takeId, clone({ ...u, updatedAt: Date.now() })); }
  async getUpload(id) { return clone(this.s.uploads.get(id)); }
  async allUploads() { return [...this.s.uploads.values()].map(clone); }
  async getKv(k) { return clone(this.s.kv.get(k)); }
  async setKv(k, v) { this.s.kv.set(k, clone(v)); }
}
function clone(x) { if (x === undefined) return undefined; return typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x)); }
