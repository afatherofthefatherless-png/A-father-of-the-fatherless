/* Biblia Dyslexia homepage test app. Path base is the GitHub Pages folder. */
import { loadRedLetter, colorizeHtml, verseIdFromPath, verseIdFromTitle } from './red-letter.js';
const BASE = '/A-father-of-the-fatherless';
const VOTD_START = { y: 2026, m: 1, d: 1 }; // same date rule as the daily verse email
const SV = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';

const bookCache = new Map();
let booksIndex = null;

function withBase(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${p}`;
}

function londonDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return { y: +get('year'), m: +get('month'), d: +get('day') };
}

function dayNumber(date) {
  const start = Date.UTC(VOTD_START.y, VOTD_START.m - 1, VOTD_START.d);
  const cur = Date.UTC(date.y, date.m - 1, date.d);
  return Math.floor((cur - start) / 86400000) + 1;
}

function votdIndex(n, total) {
  return ((n - 1) % total + total) % total;
}

async function loadBooksIndex() {
  if (!booksIndex) {
    const res = await fetch(withBase('/data/books.json'));
    if (!res.ok) throw new Error('Could not load the book list');
    booksIndex = await res.json();
  }
  return booksIndex;
}

async function loadBook(slug) {
  if (!bookCache.has(slug)) {
    bookCache.set(slug, fetch(withBase(`/data/books/${slug}.json`)).then((res) => {
      if (!res.ok) throw new Error('Could not load this book');
      return res.json();
    }));
  }
  return bookCache.get(slug);
}

async function fillVerseOfTheDay() {
  const box = document.querySelector('a.votd');
  if (!box) return;
  const res = await fetch(withBase('/data/votd.json'));
  if (!res.ok) return;
  const list = await res.json();
  const n = dayNumber(londonDate());
  const entry = list[votdIndex(n, list.length)];
  if (!entry) return;
  box.href = withBase(`/${entry.slug}/${entry.chapter}/#${entry.verse_start}`);
  const votdText = box.querySelector('.votd-text');
  const quoted = colorizeHtml(entry.text, entry.id);
  votdText.innerHTML = `\u201c${quoted}\u201d`;
  box.querySelector('.votd-ref').textContent = entry.reference;
}

function openStudy() {
  const panel = document.getElementById('more');
  if (!panel) return;
  panel.hidden = false;
  document.body.classList.add('more');
  const close = panel.querySelector('.more-btn, [data-close-study]');
  close?.focus();
}

function closeStudy() {
  const panel = document.getElementById('more');
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  document.body.classList.remove('more');
  document.querySelector('.home-header .more-btn')?.focus();
}

function bindStudy() {
  const openBtn = document.querySelector('.home-header .more-btn[aria-controls="more"]');
  const panel = document.getElementById('more');
  if (!openBtn || !panel) return;
  openBtn.addEventListener('click', openStudy);
  panel.querySelector('.more-btn')?.addEventListener('click', closeStudy);
  panel.querySelector('li.back a')?.addEventListener('click', (ev) => {
    ev.preventDefault();
    closeStudy();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !panel.hidden) {
      ev.preventDefault();
      closeStudy();
    }
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function rangesOverlap(a, b) {
  return a.compareBoundaryPoints(Range.END_TO_START, b) < 0 && a.compareBoundaryPoints(Range.START_TO_END, b) > 0;
}

function selectedTextInNode(range, node) {
  const contents = document.createRange();
  contents.selectNodeContents(node);
  if (!rangesOverlap(range, contents)) return '';
  const clipped = document.createRange();
  if (range.compareBoundaryPoints(Range.START_TO_START, contents) <= 0) clipped.setStart(contents.startContainer, contents.startOffset);
  else clipped.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, contents) >= 0) clipped.setEnd(contents.endContainer, contents.endOffset);
  else clipped.setEnd(range.endContainer, range.endOffset);
  return clipped.cloneContents().textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function versesFromSelection(selection) {
  const verses = [...document.querySelectorAll('[data-scripture] .verse')];
  const picked = [];
  for (const verseEl of verses) {
    const textEl = verseEl.querySelector('.verse-text');
    if (!textEl) continue;
    const bits = [];
    for (let i = 0; i < selection.rangeCount; i += 1) {
      const bit = selectedTextInNode(selection.getRangeAt(i), textEl);
      if (bit) bits.push(bit);
    }
    if (!bits.length) continue;
    const chapterEl = verseEl.closest('[data-chapter-path]');
    if (chapterEl) {
      picked.push({
        text: bits.join(' '),
        book: chapterEl.dataset.book,
        bookSlug: chapterEl.dataset.bookSlug,
        chapter: Number(chapterEl.dataset.chapter),
        verse: Number(verseEl.dataset.verse),
        chapterPath: chapterEl.dataset.chapterPath
      });
    }
  }
  return picked;
}

const SUPER_DIGITS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹'];
function toSuper(value) {
  return String(value).replace(/[0-9]/g, (d) => SUPER_DIGITS[Number(d)]);
}

function escapeCopyHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function formatCopyReference(verses) {
  const first = verses[0];
  const last = verses[verses.length - 1];
  let ref;
  if (first.chapter === last.chapter) {
    ref = first.verse === last.verse
      ? `${first.book} ${first.chapter}:${first.verse}`
      : `${first.book} ${first.chapter}:${first.verse}-${last.verse}`;
  } else {
    ref = `${first.book} ${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
  }
  return `${ref} King James Bible`;
}

function formatCopy(verses) {
  if (!verses.length) return { plain: '', html: '' };
  const groups = [];
  for (const verse of verses) {
    const group = groups[groups.length - 1];
    if (!group || group[0].bookSlug !== verse.bookSlug) groups.push([verse]);
    else group.push(verse);
  }
  const plain = groups.map((group) => `“${group.map((v) => `${toSuper(v.verse)}${v.text}`).join(' ')}”\n\n${formatCopyReference(group)}`);
  const html = groups.map((group) => `“${group.map((v) => `<sup><b>${v.verse}</b></sup>${escapeCopyHtml(v.text)}`).join(' ')}”<br><br>${escapeCopyHtml(formatCopyReference(group))}`);
  return { plain: plain.join('\n'), html: html.join('<br>') };
}

function bindCopy() {
  document.addEventListener('copy', (event) => {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const ancestor = selection.getRangeAt(0).commonAncestorContainer;
    const inScripture = (ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentElement)?.closest('[data-scripture]')
      || (selection.anchorNode?.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement?.closest('[data-scripture]')
        : selection.anchorNode?.closest?.('[data-scripture]'));
    if (!inScripture) return;
    const payload = formatCopy(versesFromSelection(selection));
    if (payload.plain) {
      event.clipboardData?.setData('text/plain', payload.plain);
      event.clipboardData?.setData('text/html', payload.html);
      event.preventDefault();
    }
  });
}

function chapterHeading(book, chapter) {
  const bookHref = withBase(`/${book.slug}/`);
  const chHref = withBase(`/${book.slug}/${chapter}/`);
  return `<h2 class="chapter-heading"><a href="${bookHref}">${escapeHtml(book.name)}</a><span aria-hidden="true"> ⟫ </span><a href="${chHref}">Chapter ${chapter}</a></h2>`;
}

function verseId(book, chapter, verse) {
  const code = book.code || book.book || '';
  return code ? `${code}.${chapter}.${verse}` : '';
}

function verseHtml(book, chapter, verse) {
  const id = `v${chapter}-${verse.n}`;
  const title = verse.title
    ? `<p class="psalm-title">${escapeHtml(verse.title)}</p>`
    : '';
  const text = verse.title ? verse.body : verse.text;
  const html = verse.title ? escapeHtml(text) : colorizeHtml(text, verseId(book, chapter, verse.n));
  return `${title}<p class="verse" id="${id}" data-verse="${verse.n}"><span class="verse-number">${verse.n}</span><span class="verse-text">${html}</span></p>`;
}

function chapterSection(book, chapter) {
  const ch = book.chapters[chapter - 1];
  if (!ch) return '';
  const verses = ch.verses.map((v) => verseHtml(book, chapter, v)).join('');
  return `<section class="chapter" data-chapter="${chapter}" data-chapter-path="${escapeHtml(book.slug)}/${chapter}" data-book="${escapeHtml(book.name)}" data-book-slug="${escapeHtml(book.slug)}" id="${book.slug}-${chapter}">${chapterHeading(book, chapter)}<article>${verses}</article></section>`;
}

function scrollToVerse(chapter, verse) {
  const el = document.getElementById(`v${chapter}-${verse}`);
  if (!el) return;
  el.classList.add('verse-focused');
  const heading = el.closest('.chapter')?.querySelector('.chapter-heading');
  const offset = (heading ? heading.getBoundingClientRect().height : 0) + 12;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  const scroller = document.querySelector('.reader');
  if (scroller) scroller.scrollTo({ top: el.offsetTop - offset, behavior: 'auto' });
  else window.scrollTo({ top, behavior: 'auto' });
}

async function mountReader(root, slug, startChapter, startVerse) {
  const book = await loadBook(slug);
  const total = book.chapters.length;
  let from = startChapter;
  let to = Math.min(total, startChapter + 1);
  root.setAttribute('data-scripture', '');
  root.innerHTML = '';
  for (let ch = from; ch <= to; ch += 1) root.insertAdjacentHTML('beforeend', chapterSection(book, ch));
  if (startVerse) {
    requestAnimationFrame(() => scrollToVerse(startChapter, startVerse));
  } else {
    root.scrollTop = 0;
  }

  const maybeLoad = () => {
    const last = root.querySelector('.chapter:last-child');
    if (!last) return;
    const lastCh = Number(last.dataset.chapter);
    if (lastCh >= total) return;
    const remain = last.getBoundingClientRect().bottom - root.getBoundingClientRect().bottom;
    if (remain < 1200) {
      to = lastCh + 1;
      root.insertAdjacentHTML('beforeend', chapterSection(book, to));
    }
  };
  root.addEventListener('scroll', maybeLoad, { passive: true });
  maybeLoad();
}

function namesFor(book) {
  const list = [book.name, book.slug.replace(/-/g, ' '), ...(book.aliases || [])];
  return [...new Set(list.map((s) => s.toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ').trim()))]
    .sort((a, b) => b.length - a.length);
}

function parseReference(query, books) {
  const normalized = query.toLowerCase().replace(/[.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  for (const book of books) {
    for (const name of namesFor(book)) {
      if (normalized === name) return { slug: book.slug, chapter: 1 };
      if (!(normalized.startsWith(name) && /^\s*\d/.test(normalized.slice(name.length)))) continue;
      const rest = normalized.slice(name.length).trim();
      const match = rest.match(/^(\d+)(?::(\d+)(?:-(?:(\d+):)?(\d+))?)?$/);
      if (!match) continue;
      const chapter = Number(match[1]);
      const verse = match[2] ? Number(match[2]) : undefined;
      if (chapter < 1 || chapter > book.chapters) continue;
      return { slug: book.slug, chapter, verse };
    }
  }
  return null;
}

function bindSearch() {
  const form = document.querySelector('.search-box');
  const input = form?.querySelector('input[type="search"]');
  if (!form || !input) return;
  const go = async (ev) => {
    ev?.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.setCustomValidity('');
    const books = await loadBooksIndex();
    const hit = parseReference(q, books);
    if (hit) {
      const hash = hit.verse ? `#${hit.verse}` : '';
      location.href = withBase(`/${hit.slug}/${hit.chapter}/${hash}`);
      return;
    }
    location.href = `${BASE}/?q=${encodeURIComponent(q)}`;
  };
  input.form?.addEventListener('submit', go);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') go(ev);
  });
  const filter = form.querySelector('.book-filter');
  const reader = document.querySelector('.reader[data-book]');
  filter?.addEventListener('click', () => {
    const slug = reader?.dataset.book;
    const book = (booksIndex || []).find((b) => b.slug === slug);
    if (book) {
      input.value = `${book.name} `;
      input.focus();
    } else {
      input.focus();
    }
  });
}

function parsePath() {
  const raw = location.pathname.replace(/\/+$/, '') || '/';
  const prefix = BASE.replace(/\/+$/, '');
  let rest = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw;
  rest = rest.replace(/^\/+|\/+$/g, '');
  const parts = rest ? rest.split('/') : [];
  const hashVerse = location.hash.replace(/^#/, '');
  const verse = /^\d+$/.test(hashVerse) ? Number(hashVerse) : undefined;
  return { parts, verse };
}

function isToolHash(hash) {
  return /^(#\/(?:home|record|stitch|xref))(?:\?.*)?$/i.test(hash || '');
}

function scriptureHash(hash) {
  const match = (hash || '').match(/^#\/([A-Za-z0-9][A-Za-z0-9-]*)(?:\/(\d+)(?:\/(\d+))?)?\/?$/);
  if (!match) return null;
  const slug = match[1].toLowerCase();
  if (['home', 'record', 'stitch', 'xref'].includes(slug)) return null;
  let dest = withBase(`/${slug}/`);
  if (match[2]) dest += `${match[2]}/`;
  if (match[3]) dest += `#${match[3]}`;
  return dest;
}

function redirectLegacyHash() {
  const hash = location.hash || '';
  if (isToolHash(hash)) {
    location.replace(`${BASE}/tools/${hash}`);
    return true;
  }
  const dest = scriptureHash(hash);
  if (dest) {
    location.replace(dest);
    return true;
  }
  return false;
}

const SEARCH_INDEX_URL = withBase('/data/search/index.e2de83c698e9ad70.json');
const SEARCH_HASH = 'e2de83c698e9ad70d92580c25ed7e1fe2767bb04feb270f61b14a54eac8e4884';
const SEARCH_WORKER_URL = withBase('/js/search-worker-HDupR5PD.js');
const SEARCH_PAGE_SIZE = 20;

let searchWorker;

function getSearchWorker() {
  if (!searchWorker) searchWorker = new Worker(SEARCH_WORKER_URL, { type: 'module' });
  return searchWorker;
}

function runSearch(query, start, count) {
  const worker = getSearchWorker();
  const key = Date.now() + Math.random();
  return new Promise((resolve, reject) => {
    const onMessage = (ev) => {
      if (ev.data?.key !== key) return;
      worker.removeEventListener('message', onMessage);
      if (ev.data.error) reject(new Error(ev.data.error));
      else resolve(ev.data);
    };
    worker.addEventListener('message', onMessage);
    worker.postMessage({
      query, start, count, key, searchHash: SEARCH_HASH, indexUrl: SEARCH_INDEX_URL
    });
  });
}

function searchQuery() {
  return new URLSearchParams(location.search).get('q') || '';
}

function searchPage() {
  const n = Number(new URLSearchParams(location.search).get('p'));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function searchSummary(query, occurrences, verses, books) {
  const term = query.trim();
  if (!term) return '';
  const times = occurrences === 1 ? '1 time' : `${occurrences} times`;
  const verseLabel = verses === 1 ? '1 verse' : `${verses} verses`;
  const bookLabel = books === 1 ? '1 book' : `${books} books`;
  return `\u2018${term}\u2019 occurs ${times} in ${verseLabel} in ${bookLabel}`;
}

function resultHref(path) {
  return withBase(path);
}

function pageHref(query, page) {
  const q = `${BASE}/?q=${encodeURIComponent(query)}`;
  return page > 1 ? `${q}&p=${page}` : q;
}

function paginationHtml(query, page, totalPages) {
  if (totalPages <= 1) return '';
  const from = Math.max(1, page - 2);
  const to = Math.min(totalPages, page + 2);
  let buttons = '';
  const btn = (n, label, disabled, current) => {
    if (disabled) return `<button type="button" disabled aria-label="${label}">${label}</button>`;
    const currentAttr = current ? ' aria-current="page"' : '';
    return `<a href="${pageHref(query, n)}"${currentAttr}>${label}</a>`;
  };
  buttons += btn(page - 1, '\u00ab', page <= 1, false);
  for (let n = from; n <= to; n += 1) buttons += btn(n, String(n), false, n === page);
  buttons += btn(page + 1, '\u00bb', page >= totalPages, false);
  return `<nav class="pagination" aria-label="Search results page">${buttons}</nav>`;
}

function renderResults(main, query, state) {
  const footer = '<footer class="home-foot"><span>A Father of the Fatherless Ministry</span></footer>';
  let body = '<h1 class="visually-hidden">Search</h1>';
  if (state.loading) {
    body += '<p class="search-status" role="status">Searching\u2026</p>';
  } else if (state.error) {
    body += `<p class="search-status">${escapeHtml(state.error)}</p>`;
  } else if (query.trim().length < 3) {
    body += '<p class="search-status">Type at least three letters to search.</p>';
  } else if (!state.resultCount) {
    body += `<p class="search-summary">${escapeHtml(searchSummary(query, 0, 0, 0))}</p>`;
    body += '<p class="search-status">No results found</p>';
  } else {
    const totalPages = Math.ceil(state.resultCount / SEARCH_PAGE_SIZE);
    const items = (state.results || []).map((hit) => {
      const href = escapeHtml(resultHref(hit.path));
      const title = escapeHtml(hit.title || '');
      const raw = hit.content || ( /<[a-z]|<\//i.test(hit.html || '') ? '' : (hit.html || '') );
      const fromPath = verseIdFromPath(hit.path || '');
      const fromTitle = verseIdFromTitle(hit.title || '');
      let id = '';
      if (fromPath) {
        const book = (booksIndex || []).find((b) => b.slug === fromPath.slug);
        if (book) id = `${book.code}.${fromPath.chapter}.${fromPath.verse}`;
      } else if (fromTitle) {
        const name = fromTitle.name.toLowerCase();
        const book = (booksIndex || []).find((b) => b.name.toLowerCase() === name || b.slug === name.replace(/\s+/g, '-'));
        if (book) id = `${book.code}.${fromTitle.chapter}.${fromTitle.verse}`;
      }
      const html = raw ? colorizeHtml(raw, id) : ( /<[a-z]|<\//i.test(hit.html || '') ? hit.html : escapeHtml(hit.html || '') );
      return `<li><a href="${href}">${title}</a><p>${html}</p></li>`;
    }).join('');
    body += `<p class="search-summary" aria-live="polite">${escapeHtml(searchSummary(query, state.occurrenceCount, state.resultCount, state.bookCount))}</p>`;
    body += `<section class="search-results" aria-label="Search Results"><h2>Search Results</h2>`;
    body += paginationHtml(query, state.page, totalPages);
    body += `<ul class="result-list">${items}</ul>`;
    body += paginationHtml(query, state.page, totalPages);
    body += '</section>';
  }
  main.classList.add('search-page');
  main.innerHTML = body + footer;
}

async function showSearchResults(query) {
  const main = document.querySelector('main.home-main');
  if (!main) return;
  const input = document.querySelector('.home-header input[type="search"]');
  if (input && !input.value) input.value = query;
  const books = await loadBooksIndex();
  const hit = parseReference(query, books);
  if (hit) {
    const hash = hit.verse ? `#${hit.verse}` : '';
    location.replace(withBase(`/${hit.slug}/${hit.chapter}/${hash}`));
    return;
  }
  const page = searchPage();
  renderResults(main, query, { loading: true, page });
  if (query.trim().length < 3) {
    renderResults(main, query, { loading: false, page, resultCount: 0, results: [] });
    return;
  }
  try {
    const data = await runSearch(query, (page - 1) * SEARCH_PAGE_SIZE, SEARCH_PAGE_SIZE);
    renderResults(main, query, {
      loading: false,
      page,
      results: data.results || [],
      resultCount: data.resultCount || 0,
      occurrenceCount: data.occurrenceCount || 0,
      bookCount: data.bookCount || 0
    });
  } catch (err) {
    renderResults(main, query, { loading: false, page, error: err.message || 'Search could not be completed.' });
  }
}

async function start() {
  if (redirectLegacyHash()) return;
  await loadRedLetter();
  bindStudy();
  bindSearch();
  bindCopy();
  const root = document.querySelector('.reader[data-book]');
  if (root) {
    const slug = root.dataset.book;
    const chapter = Number(root.dataset.chapter);
    const { verse } = parsePath();
    try {
      await mountReader(root, slug, chapter, verse);
    } catch (err) {
      root.innerHTML = `<p class="reader-error">${escapeHtml(err.message || 'Could not open this chapter.')}</p>`;
    }
    return;
  }
  const query = searchQuery();
  const { parts } = parsePath();
  if (query && parts.length === 0) {
    try {
      await showSearchResults(query);
    } catch (err) {
      console.warn(err);
    }
    return;
  }
  try {
    await fillVerseOfTheDay();
  } catch (err) {
    console.warn(err);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
