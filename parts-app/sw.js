// Offline support + "share to app" (Android share sheet → new part with the shared photos).
const VERSION = 'parts-app-v2';
const SHELL = [
  './', './index.html', './app.js', './manifest.webmanifest',
  './core/model.js', './core/drawing.js', './core/render.js', './core/cad.js', './core/ai.js', './core/email.js',
  './vendor/libs.js', './icons/icon-192.png',
];
const SHARE_CACHE = 'parts-app-share';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.searchParams.has('share')) {
    e.respondWith((async () => {
      const form = await req.formData();
      const files = form.getAll('images').filter((f) => f && f.type && f.type.startsWith('image/'));
      const cache = await caches.open(SHARE_CACHE);
      await Promise.all(files.map((f, i) => cache.put(`./shared/${Date.now()}-${i}`, new Response(f, { headers: { 'content-type': f.type } }))));
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network first (so updates arrive), falling back to the cache when offline.
  // The 23 MB CAD engine is cache-first: it never changes for a given version.
  const cacheFirst = url.pathname.endsWith('.wasm') || url.pathname.endsWith('/vendor/cad.js');
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    if (cacheFirst) {
      const hit = await cache.match(req);
      if (hit) return hit;
    }
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  })());
});
