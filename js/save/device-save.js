// Saving files to this device (release 12): no Google, no Drive, no sign-in.
//   saveFile(name, bytes, type)  -> starts a normal browser download of a Blob (an <a download> click).
//                                   iPad Safari (iOS 13+) shows "Download?" and keeps it in Files > Downloads.
//   shareFile(name, bytes, type) -> the system share sheet (iPad: "Save to Files"), when navigator.canShare({files}) says yes.
//   DeviceSaver                  -> what the recorder calls after Send: downloads the verse WAV as "Genesis 3-14.wav"
//                                   (one name per verse; a retake uses the same name) and remembers when it was saved.
// The take itself is already in IndexedDB (js/store/db.js) before any of this runs, so a blocked download loses nothing;
// "Save again" repeats it from the stored copy.
import { fileNameOf } from '../kjv/ref.js';

export const SAVED_KEY = 'savedToDevice.v1:'; // kv key per verse: { takeId, name, savedAt, how }

export function saveFile(name, bytes, type = 'application/octet-stream', { doc = globalThis.document, urlApi = globalThis.URL } = {}) {
  if (!doc || !urlApi || !urlApi.createObjectURL) throw new Error('This browser cannot save files.');
  const url = urlApi.createObjectURL(new Blob([bytes], { type }));
  const a = doc.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener'; a.style.display = 'none';
  doc.body.append(a); a.click(); a.remove();
  setTimeout(() => { try { urlApi.revokeObjectURL(url); } catch {} }, 60000); // Safari needs the URL to live a while
  return { how: 'download', name };
}

export function canShareFiles(nav = globalThis.navigator) {
  try { return !!(nav && nav.canShare && nav.share && nav.canShare({ files: [new File([new Uint8Array(1)], 'x.wav', { type: 'audio/wav' })] })); } catch { return false; }
}
export async function shareFile(name, bytes, type = 'audio/wav', nav = globalThis.navigator) {
  await nav.share({ files: [new File([bytes], name, { type })], title: name });
  return { how: 'share', name };
}

export class DeviceSaver {
  /** save: (name, bytes, type) => result; injectable so tests and the node runner never touch the DOM. */
  constructor({ store, save = saveFile, now = () => Date.now() }) { Object.assign(this, { store, saveFn: save, now }); }
  /** Download one verse's take as "<Book> <C>-<V>.wav" and record it. Never throws: the take is safe in IndexedDB anyway. */
  async saveTake(take) {
    const name = fileNameOf(take.verseId);
    try {
      const r = await this.saveFn(name, take.wav, 'audio/wav');
      const rec = { takeId: take.takeId, name, savedAt: this.now(), how: (r && r.how) || 'download' };
      await this.store.setKv(SAVED_KEY + take.verseId, rec);
      return { ok: true, ...rec };
    } catch (e) { return { ok: false, name, message: e.message }; }
  }
  async savedInfo(verseId) { return (await this.store.getKv(SAVED_KEY + verseId)) || null; }
  /** "Save again": the stored accepted take for this verse, downloaded again under the same name. */
  async saveAgain(verseId) {
    const t = await this.store.acceptedTake(verseId);
    if (!t) return { ok: false, name: fileNameOf(verseId), message: 'Nothing recorded for this verse yet.' };
    return this.saveTake(t);
  }
}
