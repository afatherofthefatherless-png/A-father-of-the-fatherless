const BUILD_ID = "8340d0a530d7b1a8";
const CACHE_NAME = 'armorer-app-' + BUILD_ID;
const BASE = new URL('./', self.location.href).pathname;
const SHELL = [{"url":"./404.html","revision":"154e26b28278f265b4c467c0c15e8b03c2e8eb475dd90c2f4dc375290d0026f5"},{"url":"./assets/apple-touch-icon-CQQjhgpb.png","revision":"664bfce7f0ebdebe25fb34c7ae21271f781b43a57dc6fa052bf2996549b09bab"},{"url":"./assets/favicon-H4dXnvmg.ico","revision":"9290a47ab9f08ffbcc125f97df00e5b924f2bf47459de107526e7a581b9f9d32"},{"url":"./assets/main-CCZkz1cL.js","revision":"4b002667bf8bdb3cc8581d90eb2bb3a7d1c90e29ac8fcd40ddc91b76f3c112bb"},{"url":"./assets/main-tKs-0MG0.css","revision":"02c1fea2ab31be6c066e3209d11a5f39fa481d534e087d4cff57228116ce502b"},{"url":"./assets/opendyslexic-latin-400-italic-sb4Uqald.woff2","revision":"eb6a1bacf7e7c87a08116af4cd00a82064fbe61647b9a0d4d70a339890268f88"},{"url":"./assets/opendyslexic-latin-400-normal-nUhe5EwG.woff2","revision":"f007004af3cda5d8076e57c943f8cc8d00a0da25988b1ae1048683d60e7cac1a"},{"url":"./assets/opendyslexic-latin-700-italic-DeGJE8Fr.woff2","revision":"a20d82c2a1a0a6ab74796529aca31bfbae93e3e58f5a7360cba854dd98a15214"},{"url":"./assets/opendyslexic-latin-700-normal-Bnmt45Ln.woff2","revision":"dd9fa9c7991113b0dddefe9506a30ad26b48e302b7a8fb91719a4726e8fde85b"},{"url":"./assets/search-worker-HDupR5PD.js","revision":"56b22f7d48c30c9ed2811773999b9b4304ad7cac286e0c79f74aab3448c36487"},{"url":"./icons/armorer-192.931166d3fe1f.png","revision":"931166d3fe1ffa193520cb3c7c36a28d50c3e7f91517f89a6563e08efe8ebd8c"},{"url":"./icons/armorer-512.3a7197573df3.png","revision":"3a7197573df382e4ef2fdc2b36c1810f8e80c6244cd1a5b89760443b1b6aba3e"},{"url":"./index.html","revision":"e960f08ad95196cad53c12d03deebe51bc03b856beb5bf4a20804bc48124d750"},{"url":"./site.webmanifest","revision":"e163f0ad61fa2fdc5332a52972f93667528cfa5713b0f74892beb3c2bd852abd"},{"url":"./assets/reading-progress.js","revision":"397268559de62f94809245db8b982749ce10bb83e5f47921734d2b6090c9ffd7"}];
const STATE_KEY = new URL('./__armorer_state__', self.registration.scope).href;
const INDEX_URL = new URL('./index.html', self.registration.scope).href;
const ROLLBACK_DELAY = 30_000;

function versionedRequest(entry) {
  const url = new URL(entry.url, self.registration.scope);
  url.searchParams.set('__armorer_revision', entry.revision);
  return new Request(url.href);
}

async function responseMatchesRevision(response, revision) {
  const digest = await crypto.subtle.digest('SHA-256', await response.clone().arrayBuffer());
  const actual = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return actual === revision;
}

async function readState(cacheName = CACHE_NAME) {
  const response = await (await caches.open(cacheName)).match(STATE_KEY);
  if (!response) return undefined;
  try { return await response.json(); } catch (error) { return undefined; }
}

async function writeState(state) {
  await (await caches.open(CACHE_NAME)).put(STATE_KEY, new Response(JSON.stringify(state), {
    headers: { 'content-type': 'application/json' }
  }));
}

async function fallbackCacheName() {
  const names = (await caches.keys()).filter((name) => name.startsWith('armorer-app-') && name !== CACHE_NAME);
  const candidates = [];
  for (const name of names) candidates.push({ name, state: await readState(name) });
  const preferred = candidates.filter(({ state }) => !state || state.status === 'healthy');
  return (preferred.at(-1) || candidates.filter(({ state }) => state?.status !== 'rollback').at(-1))?.name;
}

async function cachedIndex(cacheName) {
  return (await caches.open(cacheName)).match(INDEX_URL, { ignoreSearch: true, ignoreVary: true });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const responses = await Promise.all(SHELL.map(async (entry) => {
      const cacheKey = versionedRequest(entry);
      const existing = await caches.match(cacheKey, { ignoreVary: true });
      if (existing && await responseMatchesRevision(existing, entry.revision)) return [cacheKey, existing];
      const response = await fetch(new URL(entry.url, self.registration.scope), { cache: 'reload' });
      if (!response.ok) throw new Error('Failed to cache ' + entry.url);
      if (!await responseMatchesRevision(response, entry.revision)) throw new Error('Invalid shell checksum for ' + entry.url);
      return [cacheKey, response];
    }));
    await Promise.all(responses.map(([cacheKey, response]) => cache.put(cacheKey, response)));
    if (!await readState()) await writeState({ status: 'candidate', attempts: 0, attemptedAt: 0 });
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'APP_HEALTHY' || event.data.buildId !== BUILD_ID) return;
  event.waitUntil((async () => {
    await writeState({ status: 'healthy', attempts: 1, attemptedAt: Date.now() });
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('armorer-app-') && key !== CACHE_NAME).map((key) => caches.delete(key)));
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;
  if (url.pathname === BASE + 'tracker' || url.pathname.startsWith(BASE + 'tracker/')) return;

  const pointerPath = BASE + 'data/translation.json';
  if (url.pathname === pointerPath) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      try {
        const response = await fetch(event.request);
        if (response.ok) {
          await cache.delete(event.request, { ignoreSearch: true, ignoreVary: true });
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        return (await cache.match(event.request, { ignoreSearch: true, ignoreVary: true })) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith(BASE + 'data/chapters/') || url.pathname.startsWith(BASE + 'data/search/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const state = await readState() || { status: 'candidate', attempts: 0, attemptedAt: 0 };
      const fallback = await fallbackCacheName();
      if (fallback && state.status === 'rollback') return (await cachedIndex(fallback)) || Response.error();
      if (fallback && state.status !== 'healthy') {
        if (state.attempts > 0 && Date.now() - state.attemptedAt >= ROLLBACK_DELAY) {
          await writeState({ ...state, status: 'rollback' });
          return (await cachedIndex(fallback)) || Response.error();
        }
        if (state.attempts === 0) await writeState({ ...state, attempts: 1, attemptedAt: Date.now() });
      }
      return (await cachedIndex(CACHE_NAME)) || Response.error();
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(event.request, { ignoreSearch: true, ignoreVary: true })) ||
      (await caches.match(event.request, { ignoreSearch: true, ignoreVary: true })) || fetch(event.request);
  })());
});
