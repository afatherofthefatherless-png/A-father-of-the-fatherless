/* Example Bible data and progress for tracker mockups. Not live data. */
(function (global) {
  var COUNTS = [["Genesis",[31,25,24,26,32,22,24,22,29,32,32,20,18,24,21,16,27,33,38,18,34,24,20,67,34,35,46,22,35,43,55,32,20,31,29,43,36,30,23,23,57,38,34,34,28,34,31,22,33,26]],["Exodus",[22,25,22,31,23,30,25,32,35,29,10,51,22,31,27,36,16,27,25,26,36,31,33,18,40,37,21,43,46,38,18,35,23,35,35,38,29,31,43,38]],["Leviticus",[17,16,17,35,19,30,38,36,24,20,47,8,59,57,33,34,16,30,37,27,24,33,44,23,55,46,34]],["Numbers",[54,34,51,49,31,27,89,26,23,36,35,16,33,45,41,50,13,32,22,29,35,41,30,25,18,65,23,31,40,16,54,42,56,29,34,13]],["Deuteronomy",[46,37,29,49,33,25,26,20,29,22,32,32,18,29,23,22,20,22,21,20,23,30,25,22,19,19,26,68,29,20,30,52,29,12]],["Joshua",[18,24,17,24,15,27,26,35,27,43,23,24,33,15,63,10,18,28,51,9,45,34,16,33]],["Judges",[36,23,31,24,31,40,25,35,57,18,40,15,25,20,20,31,13,31,30,48,25]],["Ruth",[22,23,18,22]],["1 Samuel",[28,36,21,22,12,21,17,22,27,27,15,25,23,52,35,23,58,30,24,42,15,23,29,22,44,25,12,25,11,31,13]],["2 Samuel",[27,32,39,12,25,23,29,18,13,19,27,31,39,33,37,23,29,33,43,26,22,51,39,25]],["1 Kings",[53,46,28,34,18,38,51,66,28,29,43,33,34,31,34,34,24,46,21,43,29,53]],["2 Kings",[18,25,27,44,27,33,20,29,37,36,21,21,25,29,38,20,41,37,37,21,26,20,37,20,30]],["1 Chronicles",[54,55,24,43,26,81,40,40,44,14,47,40,14,17,29,43,27,17,19,8,30,19,32,31,31,32,34,21,30]],["2 Chronicles",[17,18,17,22,14,42,22,18,31,19,23,16,22,15,19,14,19,34,11,37,20,12,21,27,28,23,9,27,36,27,21,33,25,33,27,23]],["Ezra",[11,70,13,24,17,22,28,36,15,44]],["Nehemiah",[11,20,32,23,19,19,73,18,38,39,36,47,31]],["Esther",[22,23,15,17,14,14,10,17,32,3]],["Job",[22,13,26,21,27,30,21,22,35,22,20,25,28,22,35,22,16,21,29,29,34,30,17,25,6,14,23,28,25,31,40,22,33,37,16,33,24,41,30,24,34,17]],["Psalms",[6,12,8,8,12,10,17,9,20,18,7,8,6,7,5,11,15,50,14,9,13,31,6,10,22,12,14,9,11,12,24,11,22,22,28,12,40,22,13,17,13,11,5,26,17,11,9,14,20,23,19,9,6,7,23,13,11,11,17,12,8,12,11,10,13,20,7,35,36,5,24,20,28,23,10,12,20,72,13,19,16,8,18,12,13,17,7,18,52,17,16,15,5,23,11,13,12,9,9,5,8,28,22,35,45,48,43,13,31,7,10,10,9,8,18,19,2,29,176,7,8,9,4,8,5,6,5,6,8,8,3,18,3,3,21,26,9,8,24,13,10,7,12,15,21,10,20,14,9,6]],["Proverbs",[33,22,35,27,23,35,27,36,18,32,31,28,25,35,33,33,28,24,29,30,31,29,35,34,28,28,27,28,27,33,31]],["Ecclesiastes",[18,26,22,16,20,12,29,17,18,20,10,14]],["Song of Solomon",[17,17,11,16,16,13,13,14]],["Isaiah",[31,22,26,6,30,13,25,22,21,34,16,6,22,32,9,14,14,7,25,6,17,25,18,23,12,21,13,29,24,33,9,20,24,17,10,22,38,22,8,31,29,25,28,28,25,13,15,22,26,11,23,15,12,17,13,12,21,14,21,22,11,12,19,12,25,24]],["Jeremiah",[19,37,25,31,31,30,34,22,26,25,23,17,27,22,21,21,27,23,15,18,14,30,40,10,38,24,22,17,32,24,40,44,26,22,19,32,21,28,18,16,18,22,13,30,5,28,7,47,39,46,64,34]],["Lamentations",[22,22,66,22,22]],["Ezekiel",[28,10,27,17,17,14,27,18,11,22,25,28,23,23,8,63,24,32,14,49,32,31,49,27,17,21,36,26,21,26,18,32,33,31,15,38,28,23,29,49,26,20,27,31,25,24,23,35]],["Daniel",[21,49,30,37,31,28,28,27,27,21,45,13]],["Hosea",[11,23,5,19,15,11,16,14,17,15,12,14,16,9]],["Joel",[20,32,21]],["Amos",[15,16,15,13,27,14,17,14,15]],["Obadiah",[21]],["Jonah",[17,10,10,11]],["Micah",[16,13,12,13,15,16,20]],["Nahum",[15,13,19]],["Habakkuk",[17,20,19]],["Zephaniah",[18,15,20]],["Haggai",[15,23]],["Zechariah",[21,13,10,14,11,15,14,23,17,12,17,14,9,21]],["Malachi",[14,17,18,6]],["Matthew",[25,23,17,25,48,34,29,34,38,42,30,50,58,36,39,28,27,35,30,34,46,46,39,51,46,75,66,20]],["Mark",[45,28,35,41,43,56,37,38,50,52,33,44,37,72,47,20]],["Luke",[80,52,38,44,39,49,50,56,62,42,54,59,35,35,32,31,37,43,48,47,38,71,56,53]],["John",[51,25,36,54,47,71,53,59,41,42,57,50,38,31,27,33,26,40,42,31,25]],["Acts",[26,47,26,37,42,15,60,40,43,48,30,25,52,28,41,40,34,28,41,38,40,30,35,27,27,32,44,31]],["Romans",[32,29,31,25,21,23,25,39,33,21,36,21,14,23,33,27]],["1 Corinthians",[31,16,23,21,13,20,40,13,27,33,34,31,13,40,58,24]],["2 Corinthians",[24,17,18,18,21,18,16,24,15,18,33,21,14]],["Galatians",[24,21,29,31,26,18]],["Ephesians",[23,22,21,32,33,24]],["Philippians",[30,30,21,23]],["Colossians",[29,23,25,18]],["1 Thessalonians",[10,20,13,18,28]],["2 Thessalonians",[12,17,18]],["1 Timothy",[20,15,16,16,25,21]],["2 Timothy",[18,26,17,22]],["Titus",[16,15,15]],["Philemon",[25]],["Hebrews",[14,18,19,16,14,20,28,13,28,39,40,29,25]],["James",[27,26,18,17,20]],["1 Peter",[25,25,22,19,14]],["2 Peter",[21,22,18]],["1 John",[10,29,24,21,21]],["2 John",[13]],["3 John",[14]],["Jude",[25]],["Revelation",[20,29,22,11,14,17,17,13,21,11,19,17,18,20,8,21,18,24,21,15,27,21]]];

  /* Well-known Psalms, scattered on purpose for the example. */
  var PSALMS_READ = {1:1, 8:1, 19:1, 23:1, 27:1, 46:1, 51:1, 90:1, 91:1, 100:1, 103:1, 119:1, 121:1, 139:1, 150:1};
  var NT_START = 39;

  function isChapterRead(bi, ch) {
    if (bi === 0) return ch >= 1 && ch <= 12;
    if (bi === 1) return ch >= 1 && ch <= 3;
    if (bi === 18) return !!PSALMS_READ[ch];
    if (bi === 39) return ch >= 1 && ch <= 5;
    return false;
  }

  function bookStats(bi) {
    var chs = COUNTS[bi][1];
    var nCh = chs.length;
    var nV = 0, rCh = 0, rV = 0;
    for (var i = 0; i < nCh; i++) {
      nV += chs[i];
      if (isChapterRead(bi, i + 1)) { rCh++; rV += chs[i]; }
    }
    return { name: COUNTS[bi][0], nCh: nCh, nV: nV, rCh: rCh, rV: rV };
  }

  var TOTAL_CH = 0, TOTAL_V = 0, READ_CH = 0, READ_V = 0;
  for (var i = 0; i < COUNTS.length; i++) {
    var s = bookStats(i);
    TOTAL_CH += s.nCh; TOTAL_V += s.nV; READ_CH += s.rCh; READ_V += s.rV;
  }

  function fmt(n) { return n.toLocaleString('en-GB'); }

  function esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
  }

  function chapterButtons(bi, numbered) {
    var name = COUNTS[bi][0];
    var n = COUNTS[bi][1].length;
    var html = '';
    for (var ch = 1; ch <= n; ch++) {
      var read = isChapterRead(bi, ch);
      var label = name + ' ' + ch + ', ' + (read ? 'read' : 'not read') + '. Tap to mark or unmark.';
      html += '<button type="button" class="ch' + (read ? ' is-read' : '') + (numbered ? ' is-numbered' : '') + '"' +
        ' aria-label="' + esc(label) + '"' +
        ' aria-pressed="' + (read ? 'true' : 'false') + '">';
      if (numbered) html += '<span class="ch-num">' + ch + '</span>';
      else html += '<span class="ch-dot" aria-hidden="true"></span>';
      html += '</button>';
    }
    return html;
  }

  function headerHTML(opts) {
    return (
      '<header class="top">' +
        '<div class="wrap">' +
          '<div class="row">' +
            '<h1 class="grow">Reading Tracker</h1>' +
            '<a class="btnlink" href="#">Back to reader</a>' +
            '<button type="button" class="btnlink">Sign in</button>' +
          '</div>' +
          '<p class="mock-tag">' + esc(opts.tag) + '</p>' +
          '<div class="prog">' +
            '<span>Genesis 12 of 50 · Whole Bible 3%</span>' +
            '<span>3%</span>' +
          '</div>' +
          '<div class="bar" aria-hidden="true"><i style="width:3%"></i></div>' +
        '</div>' +
      '</header>'
    );
  }

  function helpHTML(chapterWord) {
    var extra = chapterWord
      ? ' You can also tap a ' + chapterWord + ' to mark or unmark it.'
      : ' The verse dots below are for seeing progress, not for tapping.';
    return (
      '<p class="example-banner">Example progress only — not live data. Genesis 1–12, Exodus 1–3, some Psalms, Matthew 1–5.</p>' +
      '<p class="help">After you open a chapter you will still be asked <b>Mark as read?</b> Yes or No.' + extra + ' Buttons are large enough for a finger or a Pencil.</p>' +
      '<div class="mark-demo" aria-label="Unchanged Mark as read prompt, as it appears on the reader">' +
        '<p class="mark-demo-label">Unchanged on the reader, after you open a chapter</p>' +
        '<div class="reader-mark-read">' +
          '<span class="reader-mark-read-q">Mark as read?</span>' +
          '<button type="button" class="reader-mark-read-yes">Yes</button>' +
          '<button type="button" class="reader-mark-read-no">No</button>' +
        '</div>' +
      '</div>'
    );
  }

  function legendHTML(numbered) {
    return (
      '<div class="legend" aria-hidden="true">' +
        (numbered
          ? '<span class="leg"><span class="ch is-read is-numbered"><span class="ch-num">1</span></span> Read</span>' +
            '<span class="leg"><span class="ch is-numbered"><span class="ch-num">2</span></span> Not read</span>'
          : '<span class="leg"><span class="ch is-read"><span class="ch-dot"></span></span> Read</span>' +
            '<span class="leg"><span class="ch"><span class="ch-dot"></span></span> Not read</span>') +
      '</div>'
    );
  }

  global.Mock = {
    COUNTS: COUNTS,
    NT_START: NT_START,
    TOTAL_CH: TOTAL_CH,
    TOTAL_V: TOTAL_V,
    READ_CH: READ_CH,
    READ_V: READ_V,
    isChapterRead: isChapterRead,
    bookStats: bookStats,
    fmt: fmt,
    esc: esc,
    chapterButtons: chapterButtons,
    headerHTML: headerHTML,
    helpHTML: helpHTML,
    legendHTML: legendHTML
  };
})(window);
