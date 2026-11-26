/* Live reading tracker (design D). Progress uses the live
   localStorage key and Firebase path via reading-progress.js. */
(function () {
  var B = window.BibliaReading;
  if (!B) return;

  var openSet = Object.create(null);
  var focusBi = 0;

  function bookStats(bi) { return B.bookChapterStats(bi); }

  function totals() {
    var rCh = 0, bi, s;
    for (bi = 0; bi < B.COUNTS.length; bi++) {
      s = bookStats(bi);
      rCh += s.rCh;
    }
    return { rCh: rCh, nCh: 1189 };
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
    var name = B.COUNTS[bi][0];
    var on = B.isChapterRead(bi, ch);
    var label = name + ' ' + ch + ', ' + (on ? 'read' : 'not read') + '. Tap to mark or unmark.';
    return '<button type="button" class="ch is-numbered' + (on ? ' is-read' : '') + '"' +
      ' data-bi="' + bi + '" data-ch="' + ch + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '"' +
      ' aria-label="' + B.esc(label) + '">' +
      '<span class="ch-num">' + ch + '</span></button>';
  }

  function bodyHTML(bi) {
    var n = B.COUNTS[bi][1].length, ch, html;
    html = '<div class="d-body">' +
      '<p class="d-body-note">Tap a chapter to mark or unmark it. Green with a number is read.</p>' +
      '<div class="ch-grid">';
    for (ch = 1; ch <= n; ch++) html += chapterButton(bi, ch);
    html += '</div></div>';
    return html;
  }

  function headLabel(s, open) {
    return s.name + ', ' + s.rCh + ' of ' + s.nCh + ' chapters read' +
      (s.rCh === s.nCh && s.nCh > 0 ? ', complete' : '') +
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
      '" data-book="' + B.esc(s.name) + '" data-bi="' + bi + '">' +
      '<button type="button" class="d-head" aria-expanded="' + (open ? 'true' : 'false') + '"' +
      ' aria-label="' + B.esc(headLabel(s, open)) + '">' +
        '<span class="nm"><span class="nm-text">' + B.esc(s.name) + '</span>' +
          '<span class="tick" title="All chapters read" aria-hidden="true">✓</span></span>' +
        '<span class="ct">' + s.rCh + ' of ' + s.nCh + ' read</span>' +
        '<span class="chev" aria-hidden="true">▾</span>' +
        '<span class="pbar" aria-hidden="true"><i style="width:' + (s.rCh ? Math.max(4, pct) : 0) + '%"></i></span>' +
      '</button>';
    if (open) html += bodyHTML(bi);
    html += '</article>';
    return html;
  }

  function summaryText() {
    var t = totals();
    var pct = fmtPct(t.rCh, t.nCh);
    var s = bookStats(focusBi);
    return s.name + ' ' + s.rCh + ' of ' + s.nCh + ' · Whole Bible ' + pct;
  }

  function render() {
    var ot = '', nt = '', bi;
    for (bi = 0; bi < B.COUNTS.length; bi++) {
      if (bi < B.NT_START) ot += boxHTML(bi);
      else nt += boxHTML(bi);
    }
    var back = B.lastChapterUrl ? B.lastChapterUrl() : B.READER_BASE;
    document.getElementById('app').innerHTML =
      '<header class="top"><div class="wrap">' +
        '<div class="row">' +
          '<h1 class="grow">Reading Tracker</h1>' +
          '<a class="btnlink" id="back-to-reader" href="' + B.esc(back) + '">Back to reader</a>' +
          '<button type="button" class="btnlink reader-account-btn" aria-expanded="false">Sign in</button>' +
        '</div>' +
        '<div class="prog">' +
          '<span id="progText"></span>' +
          '<span id="progPct"></span>' +
        '</div>' +
        '<div class="bar" aria-hidden="true"><i id="progBar"></i></div>' +
      '</div></header>' +
      '<main class="wrap">' +
        '<p class="help">Tap a book to open it, then tap a chapter to mark or unmark it. Buttons are large enough for a finger or a Pencil.</p>' +
        '<div class="legend" aria-hidden="true">' +
          '<span class="leg"><span class="ch is-read is-numbered"><span class="ch-num">1</span></span> Read</span>' +
          '<span class="leg"><span class="ch is-numbered"><span class="ch-num">2</span></span> Not read</span>' +
        '</div>' +
        '<section class="testament"><h2>Old Testament</h2><div class="d-list" id="ot-list">' + ot + '</div></section>' +
        '<section class="testament"><h2>New Testament</h2><div class="d-list" id="nt-list">' + nt + '</div></section>' +
      '</main>';
    updateSummary();
    if (B.updateAccountButtons) B.updateAccountButtons();
  }

  function updateSummary() {
    var t = totals();
    var pct = fmtPct(t.rCh, t.nCh);
    var text = document.getElementById('progText');
    var pctl = document.getElementById('progPct');
    var bar = document.getElementById('progBar');
    if (text) text.textContent = summaryText();
    if (pctl) pctl.textContent = pct;
    if (bar) bar.style.width = barWidth(t.rCh, t.nCh);
    var back = document.getElementById('back-to-reader');
    if (back && B.lastChapterUrl) back.setAttribute('href', B.lastChapterUrl());
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
    var grid = box.querySelector('.ch-grid');
    if (grid) {
      grid.querySelectorAll('button.ch').forEach(function (btn) {
        var ch = +btn.getAttribute('data-ch');
        var on = B.isChapterRead(bi, ch);
        btn.classList.toggle('is-read', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    updateSummary();
  }

  function ensureBody(box, bi) {
    if (!box.querySelector('.d-body')) box.insertAdjacentHTML('beforeend', bodyHTML(bi));
  }

  function toggleOpen(bi) {
    var box = document.querySelector('.d-box[data-bi="' + bi + '"]');
    if (!box) return;
    if (openSet[bi]) delete openSet[bi];
    else {
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
  }

  function onClick(e) {
    var chBtn = e.target.closest('button.ch[data-ch]');
    if (chBtn) {
      e.preventDefault();
      var bi = +chBtn.getAttribute('data-bi');
      var ch = +chBtn.getAttribute('data-ch');
      focusBi = bi;
      B.toggleChapterRead(bi, ch);
      updateBook(bi);
      return;
    }
    var head = e.target.closest('button.d-head');
    if (head) {
      e.preventDefault();
      var box = head.closest('.d-box');
      if (box) toggleOpen(+box.getAttribute('data-bi'));
    }
  }

  function refreshFromStorage() {
    B.loadProgress();
    var y = window.scrollY;
    render();
    window.scrollTo(0, y);
  }

  render();
  document.getElementById('app').addEventListener('click', onClick);
  document.addEventListener('biblia-progress-changed', function () {
    var open = Object.keys(openSet);
    var y = window.scrollY;
    render();
    open.forEach(function (bi) {
      openSet[bi] = 1;
      var box = document.querySelector('.d-box[data-bi="' + bi + '"]');
      if (box) {
        box.classList.add('is-open');
        ensureBody(box, +bi);
        var head = box.querySelector('.d-head');
        if (head) head.setAttribute('aria-expanded', 'true');
      }
    });
    window.scrollTo(0, y);
    updateSummary();
  });
})();
