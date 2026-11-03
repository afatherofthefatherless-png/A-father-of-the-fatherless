// Google Identity Services, token model (browser only). Scope drive.file only. No client secret exists or is needed.
// The access token (lasts ~1 h) is kept in memory and in sessionStorage for this tab only, so moving between pages or
// reloading does not ask again; closing the tab forgets it. Nothing asks for sign-in until verse text or an upload
// actually needs Drive (see needToken). When it expires, uploads pause in AUTH_EXPIRED until the
// user taps "Sign in again" (GIS needs a user gesture to show its popup).
// UNTESTED against Google: needs Robin's sign-in on the real GitHub Pages origin.
import { GOOGLE_CLIENT_ID, DRIVE_SCOPE } from '../config.js';

let tokenClient = null, token = null, expiresAt = 0, pending = null;
const SESSION_KEY = 'kjv-site.drive-token.v1';
const ss = () => { try { return globalThis.sessionStorage || null; } catch { return null; } };
function remember() { try { const s = ss(); if (!s) return; if (token) s.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt })); else s.removeItem(SESSION_KEY); } catch {} }
try { const raw = ss()?.getItem(SESSION_KEY); if (raw) { const o = JSON.parse(raw); if (o && o.token && o.expiresAt > Date.now()) { token = o.token; expiresAt = o.expiresAt; } } } catch {}
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
        remember(); emit(); p?.res(token);
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
export function markExpired() { token = null; expiresAt = 0; remember(); emit(); }
/** Lazy sign-in: returns the session token, or (from a tap) asks Google once. Use only when Drive is really needed. */
export async function needToken() { return getToken() || signIn(); }
export function signOut() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {});
  token = null; expiresAt = 0; remember(); emit();
}
