/* Interactive Mockup D. Uses a test-only localStorage key.
   Never touches biblia-dyslexia-reading-progress.v1 (the live tracker). */
(function () {
  var M = window.Mock;
  var STORAGE_KEY = 'biblia-dyslexia-tracker-mockup-d.v1';
  var PSALMS_EXAMPLE = [1, 8, 19, 23, 27, 46, 51, 90, 91, 100, 103, 119, 121, 139, 150];

  var read = Object.create(null);
  var openSet = Object.create(null);
  var focusBi = 0;

  function ck(bi, ch) { return bi + ':' + ch; }

  function isRead(bi, ch) { return !!read[ck(bi, ch)]; }

  function exampleRead() {
    var out = Object.create(null);
    var i;
    for (i = 1; i <= 12; i++) out[ck(0, i)] = 1;
    for (i = 1; i <= 3; i++) out[ck(1, i)] = 1;
    for (i = 0; i < PSALMS_EXAMPLE.length; i++) out[ck(18, PSALMS_EXAMPLE[i])] = 1;
    for (i = 1; i <= 5; i++) out[ck(39, i)] = 1;
    return out;
  }

  function loadState() {
    var raw, data;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { raw = null; }
    if (raw) {
      try { data = JSON.parse(raw); } catch (e) { data = null; }
    }
    if (data && data.app === 'tracker-mockup-d' && Array.isArray(data.chapters)) {
      read = Object.create(null);
      data.chapters.forEach(function (k) { read[k] = 1; });
      openSet = Object.create(null);
      (data.open || []).forEach(function (bi) { openSet[+bi] = 1; });
      focusBi = (data.focus == null ? 0 : +data.focus);
      if (!M.COUNTS[focusBi]) focusBi = 0;
      return;
    }
    read = exampleRead();
    openSet = Object.create(null);
    openSet[0] = 1;
    focusBi = 0;
  }

  function saveState() {
    var payload = {
      app: 'tracker-mockup-d',
      v: 1,
      chapters: Object.keys(read),
      open: Object.keys(openSet).map(Number).filter(function (bi) { return openSet[bi]; }),
      focus: focusBi
    };
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(payload)); } catch (e) {}
  }

  function bookStats(bi) {
    var chs = M.COUNTS[bi][1];
    var nCh = chs.length, rCh = 0, i;
    for (i = 1; i <= nCh; i++) if (isRead(bi, i)) rCh++;
    return { name: M.COUNTS[bi][0], nCh: nCh, rCh: rCh };
  }

  function totals() {
    var rCh = 0, bi, s;
    for (bi = 0; bi < M.COUNTS.length; bi++) {
      s = bookStats(bi);
      rCh += s.rCh;
    }
    return { rCh: rCh, nCh: M.TOTAL_CH };
  }

  function fmtPct(n, d) {
    var pct = d ? (n / d * 100) : 0;
    if (pct === 0) return '0%';
    if (pct < 10) return pct.toFixed(2) + '%';
    return pct.toFixed(1) + '%';
  }

  function barWidth(n, d) {
    if (!n || !d) return '0';
    var pct = n / d * 100;
    return 'max(4px, ' + Math.min(100, pct) + '%)';
  }

  function chapterButton(bi, ch) {
    var name = M.COUNTS[bi][0];
    var on = isRead(bi, ch);
    var label = name + ' ' + ch + ', ' + (on ? 'read' : 'not read') + '. Tap to mark or unmark.';
    return '<button type="button" class="ch is-numbered' + (on ? ' is-read' : '') + '"' +
      ' data-bi="' + bi + '" data-ch="' + ch + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
      ' aria-label="' + M.esc(label) + '">' +
      '<span class="ch-num">' + ch + '</span></button>';
  }

  function bodyHTML(bi) {
    var n = M.COUNTS[bi][1].length, ch, html;
    html = '<div class="d-body">' +
      '<p class="d-body-note">Tap a chapter to mark or unmark it. Green with a number is read.</p>' +
      '<div class="ch-grid">';
    for (ch = 1; ch <= n; ch++) html += chapterButton(bi, ch);
    html += '</div></div>';
    return html;
  }

  function headLabel(s, open) {
    return s.name + ', ' + s.rCh + ' of ' + s.nCh + ' chapters read' +
      (s.rCh === s.nCh ? ', complete' : '') +
      (open ? ', expanded' : ', collapsed');
  }

  function boxHTML(bi) {
    var s = bookStats(bi);
    var open = !!openSet[bi];
    var done = s.rCh === s.nCh && s.nCh > 0;
    var pct = s.nCh ? (s.rCh / s.nCh * 100) : 0;
    var html = '<article class="d-box' +
      (open ? ' is-open' : '') +
      (s.rCh ? ' has-progress' : '') +
      (done ? ' is-complete' : '') +
      '" data-book="' + M.esc(s.name) + '" data-bi="' + bi + '">' +
      '<button type="button" class="d-head" aria-expanded="' + (open ? 'true' : 'false') + '"' +
      ' aria-label="' + M.esc(headLabel(s, open)) + '">' +
        '<span class="nm"><span class="nm-text">' + M.esc(s.name) + '</span>' +
          '<span class="tick" title="All chapters read" aria-hidden="true">✓</span></span>' +
        '<span class="ct">' + s.rCh + ' of ' + s.nCh + ' read</span>' +
        '<span class="chev" aria-hidden="true">▾</span>' +
        '<span class="pbar" aria-hidden="true"><i style="width:' + (s.rCh ? Math.max(4, pct) : 0) + '%"></i></span>' +
      '</button>';
    if (open) html += bodyHTML(bi);
    html += '</article>';
    return html;
  }

  function render() {
    var ot = '', nt = '', bi;
    for (bi = 0; bi < M.COUNTS.length; bi++) {
      if (bi < M.NT_START) ot += boxHTML(bi);
      else nt += boxHTML(bi);
    }
    document.getElementById('app').innerHTML =
      '<header class="top"><div class="wrap">' +
        '<div class="row">' +
          '<h1 class="grow">Reading Tracker</h1>' +
          '<a class="btnlink" href="#">Back to reader</a>' +
          '<button type="button" class="btnlink">Sign in</button>' +
        '</div>' +
        '<p class="mock-tag">Mockup D — try it on this page. Progress stays on this device and does not change the live tracker.</p>' +
        '<div class="prog">' +
          '<span id="progText"></span>' +
          '<span id="progPct"></span>' +
        '</div>' +
        '<div class="bar" aria-hidden="true"><i id="progBar"></i></div>' +
      '</div></header>' +
      '<main class="wrap">' +
        '<p class="example-banner">Starting example: Genesis 1–12, Exodus 1–3, some Psalms, Matthew 1–5. Tap a book to open it, then tap a chapter to mark or unmark it.</p>' +
        '<p class="help">On the live reader you will still be asked <b>Mark as read?</b> Yes or No after you open a chapter. Here you can also tap a chapter square. Buttons are large enough for a finger or a Pencil.</p>' +
        '<div class="mark-demo" aria-label="Unchanged Mark as read prompt, as it appears on the reader">' +
          '<p class="mark-demo-label">Unchanged on the reader, after you open a chapter</p>' +
          '<div class="reader-mark-read">' +
            '<span class="reader-mark-read-q">Mark as read?</span>' +
            '<button type="button" class="reader-mark-read-yes">Yes</button>' +
            '<button type="button" class="reader-mark-read-no">No</button>' +
          '</div>' +
        '</div>' +
        M.legendHTML(true) +
        '<section class="testament"><h2>Old Testament</h2><div class="d-list" id="ot-list">' + ot + '</div></section>' +
        '<section class="testament"><h2>New Testament</h2><div class="d-list" id="nt-list">' + nt + '</div></section>' +
      '</main>';
    updateSummary();
  }

  function updateSummary() {
    var s = bookStats(focusBi);
    var t = totals();
    var pct = fmtPct(t.rCh, t.nCh);
    var text = document.getElementById('progText');
    var pctl = document.getElementById('progPct');
    var bar = document.getElementById('progBar');
    if (text) text.textContent = s.name + ' ' + s.rCh + ' of ' + s.nCh + ' · Whole Bible ' + pct;
    if (pctl) pctl.textContent = pct;
    if (bar) bar.style.width = barWidth(t.rCh, t.nCh);
  }

  function updateBook(bi) {
    var box = document.querySelector('.d-box[data-bi="' + bi + '"]');
    if (!box) return;
    var s = bookStats(bi);
    var done = s.rCh === s.nCh && s.nCh > 0;
    var open = !!openSet[bi];
    var pct = s.nCh ? (s.rCh / s.nCh * 100) : 0;
    box.classList.toggle('has-progress', s.rCh > 0);
    box.classList.toggle('is-complete', done);
    box.classList.toggle('is-open', open);
    var head = box.querySelector('.d-head');
    var ct = box.querySelector('.d-head .ct');
    var bar = box.querySelector('.d-head .pbar > i');
    if (head) {
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      head.setAttribute('aria-label', headLabel(s, open));
    }
    if (ct) ct.textContent = s.rCh + ' of ' + s.nCh + ' read';
    if (bar) bar.style.width = s.rCh ? Math.max(4, pct) + '%' : '0';
    updateSummary();
  }

  function ensureBody(box, bi) {
    if (!box.querySelector('.d-body')) {
      box.insertAdjacentHTML('beforeend', bodyHTML(bi));
    }
  }

  function toggleOpen(bi) {
    var box = document.querySelector('.d-box[data-bi="' + bi + '"]');
    if (!box) return;
    if (openSet[bi]) {
      delete openSet[bi];
    } else {
      openSet[bi] = 1;
      ensureBody(box, bi);
    }
    focusBi = bi;
    box.classList.toggle('is-open', !!openSet[bi]);
    var head = box.querySelector('.d-head');
    var s = bookStats(bi);
    if (head) {
      head.setAttribute('aria-expanded', openSet[bi] ? 'true' : 'false');
      head.setAttribute('aria-label', headLabel(s, !!openSet[bi]));
    }
    updateSummary();
    saveState();
  }

  function toggleChapter(bi, ch, btn) {
    var k = ck(bi, ch);
    if (read[k]) delete read[k];
    else read[k] = 1;
    var on = isRead(bi, ch);
    if (btn) {
      btn.classList.toggle('is-read', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var name = M.COUNTS[bi][0];
      btn.setAttribute('aria-label', name + ' ' + ch + ', ' + (on ? 'read' : 'not read') + '. Tap to mark or unmark.');
    }
    focusBi = bi;
    updateBook(bi);
    saveState();
  }

  function onClick(e) {
    var chBtn = e.target.closest('button.ch[data-ch]');
    if (chBtn) {
      e.preventDefault();
      toggleChapter(+chBtn.getAttribute('data-bi'), +chBtn.getAttribute('data-ch'), chBtn);
      return;
    }
    var head = e.target.closest('button.d-head');
    if (head) {
      e.preventDefault();
      var box = head.closest('.d-box');
      if (box) toggleOpen(+box.getAttribute('data-bi'));
    }
  }

  loadState();
  render();
  document.getElementById('app').addEventListener('click', onClick);
})();
