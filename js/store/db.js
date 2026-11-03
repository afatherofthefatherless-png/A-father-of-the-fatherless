// IndexedDB store: sessions (resume), takes (every take is kept; never deleted), uploads (queue), kv (settings, text file).
// All audio stays on the device until Drive confirms it; nothing is removed after upload either.
const DB_NAME = 'kjv-site', VERSION = 1;
let dbp = null;

export class StorageFullError extends Error { constructor(e) { super('Device storage is full'); this.name = 'StorageFullError'; this.cause = e; } }

export function openDb(name = DB_NAME) {
  if (dbp && name === DB_NAME) return dbp;
  const p = new Promise((res, rej) => {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('sessions', { keyPath: 'passage' });
      const t = db.createObjectStore('takes', { keyPath: 'takeId' }); t.createIndex('verseId', 'verseId');
      const u = db.createObjectStore('uploads', { keyPath: 'takeId' }); u.createIndex('state', 'state');
      db.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  if (name === DB_NAME) dbp = p;
  return p;
}
const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
function isQuota(e) { return e && (e.name === 'QuotaExceededError' || e.code === 22); }

export class Store {
  constructor(dbName = DB_NAME) { this.dbName = dbName; }
  async tx(store, mode, fn) {
    const db = await openDb(this.dbName);
    try {
      const t = db.transaction(store, mode); const os = t.objectStore(store);
      const done = new Promise((res, rej) => { t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
      const out = await fn(os);
      await done;
      return out;
    } catch (e) { if (isQuota(e)) throw new StorageFullError(e); throw e; }
  }
  get(store, key) { return this.tx(store, 'readonly', os => wrap(os.get(key))); }
  put(store, val) { return this.tx(store, 'readwrite', os => wrap(os.put(val))); }
  all(store) { return this.tx(store, 'readonly', os => wrap(os.getAll())); }
  byIndex(store, index, value) { return this.tx(store, 'readonly', os => wrap(os.index(index).getAll(value))); }

  // sessions
  getSession(passage) { return this.get('sessions', passage); }
  saveSession(s) { return this.put('sessions', { ...s, updatedAt: Date.now() }); }
  // takes (status: 'review' | 'accepted' | 'superseded' | 'failed'); never deleted
  takesFor(verseId) { return this.byIndex('takes', 'verseId', verseId).then(a => a.sort((x, y) => x.takeNo - y.takeNo)); }
  async nextTakeNo(verseId) { const t = await this.takesFor(verseId); return t.length ? t[t.length - 1].takeNo + 1 : 1; }
  putTake(t) { return this.put('takes', t); }
  getTake(id) { return this.get('takes', id); }
  async acceptedTake(verseId) { return (await this.takesFor(verseId)).filter(t => t.status === 'accepted').pop() || null; }
  /** Mark takeId accepted; any earlier accepted take of the same verse becomes 'superseded' (kept). */
  async acceptTake(takeId) {
    const t = await this.getTake(takeId); if (!t) throw new Error('No such take');
    for (const o of await this.takesFor(t.verseId)) if (o.status === 'accepted' && o.takeId !== takeId) await this.putTake({ ...o, status: 'superseded' });
    await this.putTake({ ...t, status: 'accepted', acceptedAt: Date.now() });
  }
  // uploads
  putUpload(u) { return this.put('uploads', { ...u, updatedAt: Date.now() }); }
  getUpload(id) { return this.get('uploads', id); }
  allUploads() { return this.all('uploads'); }
  // kv
  async getKv(k) { const r = await this.get('kv', k); return r ? r.v : undefined; }
  setKv(k, v) { return this.put('kv', { k, v }); }
}

export async function requestPersistentStorage() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
