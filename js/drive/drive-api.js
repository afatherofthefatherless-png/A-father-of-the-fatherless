// Google Drive v3 REST client for drive.file scope (only sees files/folders this app created).
// Implements folder find/create, multipart (<5 MB) and resumable (>=5 MB) upload, md5 verification, and
// one file per verse: a retake overwrites the existing verse file's content in place (same file id and name).
// Stitched outputs still move an older file into 'Stitched/_replaced'. Nothing is ever trashed or DELETEd.
// fetch is injectable so the request logic can be exercised with a mock; UNTESTED against the real Drive API.
import { DRIVE_ROOT_FOLDER, DRIVE_REPLACED_FOLDER } from '../config.js';
import { folderPathOf, fileNameOf } from '../kjv/ref.js';
import { md5Hex } from '../stitch/hash.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'application/vnd.google-apps.folder';
const FIELDS = 'id,name,md5Checksum,size,parents,createdTime,appProperties';
export const MULTIPART_LIMIT = 5 * 1024 * 1024;

export class AuthExpiredError extends Error { constructor() { super('Google sign-in expired'); this.name = 'AuthExpiredError'; } }
export class DriveError extends Error { constructor(status, msg) { super(`Drive ${status}: ${msg}`); this.name = 'DriveError'; this.status = status; } }

const q = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const toBytes = b => b instanceof Uint8Array ? b : new Uint8Array(b);

export class DriveClient {
  /** getToken(): string|null; fetch: fetch-compatible; folderCache: optional Map(path -> id) */
  constructor({ getToken, fetch = (...a) => globalThis.fetch(...a), folderCache = new Map() }) {
    this.getToken = getToken; this.fetch = fetch; this.cache = folderCache;
  }
  async req(url, init = {}, { raw = false } = {}) {
    const t = this.getToken(); if (!t) throw new AuthExpiredError();
    const res = await this.fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${t}` } });
    if (res.status === 401) throw new AuthExpiredError();
    if (raw) return res;
    if (!res.ok) throw new DriveError(res.status, await res.text().catch(() => ''));
    return res.status === 204 ? null : res.json();
  }
  async findChild(name, parentId, { folder = false } = {}) {
    const query = `name = '${q(name)}' and '${q(parentId)}' in parents and trashed = false` + (folder ? ` and mimeType = '${FOLDER}'` : ` and mimeType != '${FOLDER}'`);
    const r = await this.req(`${API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(`files(${FIELDS})`)}&spaces=drive&orderBy=createdTime`);
    return r.files && r.files.length ? r.files[0] : null;
  }
  async createFolder(name, parentId) {
    return this.req(`${API}/files?fields=${encodeURIComponent(FIELDS)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
    });
  }
  /** ['KJV Recordings','01 Genesis','Genesis 3'] -> folder id, creating any missing level. */
  async ensurePath(names) {
    let parent = 'root', key = '';
    for (const name of names) {
      key += '/' + name;
      if (this.cache.has(key)) { parent = this.cache.get(key); continue; }
      const found = await this.findChild(name, parent, { folder: true });
      const id = found ? found.id : (await this.createFolder(name, parent)).id;
      this.cache.set(key, id); parent = id;
    }
    return parent;
  }
  multipartBody(meta, bytes, mime, boundary = 'kjv' + Math.random().toString(36).slice(2)) {
    const enc = new TextEncoder();
    const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`);
    const tail = enc.encode(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
    return { body, contentType: `multipart/related; boundary=${boundary}` };
  }
  /** fileId given -> PATCH (replace that file's content and metadata in place); otherwise POST (create). */
  async uploadMultipart(meta, bytes, mime, fileId = null) {
    const { body, contentType } = this.multipartBody(meta, bytes, mime);
    const path = fileId ? `/files/${encodeURIComponent(fileId)}` : '/files';
    return this.req(`${UPLOAD}${path}?uploadType=multipart&fields=${encodeURIComponent(FIELDS)}`, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': contentType }, body });
  }
  async uploadResumable(meta, bytes, mime, { chunkRetries = 3, fileId = null } = {}) {
    const path = fileId ? `/files/${encodeURIComponent(fileId)}` : '/files';
    const init = await this.req(`${UPLOAD}${path}?uploadType=resumable&fields=${encodeURIComponent(FIELDS)}`, {
      method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(bytes.length) },
      body: JSON.stringify(meta),
    }, { raw: true });
    if (!init.ok) throw new DriveError(init.status, await init.text().catch(() => ''));
    const loc = init.headers.get('Location'); if (!loc) throw new DriveError(0, 'no resumable session URL');
    let from = 0;
    for (let attempt = 0; attempt <= chunkRetries; attempt++) {
      try {
        const part = bytes.subarray(from);
        const res = await this.req(loc, { method: 'PUT', headers: { 'Content-Range': `bytes ${from}-${bytes.length - 1}/${bytes.length}` }, body: part }, { raw: true });
        if (res.status === 200 || res.status === 201) return res.json();
        if (res.status !== 308 && res.status < 500) throw new DriveError(res.status, await res.text().catch(() => ''));
      } catch (e) { if (e instanceof AuthExpiredError || (e instanceof DriveError && e.status && e.status < 500)) throw e; }
      // ask Drive how much it has, then resume from there
      const st = await this.req(loc, { method: 'PUT', headers: { 'Content-Range': `bytes */${bytes.length}` } }, { raw: true });
      if (st.status === 200 || st.status === 201) return st.json();
      const range = st.headers.get('Range'); from = range ? Number(range.split('-')[1]) + 1 : 0;
    }
    throw new DriveError(0, 'resumable upload did not complete');
  }
  async upload(meta, data, mime = 'audio/wav') {
    const bytes = toBytes(data);
    return bytes.length < MULTIPART_LIMIT ? this.uploadMultipart(meta, bytes, mime) : this.uploadResumable(meta, bytes, mime);
  }
  /** Replace an existing file's content (and the given metadata) in place: same id, same name, same folder.
   *  Drive only swaps the content once the new upload has fully arrived, so a failed upload leaves the old file as it was.
   *  'parents' is not allowed in an update body, so it is stripped. */
  async updateContent(fileId, meta, data, mime = 'audio/wav') {
    const bytes = toBytes(data); const { parents, ...m } = meta;
    return bytes.length < MULTIPART_LIMIT ? this.uploadMultipart(m, bytes, mime, fileId) : this.uploadResumable(m, bytes, mime, { fileId });
  }
  async moveAndRename(file, newName, fromParent, toParent) {
    return this.req(`${API}/files/${encodeURIComponent(file.id)}?addParents=${encodeURIComponent(toParent)}&removeParents=${encodeURIComponent(fromParent)}&fields=${encodeURIComponent(FIELDS)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }),
    });
  }

  /**
   * Upload an accepted take as 'KJV Recordings/NN Book/Book C/Book C-V.wav'.
   * One file per verse: if the verse file already exists, a new take overwrites its content in place (same file id
   * and name, no version suffix, no '_replaced' copy). The new content is uploaded in one request that only takes
   * effect once complete, so if it fails the old take stays untouched and the queue retries. Verifies md5Checksum.
   * Returns the Drive file.
   */
  async uploadVerse(verseId, wavBytes, { takeId, takeNo }) {
    const bytes = toBytes(wavBytes);
    const folderId = await this.ensurePath(folderPathOf(verseId, DRIVE_ROOT_FOLDER));
    const name = fileNameOf(verseId);
    const existing = await this.findChild(name, folderId);
    const md5 = md5Hex(bytes);
    if (existing && existing.appProperties?.takeId === String(takeId) && existing.md5Checksum === md5) return existing; // already done (resume)
    const meta = { name, parents: [folderId], mimeType: 'audio/wav', appProperties: { verseId, takeId: String(takeId), takeNo: String(takeNo) } };
    const file = existing ? await this.updateContent(existing.id, meta, bytes) : await this.upload(meta, bytes);
    if (file.md5Checksum && file.md5Checksum !== md5) throw new DriveError(0, `md5 mismatch for ${name}`);
    return file;
  }

  /** Upload a stitched passage (WAV or timings JSON) into 'KJV Recordings/Stitched/'. An older file with the same
   *  name is moved to 'Stitched/_replaced/' with a timestamp suffix, never deleted. */
  async uploadStitched(name, data, mime) {
    const bytes = toBytes(data);
    const folderId = await this.ensurePath([DRIVE_ROOT_FOLDER, 'Stitched']);
    const existing = await this.findChild(name, folderId);
    if (existing) {
      const repl = await this.ensurePath([DRIVE_ROOT_FOLDER, 'Stitched', DRIVE_REPLACED_FOLDER]);
      const ts = (existing.createdTime || new Date().toISOString()).replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      const dot = name.lastIndexOf('.');
      await this.moveAndRename(existing, `${name.slice(0, dot)} ${ts}${name.slice(dot)}`, folderId, repl);
    }
    const file = await this.upload({ name, parents: [folderId], mimeType: mime }, bytes, mime);
    if (file.md5Checksum && file.md5Checksum !== md5Hex(bytes)) throw new DriveError(0, `md5 mismatch for ${name}`);
    return file;
  }

  /** Write (or overwrite in place) a small JSON file in 'KJV Recordings/<folder>/', e.g. the render-job file for the headless renderer. */
  async putJson(folder, name, obj) {
    const bytes = new TextEncoder().encode(JSON.stringify(obj, null, 2));
    const folderId = await this.ensurePath([DRIVE_ROOT_FOLDER, folder]);
    const existing = await this.findChild(name, folderId);
    const meta = { name, mimeType: 'application/json' };
    return existing ? this.updateContent(existing.id, meta, bytes, 'application/json') : this.upload({ ...meta, parents: [folderId] }, bytes, 'application/json');
  }
}
