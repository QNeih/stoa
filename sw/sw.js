// Service worker template; the build fills in the version and the file list.
// Offline-first: the app shell comes from the cache; a new build brings a new cache.
const CACHE = "stoa-__VERSION__";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// ignoreVary: module scripts are requested with an Origin header, the precache was filled without one,
// and a host that answers with "Vary: Origin" (vite preview does) would otherwise miss the cache offline.
const MATCH = { ignoreSearch: true, ignoreVary: true };

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    const shell = new URL("./", self.registration.scope).href;
    event.respondWith(caches.match(shell, MATCH).then((hit) => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.match(req, MATCH).then((hit) => hit || fetch(req)));
});
