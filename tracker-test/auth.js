/* Sign-in for the tracker TEST page only.
   Reuses the live tracker's Firebase project and auth methods, but:
   - local progress stays on biblia-dyslexia-tracker-mockup-d.v1
     (never biblia-dyslexia-reading-progress.v1)
   - signed-in cloud copy is users/<uid>/tracker-test-progress
     (never users/<uid>/reading-progress)
   Firebase modules are loaded as soon as this page opens. The Google
   button calls signInWithPopup in the same tap, with no wait first.
   Popup is used on iPad and iPhone too; redirect is only used if the
   popup is blocked. */
(function () {
  var FB_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';
  /* Public web config, same as /reader/assets/firebase-config.js */
  var FB_CONFIG = {
    apiKey: 'AIzaSyCvK1qqhrdqvKiaJIZrPORbeOcQKPpNyoI',
    authDomain: 'bible-reading-tracker-18cf8.firebaseapp.com',
    databaseURL: 'https://bible-reading-tracker-18cf8-default-rtdb.europe-west1.firebasedatabase.app',
    projectId: 'bible-reading-tracker-18cf8',
    storageBucket: 'bible-reading-tracker-18cf8.firebasestorage.app',
    messagingSenderId: '577346979030',
    appId: '1:577346979030:web:014b5407d905fedd9cb577'
  };
  var EMAIL_LINK_KEY = 'biblia-dyslexia-tracker-test-email-for-link';
  var CLOUD_LEAF = 'tracker-test-progress';
  var APP_NAME = 'tracker-test';

  var fbApp = null, fbAuth = null, fbDb = null, fbUser = null, fbReady = null, cloudTimer = null, lastAuthError = '';

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
      return 'Signed in, but the test copy could not be saved yet. Progress is still saved on this device.';
    }
    if (/auth\/invalid-email/i.test(code)) return 'Please type a valid email address.';
    if (/auth\/invalid-credential|auth\/wrong-password|auth\/user-not-found/i.test(code)) return 'That email and password did not match.';
    if (/auth\/email-already-in-use/i.test(code)) return 'That email already has an account. Try Sign in, or use a sign-in link.';
    if (/auth\/weak-password/i.test(code)) return 'Please choose a longer password.';
    if (/auth\/missing-password/i.test(code)) return 'Please type a password, or send a sign-in link instead.';
    if (/auth\/popup-blocked/i.test(code)) return 'The Google window was blocked. Trying another way…';
    if (/auth\/popup-closed-by-user/i.test(code)) return 'The Google window was closed. Please try again.';
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
      try { fbApp = appMod.getApp(APP_NAME); }
      catch (e) { fbApp = appMod.initializeApp(FB_CONFIG, APP_NAME); }
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

  function testPageUrl() {
    var path = location.pathname;
    if (/index\.html?$/i.test(path)) path = path.replace(/index\.html?$/i, '');
    if (path.slice(-1) !== '/') path += '/';
    return location.origin + path;
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
      try {
        history.replaceState(null, '', location.pathname + location.search.replace(/[?&]apiKey=[^&]*/g, '').replace(/^&/, '?') + location.hash);
      } catch (e) {}
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function cloudPath() {
    return fbUser ? 'users/' + fbUser.uid + '/' + CLOUD_LEAF : null;
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

  function currentPayload() {
    return (window.TrackerTest && window.TrackerTest.buildPayload)
      ? window.TrackerTest.buildPayload()
      : { app: 'tracker-mockup-d', v: 1, chapters: [] };
  }

  function mergeCloudAndLocal(cloud) {
    var T = window.TrackerTest;
    if (T && T.applyRemoteChapters) {
      T.applyRemoteChapters(cloud && Array.isArray(cloud.chapters) ? cloud.chapters : []);
    }
    var payload = currentPayload();
    if (T && T.writeLocal) T.writeLocal(payload);
    if (T && T.refreshView) T.refreshView();
    return cloudPut(payload).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function scheduleCloudSave(payload) {
    if (!fbUser) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(function () {
      cloudPut(payload || currentPayload()).catch(function (err) {
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
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function accountLabel() { return fbUser ? 'Sign out' : 'Sign in'; }

  function updateAccountButtons() {
    var nodes = document.querySelectorAll('.reader-account-btn');
    var label = accountLabel();
    Array.prototype.forEach.call(nodes, function (btn) {
      if (btn.textContent !== label) btn.textContent = label;
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
    panel.querySelector('.reader-sign-google').addEventListener('click', function (e) {
      e.preventDefault();
      doGoogle();
    });
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

  /* Must not await or load modules here: iPad Safari drops the user gesture. */
  function doGoogle() {
    showAuthMessage('Opening Google…');
    var authMod = loadFirebase.authMod;
    if (!fbAuth || !authMod) {
      showAuthMessage('Still getting sign-in ready. Please try again in a moment.');
      loadFirebase();
      return;
    }
    var provider = new authMod.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    var popup = authMod.signInWithPopup(fbAuth, provider);
    popup.catch(function (err) {
      if (err && err.code === 'auth/popup-blocked') {
        showAuthMessage(authMessage(err));
        return authMod.signInWithRedirect(fbAuth, provider);
      }
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function doEmailPassword(create) {
    var f = emailFields();
    if (!f.email) { showAuthMessage('Please type your email address.'); return; }
    if (!f.password) { showAuthMessage('Please type a password, or send a sign-in link instead.'); return; }
    showAuthMessage(create ? 'Creating account…' : 'Signing in…');
    var authMod = loadFirebase.authMod;
    if (!fbAuth || !authMod) {
      showAuthMessage('Still getting sign-in ready. Please try again in a moment.');
      loadFirebase();
      return;
    }
    var work = create
      ? authMod.createUserWithEmailAndPassword(fbAuth, f.email, f.password)
      : authMod.signInWithEmailAndPassword(fbAuth, f.email, f.password);
    work.catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function doEmailLink() {
    var f = emailFields();
    if (!f.email) { showAuthMessage('Please type your email address.'); return; }
    showAuthMessage('Sending link…');
    var authMod = loadFirebase.authMod;
    if (!fbAuth || !authMod) {
      showAuthMessage('Still getting sign-in ready. Please try again in a moment.');
      loadFirebase();
      return;
    }
    var settings = { url: testPageUrl(), handleCodeInApp: true };
    authMod.sendSignInLinkToEmail(fbAuth, f.email, settings).then(function () {
      try { localStorage.setItem(EMAIL_LINK_KEY, f.email); } catch (e) {}
      showAuthMessage('A sign-in link has been sent to ' + f.email + '. Open it on this device.');
    }).catch(function (err) {
      lastAuthError = authMessage(err);
      showAuthMessage(lastAuthError);
    });
  }

  function onAccountClick() {
    if (fbUser) {
      var authMod = loadFirebase.authMod;
      if (authMod && fbAuth) {
        authMod.signOut(fbAuth).catch(function (err) {
          lastAuthError = authMessage(err);
          showAuthMessage(lastAuthError);
        });
      } else {
        loadFirebase().then(function () { return loadFirebase.authMod.signOut(fbAuth); })
          .catch(function (err) { lastAuthError = authMessage(err); showAuthMessage(lastAuthError); });
      }
      return;
    }
    Array.prototype.forEach.call(document.querySelectorAll('.reader-account-btn'), function (btn) {
      btn.setAttribute('aria-expanded', 'true');
    });
    openSignInPanel();
  }

  function bindAccountButton() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('.reader-account-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onAccountClick();
    }, true);
  }

  window.TrackerTestAuth = {
    scheduleCloudSave: scheduleCloudSave,
    updateAccountButtons: updateAccountButtons,
    isReady: function () { return !!(fbAuth && loadFirebase.authMod); },
    ready: function () { return loadFirebase(); },
    cloudLeaf: CLOUD_LEAF
  };

  bindAccountButton();
  loadFirebase();
})();
