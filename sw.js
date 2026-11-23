// The build embeds the release and the integrity of each precached asset.
const RELEASE = '__RELEASE__';
const CACHE_PREFIX = `overlogic-${self.registration.scope}-`;
const CACHE_NAME = CACHE_PREFIX + RELEASE;
const APP_SHELL = ['./index.html'];
const PRECACHE_URLS = /*__PRECACHE_URLS__*/APP_SHELL;
const PRECACHE_INTEGRITY = /*__PRECACHE_INTEGRITY__*/{};
const shell = new URL('./index.html', self.registration.scope);
const root = new URL('./', self.registration.scope);
const assets = new Map(PRECACHE_URLS.map((path) => [new URL(path, root).pathname, path]));

function releaseRequest(path) {
  return new Request(new URL(path, root), {
    cache: 'reload',
    integrity: PRECACHE_INTEGRITY[path],
  });
}

self.addEventListener('install', (event) => {
  // A deployment changing mid-install will fail the integrity check and leave
  // the currently working release in control.
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(PRECACHE_URLS.map(releaseRequest)))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(activateRelease());
});

async function activateRelease() {
  const older = (await caches.keys()).filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
  const complete = await Promise.all(older.map(async (key) => (
    await caches.match(shell, { cacheName: key }) ? key : null
  )));
  // A failed install can leave an empty cache. Keep the last complete release.
  const previous = complete.filter(Boolean).at(-1);
  await Promise.all(older.filter((key) => key !== previous).map((key) => caches.delete(key)));
  await self.clients.claim();
}

async function releaseAsset(path, version) {
  const url = new URL(path, root);
  const cached = await caches.match(url, { cacheName: CACHE_PREFIX + version });
  if (cached) return cached;
  if (version === RELEASE) {
    try {
      const response = await fetch(releaseRequest(path));
      if (response.ok) return response;
    } catch {
      // An evicted resource may only be recovered from the same release.
    }
  }
  return new Response('Release resource unavailable', { status: 503 });
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== root.origin) return;

  if (request.mode === 'navigate' && (url.pathname === root.pathname || url.pathname === shell.pathname)) {
    event.respondWith(releaseAsset('./index.html', RELEASE));
    return;
  }
  if (request.mode === 'navigate') return;
  const requestedVersion = url.searchParams.get('v') ?? url.searchParams.get('release');
  const version = requestedVersion ?? RELEASE;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(version)) return;
  const path = assets.get(url.pathname) ??
    (requestedVersion && version !== RELEASE && url.pathname.startsWith(root.pathname)
      ? './' + url.pathname.slice(root.pathname.length) : null);
  if (path) event.respondWith(releaseAsset(path, version));
});
