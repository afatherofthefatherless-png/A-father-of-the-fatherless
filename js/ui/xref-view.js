// Cross Ref Map page (Robin's "X ref Map" drawing): top bar = "X ref map info" | "Link of the Day" (the link box),
// below it a landscape map: ruler of the 66 books on the left, one arc per cross-reference curving out to the right.
// Arc maths ported from the "Top 100 Arcs" prototype (bible-arc-diagram.html), redrawn on <canvas> for 344,799 arcs.
import { BOOKS } from '../kjv/books.js';
import { OSIS, GROUPS, groupOfBook, BOOK_START, bookIndexAt, THRESHOLDS, stepInfo, stepLabel, fmt, linkAt,
  pickTop, topInBook, arcOf, pointOn, ArcIndex, TOP_PICK, TOTAL_VERSES, visibleRange, refsInRange, arcVisible, fileInfo } from '../xref/xrefs.js';
import { loadRefs, devRefsUrl, REFS_FILE_NAME } from '../xref/refs-source.js';

const BATCH = 6000;      // arcs drawn per animation frame (progressive; the page never blocks)
const DOTS = 400;        // animated dots at most, taken from the top-voted arcs in view
const GLOW = 200;        // top-voted arcs that pulse
const DRAWIN_MAX = 3000; // more arcs than this changing in one slider move -> jump, no draw-in
const DRAWIN_MS = 400, FADE_MS = 200, HOVER_MS = 150, WAVE_MS = 1500, PULSE_MS = 2000;
const YELLOW = '#ffe81f'; // Rolling Reader accent
const SLIDER_KEY = 'kjv-site.xrefStep.v1';
const LONG = 4;          // the map is LONG x the old one-screen height (and at least 1.5x its width: tall A4-ish); the page scrolls through it
const LIST_MAX = 150;    // rows in the side list (visible range, ranked by votes)
const TAP_SLOP = 10;     // touch moves further than this = a scroll, not a tap
let state = null;        // survives re-renders of the page (data, selection, play state)
let cleanup = null;
export function closeXref() { if (cleanup) { cleanup(); cleanup = null; } }

export async function viewXref(main, { h, store, text, textStatusLine, textActions }) {
  closeXref();
  main.classList.add('wide');
  const devMotion = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).get('motion') === 'reduce'; // test-only emulation
  const reduce = devMotion || !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if (state && state.reduce !== reduce) state = null;
  if (!state) state = { reduce, set: null, status: 'loading', message: 'Loading the cross-references…', from: '', sel: -1, playing: !reduce, shown: localStorage.getItem(SLIDER_KEY) != null ? Number(localStorage.getItem(SLIDER_KEY)) : 2, note: '' };
  const devUrl = devRefsUrl(location.search || location.hash.split('?')[1], location.hostname);

  // ---- top bar: info (left) | Link of the Day (right)
  const totalEl = h('strong', { id: 'xr-total' }), shownEl = h('strong', { id: 'xr-shown' }), srcEl = h('p', { class: 'xr-src' });
  const actions = h('div', { class: 'row text-actions xr-actions' }), fileEl = h('div', { class: 'xr-file-body', id: 'xr-file-body' });
  const slider = h('input', { type: 'range', id: 'xr-slider', min: '0', max: String(THRESHOLDS.length - 1), step: '1', 'aria-label': 'Minimum votes a reference needs to be shown' });
  const countEl = h('output', { id: 'xr-count', for: 'xr-slider' });
  const playBtn = h('button', { id: 'xr-play', type: 'button' });
  const info = h('section', { class: 'card xr-info', 'aria-labelledby': 'xr-info-h' },
    h('h2', { id: 'xr-info-h' }, 'X ref map info'),
    h('p', { class: 'xr-stats' }, 'Total: ', totalEl, ' · Shown: ', shownEl),
    h('div', { class: 'xr-ctl' }, h('label', { class: 'xr-sl' }, h('span', {}, 'Minimum votes: all, 5, 10, 20, 50, 100'), slider), playBtn), countEl,
    h('details', { class: 'xr-file', id: 'xr-file' }, h('summary', {}, 'OpenBible cross-references text file info'), fileEl),
    h('p', { class: 'xr-credit' }, 'Cross-references: ', h('a', { href: 'https://www.openbible.info/labs/cross-references/', target: '_blank', rel: 'noopener' }, 'OpenBible.info'), ' (CC-BY).'));
  const status = h('section', { class: 'card xr-status', id: 'xr-status', 'aria-labelledby': 'xr-status-h' },
    h('h2', { id: 'xr-status-h' }, 'Data status'), srcEl, actions,
    h('p', { class: 'xr-help' }, 'Scroll down the page through the map from Genesis to Revelation. Tap an arc, a book, or a row in the list to put that link in the box.'),
    h('p', { class: 'xr-credit' }, 'Verse text: CrossWire KJV (data/kjv-crosswire.json). Cross-references: OpenBible.info, CC-BY (data/openbible-cross-references.txt). Both are served with this site, checked against data/manifest.json and kept on this device for offline use.'));
  const linkRef = h('p', { class: 'ref', id: 'xr-link-ref' }), linkMeta = h('p', { class: 'xr-meta', id: 'xr-link-meta' });
  const srcBox = h('div', { class: 'xr-vbox', id: 'xr-src-text', tabindex: '0', 'aria-label': 'Source verse text' }), tgtBox = h('div', { class: 'xr-vbox', id: 'xr-tgt-text', tabindex: '0', 'aria-label': 'Target verse text' });
  const linkText = h('div', { class: 'xr-text', id: 'xr-link-text' }), note = h('p', { class: 'xr-note', id: 'xr-note', role: 'status' });
  const pickBtn = h('button', { type: 'button', id: 'xr-pick', onclick: () => { if (state.set) select(pickTop(state.set)); } }, `Pick from top ${fmt(TOP_PICK)}`);
  const shareEl = h('textarea', { id: 'xr-share', class: 'xr-share', readonly: '', rows: '2', 'aria-label': 'Link of the Day, prepared for sharing later (no send route yet)' });
  const box = h('section', { class: 'card reading xr-box', id: 'xr-linkbox', 'aria-labelledby': 'xr-box-h', 'aria-live': 'polite' },
    h('h2', { id: 'xr-box-h' }, 'Link of the Day'), linkRef, linkMeta, h('div', { class: 'xr-vboxes' }, srcBox, tgtBox),
    h('div', { class: 'xr-foot' }, linkText, h('div', { class: 'row' }, pickBtn)), note,
    h('details', { class: 'xr-prep' }, h('summary', {}, 'Prepared for sharing (no send route yet)'), shareEl));

  // ---- map
  // The map is long (tall A4-ish) and the page itself scrolls through it (wheel, scrollbar, iPad touch). The canvases are
  // sticky inside the map and redraw only the visible slice; the ruler lives in the tall content so it stays aligned.
  const wrap = h('div', { class: 'xr-map', id: 'xr-map' });
  const scroller = h('div', { class: 'xr-scroll', id: 'xr-scroll' });
  const content = h('div', { class: 'xr-content' }), stick = h('div', { class: 'xr-stick' });
  const base = h('canvas', { class: 'xr-base', 'aria-hidden': 'true' }), over = h('canvas', { class: 'xr-over', role: 'img', 'aria-label': 'Cross-reference arc map. Use the ruler of books on the left.' });
  const ruler = h('div', { class: 'xr-ruler', role: 'list', 'aria-label': 'Books of the Bible' });
  stick.append(base, over); content.append(stick, ruler); scroller.append(content); wrap.append(scroller);
  const listHead = h('p', { class: 'xr-list-h', id: 'xr-list-h' }), listEl = h('ol', { class: 'xr-list', id: 'xr-list', 'aria-label': 'Links in view, highest votes first' });
  const side = h('aside', { class: 'card xr-side', 'aria-labelledby': 'xr-list-h' }, listHead, listEl);
  main.append(h('h1', { class: 'sr-only' }, 'Cross Ref Map'), h('div', { class: 'xr-top' }, info, box), h('div', { class: 'xr-body' }, wrap, side), status);

  let L = null, Lc = null, drawn = 0, drawRaf = 0, animRaf = 0, alive = true, dpr = 1, t0 = performance.now();
  const bctx = base.getContext('2d'), octx = over.getContext('2d');
  const n = () => state.set ? stepInfo(state.set, state.shown).drawn : 0;
  const motion = () => !reduce;              // prefers-reduced-motion: every animation off, changes jump
  let index = null, hover = -1, hoverT = 0, dim = 0, wave = null, drawIn = null, fading = null, lastN = 0, lastFrame = 0;
  const perf = { frames: 0, total: 0, max: 0, baseMs: 0, scroll: [] };

  function layout() {
    const hdr = headerH(); main.style.setProperty('--xr-hdr', hdr + 'px');
    const W = Math.max(280, scroller.clientWidth), vh = window.innerHeight;
    const oldH = W < 520 || window.innerWidth <= 760 ? Math.round(vh * 0.7) : Math.max(420, vh - 120); // the release-9 map height
    const CH = Math.max(LONG * oldH, Math.round(W * 1.5)), H = Math.max(240, Math.min(CH, vh - hdr));
    wrap.style.height = CH + 'px'; wrap.dataset.mapH = String(CH); wrap.dataset.oldH = String(oldH);
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const c of [base, over]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
    stick.style.height = H + 'px';
    const rw = W < 520 ? 54 : 92, top = 8, hh = CH - 16;
    content.style.height = CH + 'px';
    // L.y is in viewport px (content y minus the scroll offset); Lc is the same layout at offset 0 (content coords, for the index)
    L = { W, H, CH, sy: 0, x0: rw, maxW: W - rw - 8, top, h: hh, y: g => top + (g + 0.5) / TOTAL_VERSES * hh - L.sy };
    Lc = { ...L, sy: 0, y: g => top + (g + 0.5) / TOTAL_VERSES * hh };
    L.sy = offset(); wrap.dataset.sy = String(Math.round(L.sy));
    index = null; buildRuler();
  }
  // the page scrolls; the canvases are sticky inside the tall map, so the visible slice starts at their offset in the content
  function headerH() { const e = document.querySelector('header.top'); return e ? Math.round(e.getBoundingClientRect().height) : 0; }
  function offset() { return Math.max(0, Math.round(stick.getBoundingClientRect().top - content.getBoundingClientRect().top)); }
  function buildRuler() {
    ruler.replaceChildren(); ruler.style.width = L.x0 + 'px';
    BOOKS.forEach((b, i) => {
      const y1 = Lc.y(BOOK_START[i]) - 0.5, y2 = Lc.y(BOOK_START[i + 1]) - 0.5, g = GROUPS[groupOfBook(i)];
      const t = h('button', { type: 'button', class: 'xr-tick' + (y2 - y1 < 13 ? ' tiny' : ''), role: 'listitem', 'data-book': String(i), title: b.name, 'aria-label': `${b.name}: show its top link`,
        style: `top:${y1}px;height:${Math.max(2, y2 - y1)}px;--g:${g.color}`, onclick: () => { if (!state.set) return; const r = topInBook(state.set, i, n()); select(r >= 0 ? r : topInBook(state.set, i)); } },
        h('span', {}, y2 - y1 >= 13 ? OSIS[i] : ''));
      ruler.append(t);
    });
  }
  const alphaFor = N => Math.max(0.035, Math.min(0.85, 18 / Math.sqrt(Math.max(1, N))));
  const widthFor = N => N > 20000 ? 0.6 : N > 2000 ? 0.9 : 1.4;
  function strokeArc(ctx, a, frac = 1) {
    if (frac >= 1) { ctx.ellipse(a.x0, a.cy, a.rx, a.ry, 0, -Math.PI / 2, Math.PI / 2); return; }
    // draw-in from the source verse: down arcs start at the top end, up arcs at the bottom end
    if (a.down) { ctx.moveTo(a.x0, a.cy - a.ry); ctx.ellipse(a.x0, a.cy, a.rx, a.ry, 0, -Math.PI / 2, -Math.PI / 2 + Math.PI * frac); }
    else { ctx.moveTo(a.x0, a.cy + a.ry); ctx.ellipse(a.x0, a.cy, a.rx, a.ry, 0, Math.PI / 2, Math.PI / 2 - Math.PI * frac, true); }
  }
  /** Static layer: arcs [0, upto) drawn progressively, BATCH per frame, lowest rank first so top-voted sit on top. */
  function redrawBase(upto = n(), onDone) {
    cancelAnimationFrame(drawRaf); drawn = 0;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0); bctx.clearRect(0, 0, L.W, L.H);
    if (!state.set) return;
    const N = n(), M = Math.min(upto, N), alpha = alphaFor(N), tStart = performance.now(); let culled = 0;
    bctx.lineWidth = widthFor(N);
    const step = () => {
      if (!alive) return;
      const end = Math.min(M, drawn + BATCH);
      let col = null;
      for (let k = drawn; k < end; k++) {
        const r = M - 1 - k; if (!arcVisible(state.set, r, L)) { culled++; continue; }
        const c = GROUPS[groupOfBook(bookIndexAt(state.set.from[r]))].color;
        if (c !== col) { if (col) bctx.stroke(); bctx.strokeStyle = c; bctx.globalAlpha = alpha; bctx.beginPath(); col = c; }
        strokeArc(bctx, arcOf(state.set, r, L));
      }
      if (col) bctx.stroke();
      drawn = end; bctx.globalAlpha = 1; wrap.dataset.drawn = String(drawn); wrap.dataset.culled = String(culled);
      if (drawn < M) drawRaf = requestAnimationFrame(step);
      else { perf.baseMs = performance.now() - tStart; wrap.dataset.baseMs = perf.baseMs.toFixed(1); onDone && onDone(); }
    };
    step();
  }
  /** Slider moved: arcs that arrive draw themselves in (0.4 s), dropped arcs fade out (0.2 s); big jumps just jump. */
  function changeShown() {
    const N = n(), prev = lastN; lastN = N; index = null; setHover(-1);
    if (!state.set) return;
    if (!motion() || Math.abs(N - prev) > DRAWIN_MAX || prev === 0) { drawIn = fading = null; wrap.dataset.transition = 'jump'; redrawBase(); kick(); return; }
    wrap.dataset.transition = N > prev ? 'draw-in' : 'fade-out';
    if (N > prev) { drawIn = { from: prev, to: N, t: performance.now() }; redrawBase(prev); }   // new arcs live on the overlay until done
    else { fading = { from: N, to: prev, t: performance.now() }; redrawBase(); }
    kick();
  }
  function firstLoad() {
    lastN = n();
    if (!motion()) { wrap.dataset.transition = 'jump'; redrawBase(); kick(); return; }
    wave = { t: performance.now(), slow: 0 }; wrap.dataset.transition = 'wave'; redrawBase(); kick();
  }
  const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
  function setHover(r) { if (r !== hover) { hover = r; hoverT = performance.now(); wrap.dataset.hover = String(r); kick(); } }

  // Overlay: everything that moves (wave, draw-in, fades, glow, dots, hover/selection). The static layer is never redrawn per frame.
  function drawOver(now) {
    const f0 = performance.now();
    octx.setTransform(dpr, 0, 0, dpr, 0, 0); octx.clearRect(0, 0, L.W, L.H);
    let busy = false;
    if (!state.set) return false;
    const N = n(), S = state.set, maxV = Math.max(1, S.votes[0]), anim = motion() && state.playing;
    // (4) first-load wave, Genesis -> Revelation; aborted (jump to final) if frames get slow
    if (wave) {
      if (lastFrame && now - lastFrame > 50) wave.slow++;
      const p = (now - wave.t) / WAVE_MS;
      if (p >= 1 || wave.slow >= 3) { wrap.dataset.wave = wave.slow >= 3 ? 'aborted' : 'done'; wave = null; }
      else { const y = L.H * ease(p), g = octx.createLinearGradient(0, y - 40, 0, y + 40); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,1)');
        octx.fillStyle = g; octx.fillRect(L.x0 + 1, y - 40, L.W, 80); octx.fillStyle = '#000'; octx.fillRect(L.x0 + 1, y + 40, L.W, L.H); busy = true; }
    }
    // (2) draw-in of newly shown arcs, then commit them to the static layer
    if (drawIn) {
      const p = (now - drawIn.t) / DRAWIN_MS;
      if (p >= 1) { drawIn = null; redrawBase(); }
      else { octx.strokeStyle = YELLOW; octx.globalAlpha = Math.min(0.9, alphaFor(N) * 3); octx.lineWidth = widthFor(N); octx.beginPath();
        for (let r = drawIn.from; r < drawIn.to; r++) if (arcVisible(S, r, L)) strokeArc(octx, arcOf(S, r, L), ease(p)); octx.stroke(); busy = true; }
    }
    if (fading) {
      const p = (now - fading.t) / FADE_MS;
      if (p >= 1) fading = null;
      else { octx.strokeStyle = '#fff'; octx.globalAlpha = (1 - p) * Math.min(0.8, alphaFor(N) * 2); octx.lineWidth = widthFor(N); octx.beginPath();
        for (let r = fading.from; r < fading.to; r++) if (arcVisible(S, r, L)) strokeArc(octx, arcOf(S, r, L)); octx.stroke(); busy = true; }
    }
    octx.globalAlpha = 1;
    const sec = (now - t0) / 1000;
    // (3) soft pulsing glow on the top few hundred
    if (anim) {
      const g = Math.min(GLOW, N), pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * (now - t0) / PULSE_MS);
      octx.strokeStyle = YELLOW; octx.lineWidth = 4; octx.globalAlpha = 0.04 + 0.16 * pulse; octx.beginPath();
      for (let r = 0, k = 0; r < N && k < g; r++) if (arcVisible(S, r, L)) { k++; strokeArc(octx, arcOf(S, r, L)); } octx.stroke();
      // (1) dots source -> target, size and speed by votes
      const k = Math.min(DOTS, N); // top-voted arcs *in view* octx.globalAlpha = 0.95; octx.fillStyle = YELLOW; octx.beginPath();
      for (let r = 0, c = 0; r < N && c < k; r++) {
        if (!arcVisible(S, r, L)) continue; c++;
        const w = Math.sqrt(Math.max(0, S.votes[r]) / maxV), dur = 6 / (0.6 + 1.4 * w), t = (sec / dur + r * 0.618) % 1;
        const p = pointOn(arcOf(S, r, L), t), rad = 1.2 + 2.6 * w; octx.moveTo(p.x + rad, p.y); octx.arc(p.x, p.y, rad, 0, Math.PI * 2);
      }
      octx.fill(); octx.globalAlpha = 1; busy = true;
    }
    // (5) hover/tap: dim the rest, brighten + thicken the nearest arc, label both verses (0.15 s fade)
    const target = hover >= 0 ? 1 : 0, hp = motion() ? Math.min(1, (now - hoverT) / HOVER_MS) : 1;
    dim = target ? Math.max(dim, hp) : Math.min(dim, 1 - hp);
    if (dim > 0.001) { octx.fillStyle = `rgba(0,0,0,${0.6 * dim})`; octx.fillRect(L.x0 + 1, 0, L.W, L.H); }
    if (hp < 1) busy = true;
    for (const [r, col, w] of [[state.sel, YELLOW, 3], [hover, '#fff', 3.5]]) {
      if (r < 0 || r >= S.total) continue;
      const a = arcOf(S, r, L); octx.globalAlpha = r === hover ? Math.max(dim, 0.2) : 1; octx.strokeStyle = col; octx.lineWidth = w; octx.beginPath(); strokeArc(octx, a); octx.stroke();
      if (r === state.sel && anim) { const p = pointOn(a, (sec / 2.4) % 1); octx.fillStyle = YELLOW; octx.beginPath(); octx.arc(p.x, p.y, 5, 0, Math.PI * 2); octx.fill(); }
      if (r === hover) { const l = linkAt(S, r); octx.font = '600 12px OpenDyslexic, system-ui, sans-serif'; octx.fillStyle = '#fff';
        const p0 = pointOn(a, 0), p1 = pointOn(a, 1); octx.fillText(l.fromRef, L.x0 + 6, Math.min(L.H - 18, Math.max(12, p0.y - 4))); octx.fillText(l.toRef, L.x0 + 6, Math.max(26, Math.min(L.H - 4, p1.y + 14))); }
    }
    octx.globalAlpha = 1;
    const ft = performance.now() - f0; perf.frames++; perf.total += ft; perf.max = Math.max(perf.max, ft); lastFrame = now;
    return busy;
  }
  function loop(now) { animRaf = 0; if (!alive || !L) return; const busy = drawOver(now); if (busy) animRaf = requestAnimationFrame(loop); }
  function kick() { if (!animRaf && alive) animRaf = requestAnimationFrame(loop); }
  function setPlaying(p) {
    state.playing = p && !reduce;
    playBtn.textContent = reduce ? 'Animation off (reduced motion)' : state.playing ? 'Pause animation' : 'Play animation';
    playBtn.disabled = reduce; playBtn.setAttribute('aria-pressed', String(state.playing)); wrap.dataset.playing = String(state.playing); wrap.dataset.reduced = String(reduce); kick();
  }
  playBtn.onclick = () => setPlaying(!state.playing);
  function nearestAt(x, y, tol) {
    if (!state.set) return -1;
    // index is built once in content coordinates, so scrolling never rebuilds it: query at y + scroll offset
    if (!index || index.n !== n()) { const t = performance.now(); index = new ArcIndex(state.set, n(), Lc); wrap.dataset.indexMs = (performance.now() - t).toFixed(0); }
    return index.nearest(x, y + L.sy, tol);
  }

  function select(r) {
    if (!state.set || r < 0) return; state.sel = r; state.note = ''; note.textContent = '';
    fillBox(); markList(); kick();
  }
  function fillBox() {
    const l = state.set && linkAt(state.set, state.sel);
    pickBtn.disabled = !state.set;
    linkText.replaceChildren(); srcBox.replaceChildren(); tgtBox.replaceChildren();
    if (!l) { linkRef.textContent = state.set ? 'No link chosen yet' : 'No cross-references loaded'; srcBox.hidden = tgtBox.hidden = true; linkMeta.textContent = state.set ? `Tap an arc, a book, or Pick from top ${fmt(TOP_PICK)}.` : ''; return; }
    linkRef.textContent = `${l.fromRef} → ${l.toRef}`; fillShare();
    srcBox.setAttribute('aria-label', `Verse text: ${l.fromRef}`); tgtBox.setAttribute('aria-label', `Verse text: ${l.toRef}`);
    linkMeta.textContent = ''; srcBox.hidden = tgtBox.hidden = false;
    if (text && text.loaded) {   // verse text only from the site's checked data/kjv-crosswire.json
      const v = id => h('p', { class: 'verse' }, text.text(id) || '');
      srcBox.append(v(l.fromId)); tgtBox.append(...l.toIds.map(v));
    } else {
      const off = () => h('p', { class: 'xr-meta' }, 'Verse text not loaded.');
      srcBox.append(off()); tgtBox.append(off());
      linkText.append(h('p', { class: 'text-status' }, textStatusLine()), textActions());
    }
  }
  function fillShare() {
    const l = state.set && linkAt(state.set, state.sel);
    shareEl.value = l ? `Link of the Day: ${l.fromRef} → ${l.toRef} (OpenBible.info cross-references, CC-BY)` : '';
  }
  function fillFile() {
    const f = fileInfo(state.set);
    fileEl.replaceChildren(...(f ? [
      h('p', {}, h('strong', {}, 'File: '), REFS_FILE_NAME, ` (${state.from || 'not loaded'})`),
      h('p', {}, h('strong', {}, 'Format: '), 'tab-separated text, columns From Verse, To Verse, Votes (OSIS refs, e.g. Gen.1.1, ranges like John.1.1-John.1.3).'),
      h('p', {}, h('strong', {}, 'Refs: '), `${fmt(f.total)} from ${fmt(f.starts)} different starting verses; votes ${fmt(f.minV)} to ${fmt(f.maxV)}${f.skipped ? `; ${fmt(f.skipped)} lines skipped` : ''}.`),
      h('p', {}, h('strong', {}, 'Source: '), h('a', { href: 'https://www.openbible.info/labs/cross-references/', target: '_blank', rel: 'noopener' }, 'openbible.info/labs/cross-references'), ', CC-BY. Served unchanged from this site as data/openbible-cross-references.txt.')]
      : [h('p', {}, `${REFS_FILE_NAME} from OpenBible.info: tab-separated From Verse, To Verse, Votes. Not loaded yet.`)]));
  }
  // ---- side list: links in the visible range of verses, ranked by votes; scrolls on its own
  let listKey = '';
  function fillList(force) {
    const S = state.set; if (!S || !L) { listHead.textContent = 'Links in view'; listEl.replaceChildren(); listKey = ''; return; }
    const [g0, g1] = visibleRange(L), rows = refsInRange(S, n(), g0, g1, LIST_MAX), key = `${n()}|${rows.join(',')}`;
    const a = idOfRange(g0), b = idOfRange(g1);
    listHead.textContent = `Links in view: ${a} to ${b}${rows.length >= LIST_MAX ? ` (top ${LIST_MAX})` : ` (${rows.length})`}`;
    if (key === listKey && !force) return; listKey = key;
    listEl.replaceChildren(...rows.map(r => { const l = linkAt(S, r);
      return h('li', {}, h('button', { type: 'button', class: 'xr-row', 'data-rank': String(r), onclick: () => select(r),
        onpointerenter: ev => { if (ev.pointerType === 'mouse') setHover(r); }, onpointerleave: () => setHover(-1), onfocus: () => setHover(r), onblur: () => setHover(-1) },
        h('span', { class: 'xr-row-ref' }, `${l.fromRef} → ${l.toRef}`), h('span', { class: 'xr-row-v' }, fmt(l.votes)))); }));
    wrap.dataset.listRows = String(rows.length); markList();
  }
  const idOfRange = g => { const b = bookIndexAt(g); return BOOKS[b].name; };
  function markList() { for (const el of listEl.querySelectorAll('.xr-row')) { const on = Number(el.dataset.rank) === state.sel; el.classList.toggle('on', on); el.setAttribute('aria-pressed', String(on)); } }
  function fillInfo() { fillFile();
    const s = state.set; slider.disabled = !s; slider.value = String(state.shown);
    const si = stepInfo(s, state.shown);
    totalEl.textContent = s ? fmt(s.total) : '–'; shownEl.textContent = s ? fmt(si.count) : '0';
    countEl.textContent = s ? stepLabel(si) : 'No cross-references loaded yet';
    srcEl.textContent = s ? `Loaded from ${state.from}${s.skipped ? ` · ${fmt(s.skipped)} lines skipped (not KJV verses)` : ''}.` : state.message;
    actions.replaceChildren();
    const st = state.status;
    if (st === 'error' || st === 'invalid') actions.append(h('button', { type: 'button', onclick: () => reload() }, 'Try again'));
  }
  async function reload() {
    const r = await loadRefs({ store, devUrl });
    if (!alive) return;
    Object.assign(state, { set: r.set, status: r.status, message: r.message, from: r.from });
    if (r.set && state.sel >= r.set.total) state.sel = -1;
    wrap.dataset.total = r.set ? String(r.set.total) : '0';
    fillInfo(); fillBox(); fillList(true); firstLoad();
  }
  let slT = 0;
  slider.addEventListener('input', () => {
    state.shown = Number(slider.value); try { localStorage.setItem(SLIDER_KEY, String(state.shown)); } catch {}
    if (state.set) { const si = stepInfo(state.set, state.shown); countEl.textContent = stepLabel(si); shownEl.textContent = fmt(si.count); }
    clearTimeout(slT); slT = setTimeout(() => { changeShown(); fillList(); }, 60); // live label, debounced redraw
  });
  const pt = ev => { const b = over.getBoundingClientRect(); return [ev.clientX - b.left, ev.clientY - b.top]; };
  over.addEventListener('pointermove', ev => { if (ev.pointerType !== 'mouse') return; const [x, y] = pt(ev); setHover(nearestAt(x, y, 10)); });
  over.addEventListener('pointerleave', () => setHover(-1));
  let down = null; // touch/pen: tap on pointerup if the finger hardly moved (a bigger move is the native scroll)
  over.addEventListener('pointerdown', ev => { if (ev.pointerType === 'mouse') { const [x, y] = pt(ev); const r = nearestAt(x, y, 10); setHover(r); if (r >= 0) select(r); } else down = { x: ev.clientX, y: ev.clientY, sy: window.scrollY }; });
  over.addEventListener('pointercancel', () => { down = null; });
  over.addEventListener('pointerup', ev => { if (!down || ev.pointerType === 'mouse') return; const moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y) + Math.abs(window.scrollY - down.sy); down = null;
    if (moved > TAP_SLOP) return; const [x, y] = pt(ev); const r = nearestAt(x, y, 18); setHover(r); if (r >= 0) select(r); });
  // scroll: move the viewport, redraw the visible part of the static layer once per frame, refresh the list (throttled)
  let scRaf = 0, lsT = 0;
  const onScroll = () => { if (scRaf) return; scRaf = requestAnimationFrame(() => { scRaf = 0; if (!L || !alive) return; L.sy = offset(); wrap.dataset.sy = String(Math.round(L.sy));
    const t = performance.now(); redrawBase(); perf.scroll.push(performance.now() - t); setHover(-1); kick(); clearTimeout(lsT); lsT = setTimeout(() => fillList(), 120); }); };
  window.addEventListener('scroll', onScroll, { passive: true });
  let rsT = 0; const onResize = () => { clearTimeout(rsT); rsT = setTimeout(() => { layout(); redrawBase(); fillList(true); kick(); }, 120); };
  window.addEventListener('resize', onResize);
  const onText = () => fillBox(); window.addEventListener('kjv-text-changed', onText);
  cleanup = () => { alive = false; cancelAnimationFrame(scRaf); window.removeEventListener('scroll', onScroll); clearTimeout(lsT); cancelAnimationFrame(drawRaf); cancelAnimationFrame(animRaf); window.removeEventListener('resize', onResize); window.removeEventListener('kjv-text-changed', onText); main.classList.remove('wide'); };
  window.__xref = { select: r => select(r), state: () => state, layout: () => L, perf: () => ({ ...perf, avg: perf.frames ? perf.total / perf.frames : 0 }),
    resetPerf: () => { perf.frames = perf.total = perf.max = 0; perf.scroll = []; }, nearest: (x, y, t) => nearestAt(x, y, t),
    scroller: () => scroller, fillList: () => fillList(true), hover: () => hover,
    maxScroll: () => L.CH - L.H,
    scrollTo: y => new Promise(res => { window.scrollTo(0, Math.round(content.getBoundingClientRect().top + window.scrollY - headerH() + y)); requestAnimationFrame(() => requestAnimationFrame(() => { fillList(); res(L.sy); })); }),
    setData: set => { state.set = set; state.status = 'ok'; state.from = 'test data'; wrap.dataset.total = String(set.total); fillInfo(); fillBox(); lastN = n(); index = null; wave = drawIn = fading = null; redrawBase(); fillList(true); kick(); },
    redrawBase: () => new Promise(res => redrawBase(n(), res)) };

  layout(); fillInfo(); fillBox(); setPlaying(state.playing);
  if (!state.set) { await reload(); const sel = devUrl && new URLSearchParams(location.search).get('sel'); if (sel != null && state.set) select(Number(sel)); } else { wrap.dataset.total = String(state.set.total); lastN = n(); redrawBase(); fillList(true); kick(); }
}
