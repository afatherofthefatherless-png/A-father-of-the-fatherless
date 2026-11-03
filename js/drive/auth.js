// Google Identity Services, token model (browser only). Scope drive.file only. No client secret exists or is needed.
// The access token is kept in memory only (lasts ~1 h). When it expires, uploads pause in AUTH_EXPIRED until the
// user taps "Sign in again" (GIS needs a user gesture to show its popup).
// UNTESTED against Google: needs Robin's sign-in on the real GitHub Pages origin.
import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from '../config.js';

let tokenClient = null, token = null, expiresAt = 0, pending = null;
const listeners = new Set();
export function onAuthChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = () => listeners.forEach(fn => { try { fn(isSignedIn()); } catch {} });

export function loadGis() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true;
    s.onload = () => res(); s.onerror = () => rej(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}

async function client() {
  await loadGis();
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: resp => {
        const p = pending; pending = null;
        if (resp.error) { p?.rej(new Error(resp.error_description || resp.error)); return; }
        if (!google.accounts.oauth2.hasGrantedAllScopes(resp, DRIVE_SCOPE)) { p?.rej(new Error('Drive permission was not granted')); return; }
        token = resp.access_token; expiresAt = Date.now() + (Number(resp.expires_in) || 3600) * 1000 - 60000;
        emit(); p?.res(token);
      },
      error_callback: err => { const p = pending; pending = null; p?.rej(new Error(err?.message || err?.type || 'Sign-in closed')); },
    });
  }
  return tokenClient;
}

/** Call from a click/tap handler. */
export async function signIn() {
  const c = await client();
  return new Promise((res, rej) => { pending = { res, rej }; c.requestAccessToken({ prompt: token ? '' : 'consent' }); });
}
export function isSignedIn() { return !!token && Date.now() < expiresAt; }
/** Returns a valid token or null (caller treats null as AUTH_EXPIRED). */
export function getToken() { return isSignedIn() ? token : null; }
export function markExpired() { token = null; expiresAt = 0; emit(); }
export function signOut() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null; expiresAt = 0; emit();
}
