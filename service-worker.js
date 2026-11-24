const CACHE_PREFIX = "mae-sampling-certificate-shell-";
// The Pages workflow replaces this token with the deployment commit SHA.
const CACHE_NAME = CACHE_PREFIX + "__CACHE_VERSION__";
const SHELL_ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];
const SCOPE_URL = new URL(self.registration.scope);
const SHELL_PATHS = new Set(
  SHELL_ASSETS.map((asset) => new URL(asset, SCOPE_URL).pathname)
);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(SHELL_ASSETS.map((asset) => new URL(asset, SCOPE_URL)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const requestUrl = new URL(request.url);
  if (requestUrl.origin !== SCOPE_URL.origin || !requestUrl.pathname.startsWith(SCOPE_URL.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      return await cache.match(new URL("./index.html", SCOPE_URL)) || Response.error();
    }));
    return;
  }

  if (SHELL_PATHS.has(requestUrl.pathname)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) =>
      await cache.match(request) || fetch(request)
    ));
  }
});
