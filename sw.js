// sw.js — Cachea todo lo necesario para que la app funcione 100% offline tras la primera visita.
const CACHE_VERSION = 'eventos-v7';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/db.js',
  './js/importers.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './vendor/xlsx.full.min.js',
  './vendor/pdf.min.mjs',
  './vendor/pdf.worker.min.mjs',
  './vendor/tesseract.min.js',
  './vendor/worker.min.js',
  './vendor/tesseract-core-simd-lstm.js',
  './vendor/tesseract-core-simd-lstm.wasm',
  './tessdata/spa.traineddata.gz'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(ASSETS.map(a => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// Cache-first para todo lo propio de la app; cualquier recurso nuevo se guarda al vuelo.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res && res.ok && event.request.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(cache => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});
