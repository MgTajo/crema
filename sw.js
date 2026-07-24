/* Crema service worker — cache-first for same-origin assets */
const C = 'crema-v1';
const CORE = ['./', './index.html', './manifest.webmanifest',
  './assets/l1.jpg','./assets/l2.jpg','./assets/l3.jpg','./assets/l4.jpg','./assets/l5.jpg',
  './assets/l6.jpg','./assets/l7.jpg','./assets/l8.jpg','./assets/l9.jpg',
  './assets/beans.jpg','./assets/esp.jpg','./assets/cold.jpg',
  './icon-192.png','./icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(CORE)).catch(() => {}));
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // never intercept cross-origin
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
