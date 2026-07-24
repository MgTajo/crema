/* Crema service worker
   - network-first for HTML (so page updates always show when online)
   - cache-first for static assets (images/icons) */
const C = 'crema-v2';
const ASSETS = ['./manifest.webmanifest',
  './assets/l1.jpg','./assets/l2.jpg','./assets/l3.jpg','./assets/l4.jpg','./assets/l5.jpg',
  './assets/l6.jpg','./assets/l7.jpg','./assets/l8.jpg','./assets/l9.jpg',
  './assets/beans.jpg','./assets/esp.jpg','./assets/cold.jpg',
  './icon-192.png','./icon-512.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(C).then(c => c.addAll(ASSETS)).catch(() => {}));
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

  const isHTML = e.request.mode === 'navigate'
    || url.pathname.endsWith('/') || url.pathname.endsWith('.html');

  if (isHTML) {
    // network-first: always try the latest page, fall back to cache offline
    e.respondWith(
      fetch(e.request)
        .then(res => { const cp = res.clone(); caches.open(C).then(c => c.put(e.request, cp)); return res; })
        .catch(() => caches.match(e.request).then(h => h || caches.match('./index.html')))
    );
  } else {
    // cache-first for static assets
    e.respondWith(
      caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
        return res;
      }).catch(() => undefined))
    );
  }
});
