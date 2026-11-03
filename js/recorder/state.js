// Recorder state machine (one verse at a time) and the per-verse upload sub-machine. Pure: transition() returns
// the next state or throws on an illegal event, so the UI can never reach an undefined state.
//
// Verse:  IDLE -record-> ARMING -armed-> ARMED -onset|tap-> RECORDING -stop|autostop-> PROCESSING -processed-> REVIEW
//         REVIEW -accept-> SAVING -saved-> SAVED  (then the upload is queued, and the UI moves to the next verse's IDLE)
//         REVIEW -rerecord-> ARMING (the old take is KEPT, marked superseded; never deleted)
//         PROCESSING -failcheck-> FAILED_CHECK (hard failure: re-record only); -nospeech-> NO_SPEECH
//         IDLE -skip-> SKIPPED (stitching blocked until recorded); any settled state -select-> IDLE (jump to redo)
//         errors: MIC_DENIED, MIC_LOST (take discarded from the live buffer, back to ARMING on retry), STORAGE_FULL
// Upload: NONE -queue-> QUEUED -start-> UPLOADING -done-> UPLOADED; -fail-> UPLOAD_FAILED -retry-> QUEUED;
//         -authexpired-> AUTH_EXPIRED -signedin-> QUEUED. A local copy is kept in IndexedDB in every case.

export const S = Object.freeze({
  IDLE: 'IDLE', ARMING: 'ARMING', ARMED: 'ARMED', RECORDING: 'RECORDING', PROCESSING: 'PROCESSING',
  REVIEW: 'REVIEW', FAILED_CHECK: 'FAILED_CHECK', SAVING: 'SAVING', SAVED: 'SAVED', SKIPPED: 'SKIPPED',
  MIC_DENIED: 'MIC_DENIED', MIC_LOST: 'MIC_LOST', NO_SPEECH: 'NO_SPEECH', STORAGE_FULL: 'STORAGE_FULL',
});
export const U = Object.freeze({ NONE: 'NONE', QUEUED: 'QUEUED', UPLOADING: 'UPLOADING', UPLOADED: 'UPLOADED', UPLOAD_FAILED: 'UPLOAD_FAILED', AUTH_EXPIRED: 'AUTH_EXPIRED' });

const T = {
  IDLE: { record: 'ARMING', skip: 'SKIPPED', micdenied: 'MIC_DENIED' },
  ARMING: { armed: 'ARMED', micdenied: 'MIC_DENIED', miclost: 'MIC_LOST', cancel: 'IDLE' },
  ARMED: { onset: 'RECORDING', tap: 'RECORDING', miclost: 'MIC_LOST', cancel: 'IDLE' },
  RECORDING: { stop: 'PROCESSING', autostop: 'PROCESSING', miclost: 'MIC_LOST', cancel: 'IDLE' },
  PROCESSING: { processed: 'REVIEW', failcheck: 'FAILED_CHECK', nospeech: 'NO_SPEECH' },
  REVIEW: { accept: 'SAVING', rerecord: 'ARMING', skip: 'SKIPPED' },
  FAILED_CHECK: { rerecord: 'ARMING', skip: 'SKIPPED' },
  NO_SPEECH: { rerecord: 'ARMING', record: 'ARMING', skip: 'SKIPPED' },
  SAVING: { saved: 'SAVED', storagefull: 'STORAGE_FULL' },
  SAVED: { next: 'IDLE', rerecord: 'ARMING' },
  SKIPPED: { record: 'ARMING', next: 'IDLE' },
  MIC_DENIED: { record: 'ARMING', next: 'IDLE', skip: 'SKIPPED' },
  MIC_LOST: { record: 'ARMING', rerecord: 'ARMING', next: 'IDLE', skip: 'SKIPPED' },
  STORAGE_FULL: { accept: 'SAVING', next: 'IDLE' },
};
const SETTLED = new Set(['IDLE', 'REVIEW', 'FAILED_CHECK', 'NO_SPEECH', 'SAVED', 'SKIPPED', 'MIC_DENIED', 'MIC_LOST', 'STORAGE_FULL']);

export function transition(state, event) {
  if (event === 'select') { if (SETTLED.has(state)) return 'IDLE'; throw new Error(`Cannot jump to another verse while ${state}`); }
  const next = T[state] && T[state][event];
  if (!next) throw new Error(`Illegal event "${event}" in state ${state}`);
  return next;
}
export function canDo(state, event) { try { transition(state, event); return true; } catch { return false; } }

const UT = {
  NONE: { queue: 'QUEUED' },
  QUEUED: { start: 'UPLOADING', queue: 'QUEUED' },
  UPLOADING: { done: 'UPLOADED', fail: 'UPLOAD_FAILED', authexpired: 'AUTH_EXPIRED' },
  UPLOAD_FAILED: { retry: 'QUEUED', queue: 'QUEUED' },
  AUTH_EXPIRED: { signedin: 'QUEUED', queue: 'QUEUED' },
  UPLOADED: { queue: 'QUEUED' }, // a newer accepted take re-queues the verse
};
export function uploadTransition(state, event) {
  const next = UT[state] && UT[state][event];
  if (!next) throw new Error(`Illegal upload event "${event}" in ${state}`);
  return next;
}

/** Verse status shown in the list / used for resume. A verse is done once SAVED (local), regardless of upload. */
export function firstUnsaved(ids, statuses) {
  const i = ids.findIndex(id => statuses[id] !== S.SAVED);
  return i < 0 ? ids.length : i;
}
/** Stitching needs every verse SAVED. */
export function stitchBlockers(ids, statuses) { return ids.filter(id => statuses[id] !== S.SAVED); }

/** Backoff for upload retries: 2 s, 4 s, 8 s ... capped at 5 min. */
export function backoffMs(attempt) { return Math.min(300000, 2000 * 2 ** Math.max(0, attempt - 1)); }
