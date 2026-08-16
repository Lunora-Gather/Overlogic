// Overlogic offline shell. The build replaces __RELEASE__ so a new release
// gets a fresh cache while an already-open tab can finish on its old assets.
const CACHE_NAME = 'overlogic-__RELEASE__';
const APP_SHELL = ['./', './index.html', './style.css', './manifest.webmanifest', './icon.svg'];
// The build injects every runtime module/data URL here. The source fallback
// keeps the unbuilt development service worker valid.
const PRECACHE_URLS = /*__PRECACHE_URLS__*/APP_SHELL;

async function putCacheSafe(cache, request, response) {
  try { await cache.put(request, response); } catch { /* quota/private mode */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => cache.addAll(APP_SHELL)))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith('overlogic-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await putCacheSafe(cache, request, response.clone());
      return response;
    }
    return (await caches.match(request, { ignoreSearch: true })) || response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) || caches.match('./index.html');
  }
}

async function staleWhileRevalidate(request) {
  // Runtime imports carry the release query string while precache URLs do
  // not; ignoreSearch lets the complete build-time manifest serve them
  // offline without duplicating every query variant.
  const cached = await caches.match(request, { ignoreSearch: true });
  const refresh = fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => putCacheSafe(cache, request, response.clone()));
    return response;
  }).catch(() => cached);
  return cached || refresh;
}

async function versionedNetworkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await putCacheSafe(cache, request, response.clone());
      return response;
    }
    return (await caches.match(request, { ignoreSearch: true })) || response;
  } catch {
    return (await caches.match(request, { ignoreSearch: true })) || caches.match('./index.html');
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  const versioned = url.searchParams.has('v') || url.searchParams.has('release');
  event.respondWith(request.mode === 'navigate'
    ? networkFirst(request)
    : (versioned ? versionedNetworkFirst(request) : staleWhileRevalidate(request)));
});
