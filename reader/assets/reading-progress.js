/* Biblia Dyslexia reading-progress tracker.
   Dot grid, colours and canvas layout are taken from the original
   Bible Reading Tracker (KJV) at /workspace/bible-reading-tracker.html
   (identical to /workspace/onepage-plan/src/xwzn961.html,
   SHA-256 c22348d55f6b27311d74962ac090f3bcc1dbbf2b06b0b6743c82f99fcf083e63,
   the ShareHTML xwzn961 app).
   Uses a new localStorage key so the old Tracker marks and the live
   coverage tracker are left untouched.
*/
var COUNTS = [["Genesis",[31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26]],["Exodus",[22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38]],["Leviticus",[17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34]],["Numbers",[54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13]],["Deuteronomy",[46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12]],["Joshua",[18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33]],["Judges",[36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25]],["Ruth",[22,23,18,22]],["1 Samuel",[28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13]],["2 Samuel",[27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25]],["1 Kings",[53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53]],["2 Kings",[18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30]],["1 Chronicles",[54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30]],["2 Chronicles",[17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23]],["Ezra",[11,70,13,24,17,22,28,36,15,44]],["Nehemiah",[11,20,32,23,19,19,73,18,38,39,36,47,31]],["Esther",[22,23,15,17,14,14,10,17,32,3]],["Job",[22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17]],["Psalms",[6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6]],["Proverbs",[33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31]],["Ecclesiastes",[18,26,22,16,20,12,29,17,18,20,10,14]],["Song of Solomon",[17,17,11,16,16,13,13,14]],["Isaiah",[31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24]],["Jeremiah",[19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34]],["Lamentations",[22,22,66,22,22]],["Ezekiel",[28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35]],["Daniel",[21,49,30,37,31,28,28,27,27,21,45,13]],["Hosea",[11,23,5,19,15,11,16,14,17,15,12,14,16,9]],["Joel",[20,32,21]],["Amos",[15,16,15,13,27,14,17,14,15]],["Obadiah",[21]],["Jonah",[17,10,10,11]],["Micah",[16,13,12,13,15,16,20]],["Nahum",[15,13,19]],["Habakkuk",[17,20,19]],["Zephaniah",[18,15,20]],["Haggai",[15,23]],["Zechariah",[21,13,10,14,11,15,14,23,17,12,17,14,9,21]],["Malachi",[14,17,18,6]],["Matthew",[25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20]],["Mark",[45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20]],["Luke",[80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53]],["John",[51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25]],["Acts",[26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31]],["Romans",[32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27]],["1 Corinthians",[31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24]],["2 Corinthians",[24,17,18,18,21,18,16,24,15,18,33,21,14]],["Galatians",[24,21,29,31,26,18]],["Ephesians",[23,22,21,32,33,24]],["Philippians",[30,30,21,23]],["Colossians",[29,23,25,18]],["1 Thessalonians",[10,20,13,18,28]],["2 Thessalonians",[12,17,18]],["1 Timothy",[20,15,16,16,25,21]],["2 Timothy",[18,26,17,22]],["Titus",[16,15,15]],["Philemon",[25]],["Hebrews",[14,18,19,16,14,20,28,13,28,39,40,29,25]],["James",[27,26,18,17,20]],["1 Peter",[25,25,22,19,14]],["2 Peter",[21,22,18]],["1 John",[10,29,24,21,21]],["2 John",[13]],["3 John",[14]],["Jude",[25]],["Revelation",[20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21]]];

(function () {
  'use strict';

  var READER_BASE = '/A-father-of-the-fatherless/reader/';
  var TRACKER_URL = READER_BASE + 'tracker/';
  var STORAGE_KEY = 'biblia-dyslexia-reading-progress.v1';
  var SESSION_SKIP = 'biblia-dyslexia-reading-progress-skip';

  /* ---- verse index (same as the original tracker) ---- */
  var N = 0, OFF = [], BSTART = [], BTOT = [], BOOK_SLUG = [], SLUG_TO_BI = Object.create(null);
  function slugOf(name) { return String(name).toLowerCase().replace(/\s+/g, '-'); }
  COUNTS.forEach(function (bk, bi) {
    BSTART[bi] = N;
    var o = [];
    bk[1].forEach(function (n) { o.push(N); N += n; });
    OFF.push(o);
    BTOT[bi] = N - BSTART[bi];
    BOOK_SLUG[bi] = slugOf(bk[0]);
    SLUG_TO_BI[BOOK_SLUG[bi]] = bi;
  });
  var VB = new Uint8Array(N), VC = new Uint16Array(N), VV = new Uint16Array(N);
  COUNTS.forEach(function (bk, bi) {
    bk[1].forEach(function (n, ci) {
      for (var v = 1; v <= n; v++) {
        var g = OFF[bi][ci] + v - 1;
        VB[g] = bi; VC[g] = ci + 1; VV[g] = v;
      }
    });
  });
  function fmtNum(n) { return n.toLocaleString('en-GB'); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function displayBook(bi) { var n = COUNTS[bi][0]; return n === 'Psalms' ? 'Psalm' : n; }
  function vref(g) { return displayBook(VB[g]) + ' ' + VC[g] + ':' + VV[g]; }

  /* ---- storage: never reads or writes the old coverage-tracker keys ---- */
  var COV = new Uint8Array(N), covered = 0, chapters = Object.create(null), storageOK = true;

  function chapterKey(bi, c) { return BOOK_SLUG[bi] + ':' + c; }

  function rebuildCoverage() {
    COV.fill(0);
    covered = 0;
    Object.keys(chapters).forEach(function (k) {
      var p = k.split(':'), bi = SLUG_TO_BI[p[0]], c = +p[1];
      if (bi == null || !c) return;
      var nch = COUNTS[bi][1].length;
      if (c < 1 || c > nch) return;
      var a = OFF[bi][c - 1], n = COUNTS[bi][1][c - 1];
      for (var g = a; g < a + n; g++) COV[g] = 1;
    });
    for (var g = 0; g < N; g++) if (COV[g]) covered++;
  }

  function loadProgress() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { storageOK = false; }
    chapters = Object.create(null);
    if (raw) {
      try {
        var data = JSON.parse(raw);
        if (data && data.app === 'biblia-dyslexia-reading-progress' && Array.isArray(data.chapters)) {
          data.chapters.forEach(function (k) { if (typeof k === 'string') chapters[k] = 1; });
        }
      } catch (e) { /* unreadable: start fresh, do not touch other keys */ }
    }
    rebuildCoverage();
  }

  function progressPayload() {
    return {
      app: 'biblia-dyslexia-reading-progress',
      version: 1,
      translation: 'KJV',
      totalVerses: N,
      saved: new Date().toISOString(),
      chapters: Object.keys(chapters).sort()
    };
  }

  function saveProgress() {
    var payload = progressPayload();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); storageOK = true; }
    catch (e) { storageOK = false; }
    scheduleCloudSave(payload);
  }

  function isChapterRead(bi, c) { return !!chapters[chapterKey(bi, c)]; }

  function markChapterRead(bi, c) {
    chapters[chapterKey(bi, c)] = 1;
    rebuildCoverage();
    saveProgress();
  }

  function bookCovered(bi) {
    var k = 0;
    for (var g = BSTART[bi]; g < BSTART[bi] + BTOT[bi]; g++) if (COV[g]) k++;
    return k;
  }

  /* ---- original map: one 5px dot per verse, one canvas per book ---- */
  var DOT = 5, PITCH = 7, mapW = 0, mapDirty = true, mapBooks = [], mapSel = -1;
  var DOT_COL = ['#ffffff', '#22c55e']; /* unread = original white; read = original complete/green */

  function layoutMap() {
    var el = document.getElementById('map');
    if (!el) return false;
    var W = el.clientWidth; if (!W) return false;
    var dpr = window.devicePixelRatio || 1;
    if (W !== mapW || dpr !== layoutMap.dpr) {
      var cols = Math.max(1, Math.floor((W + PITCH - DOT) / PITCH));
      mapBooks.forEach(function (b, bi) {
        var rows = Math.ceil(BTOT[bi] / cols), w = cols * PITCH - (PITCH - DOT), hh = rows * PITCH - (PITCH - DOT);
        b.cols = cols;
        b.cv.style.width = w + 'px';
        b.cv.style.height = hh + 'px';
        b.cv.width = Math.round(w * dpr);
        b.cv.height = Math.round(hh * dpr);
      });
      mapW = W; layoutMap.dpr = dpr; mapDirty = true;
    }
    return true;
  }

  function dotState(g) { return COV[g] ? 1 : 0; }

  function drawBook(bi) {
    var b = mapBooks[bi], c = b.cv.getContext('2d'), dpr = b.cv.width / parseFloat(b.cv.style.width), s0 = BSTART[bi], n = BTOT[bi], r = DOT / 2;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, b.cv.width, b.cv.height);
    for (var k = 0; k < DOT_COL.length; k++) {
      c.beginPath();
      for (var i = 0; i < n; i++) {
        if (dotState(s0 + i) !== k) continue;
        var x = (i % b.cols) * PITCH + r, y = Math.floor(i / b.cols) * PITCH + r;
        c.moveTo(x + r, y); c.arc(x, y, r, 0, 6.2832);
      }
      c.fillStyle = DOT_COL[k]; c.fill();
    }
    b.ct.textContent = fmtNum(bookCovered(bi)) + ' / ' + fmtNum(n);
  }

  function showDot(g) {
    var info = document.getElementById('mapInfo');
    if (!info) return;
    var bi = VB[g], st = dotState(g);
    mapBooks[bi].el.appendChild(info);
    info.innerHTML = '<b>' + esc(vref(g)) + '</b> · ' + ['Not read', 'Read'][st];
  }

  function renderMap() {
    mapDirty = true;
    if (!layoutMap()) return;
    for (var bi = 0; bi < COUNTS.length; bi++) drawBook(bi);
    mapDirty = false;
    if (mapSel >= 0) showDot(mapSel);
  }

  function renderHeader() {
    var pct = covered / N * 100;
    var text = document.getElementById('progText');
    var pctl = document.getElementById('progPct');
    var bar = document.getElementById('progBar');
    if (text) text.textContent = 'Read ' + fmtNum(covered) + ' of ' + fmtNum(N) + ' verses';
    if (pctl) pctl.textContent = (pct === 0 ? '0' : pct < 10 ? pct.toFixed(2) : pct.toFixed(1)) + '%';
    if (bar) bar.style.width = covered ? 'max(3px, ' + Math.min(100, pct) + '%)' : '0';
  }

  function initMap() {
    var M = document.getElementById('map');
    if (!M) return;
    var h = '';
    COUNTS.forEach(function (bk, bi) {
      h += '<div class="mbook" data-bi="' + bi + '"><div class="mhead"><span class="nm">' + esc(bk[0]) + '</span><span class="ct"></span></div><canvas role="img" aria-label="' + esc(bk[0]) + '"></canvas></div>';
    });
    M.innerHTML = h + '<div id="mapInfo" class="mapinfo" aria-live="polite"></div>';
    mapBooks = [];
    M.querySelectorAll('.mbook').forEach(function (el) {
      var bi = +el.getAttribute('data-bi');
      mapBooks[bi] = { el: el, cv: el.querySelector('canvas'), ct: el.querySelector('.ct'), cols: 1 };
    });
    M.addEventListener('click', function (e) {
      var cv = e.target.closest('canvas'); if (!cv) return;
      var bi = +cv.parentNode.getAttribute('data-bi'), b = mapBooks[bi], rc = cv.getBoundingClientRect();
      var col = Math.floor((e.clientX - rc.left) / PITCH), row = Math.floor((e.clientY - rc.top) / PITCH), i = row * b.cols + col;
      if (col < 0 || col >= b.cols || i < 0 || i >= BTOT[bi]) return;
      mapSel = BSTART[bi] + i; showDot(mapSel);
    });
    window.addEventListener('resize', function () { renderMap(); });
    renderHeader();
    renderMap();
  }

  /* ---- reader path helpers ---- */
  function readerParts() {
    var parts = location.pathname.split('/').filter(Boolean);
    var i = parts.indexOf('reader');
    if (i < 0) return [];
    return parts.slice(i + 1);
  }

  function isTrackerPage() {
    var after = readerParts();
    return after[0] === 'tracker';
  }

  function chapterLocation() {
    var after = readerParts();
    if (after.length >= 2 && after[0] !== 'tracker' && /^\d+$/.test(after[1])) {
      var bi = SLUG_TO_BI[after[0]];
      var c = +after[1];
      if (bi == null) return null;
      if (c < 1 || c > COUNTS[bi][1].length) return null;
      return { bi: bi, c: c, slug: after[0] };
    }
    return null;
  }

  function skipKey(loc) { return loc.slug + ':' + loc.c; }

  function readSkipSet() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_SKIP) || '{}'); }
    catch (e) { return {}; }
  }
  function writeSkipSet(s) {
    try { sessionStorage.setItem(SESSION_SKIP, JSON.stringify(s)); } catch (e) {}
  }


  /* ---- Firebase Auth + Realtime Database (project bible-reading-tracker-18cf8) ----
     The original Bible Reading Tracker uses this same project only for save-code
     snapshots at /t/<code>.json, with no login. This reading tracker does not
     touch that path. Progress for a signed-in person is stored at
     users/<uid>/reading-progress. Signed-out progress stays in localStorage.
     Console settings and database rules are not changed by this page. */
  var FB_CONFIG = {
    apiKey: 'AIzaSyCvK1qqhrdqvKiaJIZrPORbeOcQKPpNyoI',
    authDomain: 'bible-reading-tracker-18cf8.firebaseapp.com',
    databaseURL: 'https://bible-reading-tracker-18cf8-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'bible-reading-tracker-18cf8',
    storageBucket: 'bible-reading-tracker-18cf8.firebasestorage.app',
    messagingSenderId: '577346979030',
    appId: '1:577346979030:web:014b5407d905fedd9cb577'
  };
  var FB_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  var EMAIL_LINK_KEY = 'biblia-dyslexia-email-for-link';
  var fbApp = null, fbAuth = null, fbDb = null, fbUser = null, fbReady = null, cloudTimer = null, lastAuthError = '';

  function preferRedirect() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function authMessage(err) {
    var code = (err && (err.code || err.message)) || '';
    var text = (err && err.message) || String(err || '');
    if (/CONFIGURATION_NOT_FOUND|auth\/configuration-not-found|auth\/operation-not-allowed|admin-restricted-operation/i.test(code + ' ' + text)) {
      return 'Sign in is not switched on yet for this site. Progress is still saved on this device.';
    }
    if (/auth\/unauthorized-domain|unauthorized-domain/i.test(code + ' ' + text)) {
      return 'This site address is not yet allowed for sign-in. Progress is still saved on this device.';
    }
    if (/PERMISSION_DENIED|permission-denied/i.test(code + ' ' + text)) {
      return 'Signed in, but the shared copy could not be saved yet. Progress is still saved on this device.';
    }
    if (/auth\/invalid-email/i.test(code)) return 'Please type a valid email address.';
    if (/auth\/invalid-credential|auth\/wrong-password|auth\/user-not-found/i.test(code)) return 'That email and password did not match.';
    if (/auth\/email-already-in-use/i.test(code)) return 'That email already has an account. Try Sign in, or use a sign-in link.';
    if (/auth\/weak-password/i.test(code)) return 'Please choose a longer password.';
    if (/auth\/missing-password/i.test(code)) return 'Please type a password, or send a sign-in link instead.';
    if (/auth\/popup-blocked|auth\/popup-closed-by-user/i.test(code)) return 'The Google window was blocked or closed. Please try again.';
    return 'Could not sign in. Progress is still saved on this device.';
  }

  function loadFirebase() {
    if (fbReady) return fbReady;
    fbReady = Promise.all([
      import(FB_SDK + 'firebase-app.js'),
      import(FB_SDK + 'firebase-auth.js'),
      import(FB_SDK + 'firebase-database.js')
    ]).then(function (mods) {
      var appMod = mods[0], authMod = mods[1], dbMod = mods[2];
      fbApp = appMod.getApps && appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(FB_CONFIG);
      fbAuth = authMod.getAuth(fbApp);
      fbDb = dbMod.getDatabase(fbApp, FB_CONFIG.databaseURL);
      loadFirebase.authMod = authMod;
      loadFirebase.dbMod = dbMod;
      return finishEmailLink().then(function () {
        return authMod.getRedirectResult(fbAuth).catch(function (err) {
          lastAuthError = authMessage(err);
          showAuthMessage(lastAuthError);
        });
      }).then(function () {
        authMod.onAuthStateChanged(fbAuth, onAuthChanged);
      });
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
    return fbReady;
  }

  function finishEmailLink() {
    var authMod = loadFirebase.authMod;
    if (!authMod || !authMod.isSignInWithEmailLink(fbAuth, location.href)) return Promise.resolve();
    var email = '';
    try { email = localStorage.getItem(EMAIL_LINK_KEY) || ''; } catch (e) {}
    if (!email) email = window.prompt('Please type the email that received the sign-in link.') || '';
    if (!email) return Promise.resolve();
    return authMod.signInWithEmailLink(fbAuth, email, location.href).then(function () {
      try { localStorage.removeItem(EMAIL_LINK_KEY); } catch (e) {}
      try { history.replaceState(null, '', location.pathname + location.search.replace(/[?&]apiKey=[^&]*/g, '').replace(/^&/, '?') + location.hash); } catch (e) {}
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function cloudPath() {
    return fbUser ? 'users/' + fbUser.uid + '/reading-progress' : null;
  }

  function cloudGet() {
    if (!fbUser || !fbDb) return Promise.resolve(null);
    var dbMod = loadFirebase.dbMod;
    return dbMod.get(dbMod.ref(fbDb, cloudPath())).then(function (snap) {
      return snap.exists() ? snap.val() : null;
    });
  }

  function cloudPut(payload) {
    if (!fbUser || !fbDb) return Promise.resolve();
    var dbMod = loadFirebase.dbMod;
    return dbMod.set(dbMod.ref(fbDb, cloudPath()), payload);
  }

  function applyChapterList(list) {
    (list || []).forEach(function (k) { if (typeof k === 'string') chapters[k] = 1; });
    rebuildCoverage();
  }

  function mergeCloudAndLocal(cloud) {
    applyChapterList(cloud && Array.isArray(cloud.chapters) ? cloud.chapters : []);
    var payload = progressPayload();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); storageOK = true; }
    catch (e) { storageOK = false; }
    return cloudPut(payload).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function scheduleCloudSave(payload) {
    if (!fbUser) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(function () {
      cloudPut(payload || progressPayload()).catch(function (err) {
        lastAuthError = authMessage(err);
        showAuthMessage(lastAuthError);
      });
    }, 400);
  }

  function onAuthChanged(user) {
    fbUser = user || null;
    updateAccountButtons();
    if (!fbUser) return;
    cloudGet().then(function (cloud) {
      return mergeCloudAndLocal(cloud);
    }).then(function () {
      if (isTrackerPage()) { renderHeader(); renderMap(); }
      else scheduleHook();
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function accountLabel() { return fbUser ? 'Sign out' : 'Sign in'; }

  function updateAccountButtons() {
    var nodes = document.querySelectorAll('.reader-account-btn');
    Array.prototype.forEach.call(nodes, function (btn) {
      btn.textContent = accountLabel();
      btn.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') || 'false');
    });
    if (fbUser) closeSignInPanel();
  }

  function showAuthMessage(text) {
    var msg = document.querySelector('#reader-sign-in .reader-sign-msg');
    if (msg) msg.textContent = text || '';
  }

  function closeSignInPanel() {
    var panel = document.getElementById('reader-sign-in');
    if (panel) panel.remove();
    Array.prototype.forEach.call(document.querySelectorAll('.reader-account-btn'), function (btn) {
      btn.setAttribute('aria-expanded', 'false');
    });
  }

  function openSignInPanel() {
    if (document.getElementById('reader-sign-in')) return;
    var panel = document.createElement('div');
    panel.id = 'reader-sign-in';
    panel.className = 'reader-sign-in';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-labelledby', 'reader-sign-in-title');
    panel.innerHTML =
      '<h2 id="reader-sign-in-title">Sign in</h2>' +
      '<button type="button" class="reader-sign-google">Sign in with Google</button>' +
      '<p class="muted">Or use your email</p>' +
      '<label for="reader-sign-email">Email</label>' +
      '<input id="reader-sign-email" type="email" autocomplete="email" inputmode="email">' +
      '<label for="reader-sign-password">Password</label>' +
      '<input id="reader-sign-password" type="password" autocomplete="current-password">' +
      '<div class="reader-sign-row">' +
        '<button type="button" class="reader-sign-email-in">Sign in</button>' +
        '<button type="button" class="reader-sign-create">Create account</button>' +
      '</div>' +
      '<button type="button" class="reader-sign-link">Send a sign-in link</button>' +
      '<p class="reader-sign-msg" aria-live="polite"></p>' +
      '<button type="button" class="reader-sign-close">Close</button>';
    document.body.appendChild(panel);
    if (lastAuthError) showAuthMessage(lastAuthError);
    panel.querySelector('.reader-sign-google').addEventListener('click', function () { doGoogle(); });
    panel.querySelector('.reader-sign-email-in').addEventListener('click', function () { doEmailPassword(false); });
    panel.querySelector('.reader-sign-create').addEventListener('click', function () { doEmailPassword(true); });
    panel.querySelector('.reader-sign-link').addEventListener('click', function () { doEmailLink(); });
    panel.querySelector('.reader-sign-close').addEventListener('click', closeSignInPanel);
    var email = panel.querySelector('#reader-sign-email');
    if (email) email.focus();
  }

  function emailFields() {
    var panel = document.getElementById('reader-sign-in');
    return {
      email: ((panel && panel.querySelector('#reader-sign-email').value) || '').trim(),
      password: (panel && panel.querySelector('#reader-sign-password').value) || ''
    };
  }

  function doGoogle() {
    showAuthMessage('Opening Google…');
    loadFirebase().then(function () {
      if (!fbAuth) throw new Error('CONFIGURATION_NOT_FOUND');
      var authMod = loadFirebase.authMod;
      var provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      if (preferRedirect()) return authMod.signInWithRedirect(fbAuth, provider);
      return authMod.signInWithPopup(fbAuth, provider).catch(function (err) {
        if (/popup/i.test(err && err.code || '')) return authMod.signInWithRedirect(fbAuth, provider);
        throw err;
      });
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function doEmailPassword(create) {
    var f = emailFields();
    if (!f.email) { showAuthMessage('Please type your email address.'); return; }
    if (!f.password) { showAuthMessage('Please type a password, or send a sign-in link instead.'); return; }
    showAuthMessage(create ? 'Creating account…' : 'Signing in…');
    loadFirebase().then(function () {
      if (!fbAuth) throw new Error('CONFIGURATION_NOT_FOUND');
      var authMod = loadFirebase.authMod;
      return create ? authMod.createUserWithEmailAndPassword(fbAuth, f.email, f.password)
                    : authMod.signInWithEmailAndPassword(fbAuth, f.email, f.password);
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function doEmailLink() {
    var f = emailFields();
    if (!f.email) { showAuthMessage('Please type your email address.'); return; }
    showAuthMessage('Sending link…');
    loadFirebase().then(function () {
      if (!fbAuth) throw new Error('CONFIGURATION_NOT_FOUND');
      var authMod = loadFirebase.authMod;
      var settings = {
        url: location.origin + TRACKER_URL,
        handleCodeInApp: true
      };
      return authMod.sendSignInLinkToEmail(fbAuth, f.email, settings).then(function () {
        try { localStorage.setItem(EMAIL_LINK_KEY, f.email); } catch (e) {}
        showAuthMessage('A sign-in link has been sent to ' + f.email + '. Open it on this device.');
      });
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function onAccountClick() {
    if (fbUser) {
      loadFirebase().then(function () { return loadFirebase.authMod.signOut(fbAuth); })
        .catch(function (err) { lastAuthError = authMessage(err); showAuthMessage(lastAuthError); });
      return;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.reader-account-btn'), function (btn) {
      btn.setAttribute('aria-expanded', 'true');
    });
    openSignInPanel();
    loadFirebase();
  }

  function ensureAccountButton(host) {
    var btn = host.querySelector('.reader-account-btn');
    if (btn) {
      btn.textContent = accountLabel();
      return btn;
    }
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'reader-account-btn';
    btn.textContent = accountLabel();
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      onAccountClick();
    });
    host.appendChild(btn);
    return btn;
  }

  /* ---- reader hook: Tracker tab + Mark as read? Yes / No ---- */
  var hookScheduled = false;
  function scheduleHook() {
    if (hookScheduled) return;
    hookScheduled = true;
    queueMicrotask(function () { hookScheduled = false; ensureReaderChrome(); });
  }

  function ensureReaderChrome() {
    if (isTrackerPage()) return;
    var header = document.querySelector('.app-header');
    if (!header) return;

    var tools = header.querySelector('.reader-header-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'reader-header-tools';
      header.appendChild(tools);
    }
    ensureAccountButton(tools);
    var tab = tools.querySelector('.reader-tracker-tab') || header.querySelector('.reader-tracker-tab');
    if (tab && tab.parentNode !== tools) tools.appendChild(tab);
    if (!tab) {
      tab = document.createElement('a');
      tab.className = 'reader-tracker-tab';
      tab.href = TRACKER_URL;
      tab.textContent = 'Tracker';
      tab.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        window.location.assign(TRACKER_URL);
      }, true);
      tools.appendChild(tab);
    }

    var loc = chapterLocation();
    var bar = document.getElementById('reader-mark-read');
    if (!loc) {
      if (bar) bar.remove();
      return;
    }

    if (isChapterRead(loc.bi, loc.c)) {
      if (bar) bar.remove();
      return;
    }
    var skipped = readSkipSet();
    if (skipped[skipKey(loc)]) {
      if (bar) bar.remove();
      return;
    }

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'reader-mark-read';
      bar.className = 'reader-mark-read';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Mark this chapter as read');
      bar.innerHTML = '<span class="reader-mark-read-q">Mark as read?</span>' +
        '<button type="button" class="reader-mark-read-yes">Yes</button>' +
        '<button type="button" class="reader-mark-read-no">No</button>';
      document.body.appendChild(bar);
      bar.querySelector('.reader-mark-read-yes').addEventListener('click', function () {
        var here = chapterLocation();
        if (!here) return;
        markChapterRead(here.bi, here.c);
        bar.remove();
      });
      bar.querySelector('.reader-mark-read-no').addEventListener('click', function () {
        var here = chapterLocation();
        if (here) {
          var s = readSkipSet();
          s[skipKey(here)] = 1;
          writeSkipSet(s);
        }
        bar.remove();
      });
    }
  }

  function hookHistory() {
    ['pushState', 'replaceState'].forEach(function (fn) {
      var orig = history[fn];
      if (orig.__rpWrapped) return;
      var wrapped = function () {
        var ret = orig.apply(this, arguments);
        scheduleHook();
        return ret;
      };
      wrapped.__rpWrapped = true;
      history[fn] = wrapped;
    });
    window.addEventListener('popstate', scheduleHook);
    var mo = new MutationObserver(scheduleHook);
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  loadProgress();
  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      loadProgress();
      if (isTrackerPage()) { renderHeader(); renderMap(); }
      else scheduleHook();
    }
  });

  function startAuth() { loadFirebase(); }

  if (isTrackerPage()) {
    function bootTracker() {
      var row = document.querySelector('header.top .row');
      if (row) ensureAccountButton(row);
      initMap();
      startAuth();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootTracker);
    else bootTracker();
  } else if (readerParts().length || location.pathname.indexOf('/reader') !== -1) {
    hookHistory();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { scheduleHook(); startAuth(); });
    else { scheduleHook(); startAuth(); }
  }
})();
