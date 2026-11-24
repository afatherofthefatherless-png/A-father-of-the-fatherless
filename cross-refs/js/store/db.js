// IndexedDB store: sessions (resume), takes (one accepted take per verse), kv (settings, data cache, saved-file notes).
// Release 12: everything stays on this device. Accepting a retake replaces the verse's older takes (one file per verse).
// Version 2 drops the old 'uploads' store (the Drive upload queue, removed in release 12).
const DB_NAME = 'kjv-site', VERSION = 2;
let dbp = null;

export class StorageFullError extends Error { constructor(e) { super('Device storage is full'); this.name = 'StorageFullError'; this.cause = e; } }

export function openDb(name = DB_NAME) {
  if (dbp && name === DB_NAME) return dbp;
  const p = new Promise((res, rej) => {
    const r = indexedDB.open(name, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result, has = n => db.objectStoreNames.contains(n);
      if (!has('sessions')) db.createObjectStore('sessions', { keyPath: 'passage' });
      if (!has('takes')) { const t = db.createObjectStore('takes', { keyPath: 'takeId' }); t.createIndex('verseId', 'verseId'); }
      if (!has('kv')) db.createObjectStore('kv', { keyPath: 'k' });
      if (has('uploads')) db.deleteObjectStore('uploads');
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
  del(store, key) { return this.tx(store, 'readwrite', os => wrap(os.delete(key))); }
  byIndex(store, index, value) { return this.tx(store, 'readonly', os => wrap(os.index(index).getAll(value))); }

  // sessions
  getSession(passage) { return this.get('sessions', passage); }
  saveSession(s) { return this.put('sessions', { ...s, updatedAt: Date.now() }); }
  // takes (status: 'review' | 'accepted' | 'failed'); a newly accepted take replaces every other take of that verse
  takesFor(verseId) { return this.byIndex('takes', 'verseId', verseId).then(a => a.sort((x, y) => x.takeNo - y.takeNo)); }
  async nextTakeNo(verseId) { const t = await this.takesFor(verseId); return t.length ? t[t.length - 1].takeNo + 1 : 1; }
  putTake(t) { return this.put('takes', t); }
  getTake(id) { return this.get('takes', id); }
  async acceptedTake(verseId) { return (await this.takesFor(verseId)).filter(t => t.status === 'accepted').pop() || null; }
  /** Mark takeId accepted and delete the verse's other takes: a retake overwrites the verse on this device. */
  async acceptTake(takeId) {
    const t = await this.getTake(takeId); if (!t) throw new Error('No such take');
    for (const o of await this.takesFor(t.verseId)) if (o.takeId !== takeId) await this.del('takes', o.takeId);
    await this.putTake({ ...t, status: 'accepted', acceptedAt: Date.now() });
  }
  // kv
  async getKv(k) { const r = await this.get('kv', k); return r ? r.v : undefined; }
  setKv(k, v) { return this.put('kv', { k, v }); }
}

export async function requestPersistentStorage() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
