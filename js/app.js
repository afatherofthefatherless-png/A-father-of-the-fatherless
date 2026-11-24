/* Biblia Dyslexia homepage test app. Path base is the GitHub Pages folder. */
const BASE = '/A-father-of-the-fatherless';
const VOTD_START = { y: 2026, m: 11, d: 24 };
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
  box.querySelector('.votd-text').textContent = `\u201c${entry.text}\u201d`;
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

function chapterHeading(book, chapter) {
  const bookHref = withBase(`/${book.slug}/`);
  const chHref = withBase(`/${book.slug}/${chapter}/`);
  return `<h2 class="chapter-heading"><a href="${bookHref}">${escapeHtml(book.name)}</a><span aria-hidden="true"> ⟫ </span><a href="${chHref}">Chapter ${chapter}</a></h2>`;
}

function verseHtml(chapter, verse) {
  const id = `v${chapter}-${verse.n}`;
  const title = verse.title
    ? `<p class="psalm-title">${escapeHtml(verse.title)}</p>`
    : '';
  const text = verse.title ? verse.body : verse.text;
  return `${title}<p class="verse" id="${id}"><span class="verse-number">${verse.n}</span><span class="verse-text">${escapeHtml(text)}</span></p>`;
}

function chapterSection(book, chapter) {
  const ch = book.chapters[chapter - 1];
  if (!ch) return '';
  const verses = ch.verses.map((v) => verseHtml(chapter, v)).join('');
  return `<section class="chapter" data-chapter="${chapter}" id="${book.slug}-${chapter}">${chapterHeading(book, chapter)}<article>${verses}</article></section>`;
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
    const books = await loadBooksIndex();
    const hit = parseReference(input.value, books);
    if (!hit) {
      input.setCustomValidity('Type a place, for example John 3:16');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    const hash = hit.verse ? `#${hit.verse}` : '';
    location.href = withBase(`/${hit.slug}/${hit.chapter}/${hash}`);
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

async function start() {
  if (redirectLegacyHash()) return;
  bindStudy();
  bindSearch();
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
  try {
    await fillVerseOfTheDay();
  } catch (err) {
    console.warn(err);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
