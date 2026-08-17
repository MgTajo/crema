/* Crema service worker
   - network-first for HTML and app code (so deploys are visible at once)
   - cache-first for artwork (images/icons — fixed names, never change)
   - everything precached below, so the app opens offline either way */
/* Bump on any deploy that must reach existing installs immediately: the
   browser reinstalls this worker only when this file's bytes change, and
   `activate` then purges every other cache. With code served
   network-first (below) a bump is no longer required for code changes —
   it is the lever for evicting a bad cache. */
const C = 'crema-v36';
const ASSETS = ['./manifest.webmanifest','./styles.css',
  './src/app.js','./src/config.js','./src/core/util.js','./src/i18n.js','./src/i18n.de.js',
  './src/data/assets.js','./src/data/catalog.js','./src/data/world.js',
  './src/data/supabase.js','./src/data/profiles.js','./src/data/remote.js','./src/data/posts.js',
  './src/data/social.js','./src/data/challenges.js','./src/data/notifications.js','./src/data/media.js',
  './src/data/push.js','./src/data/reactions.js','./src/data/realtime.js',
  './src/domain/art.js','./src/domain/scoring.js','./src/domain/streak.js','./src/domain/premium.js','./src/domain/framing.js',
  './src/store/persistence.js','./src/store/store.js','./src/store/live.js',
  './src/ui/icons.js','./src/ui/components.js','./src/ui/views.js','./src/ui/overlays.js','./src/ui/actions.js','./src/ui/gate.js','./src/ui/history.js','./src/ui/recap.js','./src/ui/viewport.js',
  './assets/l1.jpg','./assets/l2.jpg','./assets/l3.jpg','./assets/l4.jpg','./assets/l5.jpg',
  './assets/l6.jpg','./assets/l7.jpg','./assets/l8.jpg','./assets/l9.jpg',
  './assets/beans.jpg','./assets/esp.jpg','./assets/cold.jpg',
  './icon-192.png','./icon-512.png','./icon-monochrome.png'];

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

  // App code, as opposed to artwork. This distinction is the whole point:
  // cache-first on code meant a deploy was invisible until `C` changed,
  // because a service worker only reinstalls when sw.js itself differs.
  // Three deploys shipped behind a stale cache that way. Code is now
  // network-first — always current when online, cache when not — while
  // images and icons, which never change under a fixed name, stay
  // cache-first and instant.
  const isCode = /\.(?:js|mjs|css|webmanifest)$/.test(url.pathname);

  if (isHTML || isCode) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) { const cp = res.clone(); caches.open(C).then(c => c.put(e.request, cp)); }
          return res;
        })
        .catch(() => caches.match(e.request)
          .then(h => h || (isHTML ? caches.match('./index.html') : undefined)))
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

/* ============================================================
   Web Push (roadmap step 1.16)

   The push service wakes this worker with an encrypted payload the
   send-push function built. `userVisibleOnly:true` was promised at
   subscribe time, so every push MUST show a notification — a silent one
   costs the origin its push permission in Chrome. Hence the fallback
   text: a malformed payload still produces something visible.

   `tag` collapses repeats, so twelve likes overnight is one line in the
   shade rather than twelve. `renotify` lets the newest one buzz again.
   ============================================================ */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  const title = d.title || 'Crema';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || 'Something new in Crema',
    icon: './icon-192.png',
    /* Android masks `badge` to its alpha channel for the status-bar icon;
       icon-192 is opaque, which renders as a filled rectangle, so this
       needs a transparent silhouette instead. */
    badge: './icon-monochrome.png',
    tag: d.tag || 'crema',
    renotify: true,
    data: { url: d.url || './' }
  }));
});

/* Focus an open Crema instead of opening a second one, and route it to
   whatever the notification was about. A tab that is already on screen
   won't navigate itself, so the deep link is posted to the page too —
   app.js listens and pushes the overlay. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || './', self.location.href);
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin !== target.origin) continue;
      await c.focus();
      c.postMessage({ type: 'navigate', url: target.href });
      return;
    }
    await self.clients.openWindow(target.href);
  })());
});

/* The VAPID public key, the same value as VAPID_PUBLIC_KEY in
   src/config.js. Duplicated rather than imported because this worker is
   a classic script, not a module, and the one place that needs it —
   pushsubscriptionchange below — can fire with no page open to ask.

   If the two ever drift, the app repairs it rather than breaking: at
   subscribe time enablePush() (src/data/push.js) compares the live
   subscription's applicationServerKey against config.js and takes a
   fresh subscription when they differ. Change one, change both. */
const VAPID_PUBLIC_KEY = 'BG6-xot5uE9TXxaK4JkMntrlmbGCRO1SXZG6_zDWJ9J7I7vGQ60aorseelDTIEoJrOd6SAWwyABMOvgtDJCZZnk';
function vapidBytes(b64) {
  const pad = '='.repeat((4 - b64.length % 4) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/* A subscription can be rotated out from under us by the push service.
   The worker can't authenticate to PostgREST on its own (no session), so
   it re-subscribes and tells whichever page is open to store the new
   endpoint; if none is, the next boot's syncPush() catches it.

   It must not depend on `e.oldSubscription` to do that. The event is
   allowed to arrive with it null, and in Chrome — the engine behind both
   the web app and the Play build's Trusted Web Activity — that is the
   common case, not the rare one. Bailing there was silent and permanent:
   no subscription, no re-subscribe, and the reminders sheet drops back to
   "Remind me" as if the user had never turned anything on. The key we
   would have read off the old subscription is a constant we already know,
   so read it from there and always re-subscribe. */
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    /* The spec lets the browser hand us the replacement outright. Use it
       when it does — re-subscribing over the top would only churn the
       endpoint again. */
    let sub = e.newSubscription || null;
    if (!sub) {
      const key = (e.oldSubscription && e.oldSubscription.options
                   && e.oldSubscription.options.applicationServerKey)
                  || vapidBytes(VAPID_PUBLIC_KEY);
      sub = await self.registration.pushManager
        .subscribe({ userVisibleOnly: true, applicationServerKey: key }).catch(() => null);
    }
    if (!sub) return;
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    all.forEach(c => c.postMessage({ type: 'push-resubscribed' }));
  })());
});
