"use strict";
/* ============================================================
   core/device — which phone is reading the web app, and whether to
   point it at the store.

   Two questions, both asked of a BROWSER TAB. Inside the Capacitor app
   native() is already true and there is nothing to offer somebody who
   is holding it; app.js checks that before it asks anything here.

   1. WHICH PHONE. Every Android browser still says "Android" in its user
      agent — Chrome's reduced UA keeps the platform token on purpose — and
      an iPhone still says iPhone. iPadOS is the one that lies: since 13 it
      reports a Mac, and the touch points are what give it away. That is
      the same test data/push.js uses for the Home Screen prompt, which
      now asks this function instead of keeping a second copy of it.

   2. WHETHER TO ASK AGAIN. An offer that has been SHOWN rests for a week,
      however it was closed — a sheet that comes back on every visit is a
      sheet people learn to swipe away without reading. Somebody who
      tapped through to Play rests for a month: they either installed the
      app, and this tab is a leftover, or they decided not to, and asking
      them weekly would be nagging.

   A browser with storage switched off reads "never asked" and so is asked
   on every open, which is the same trade core/announce.js makes and for
   the same reason: a dismissible sheet shown twice is the smaller failure
   than one that can never be shown at all.

   mobileOS() and playOfferDue() take everything as arguments, so
   core/device.test.mjs can run them in Node with no browser.
   ============================================================ */

/* The listing. The id is the Android applicationId, which is also the
   appId in platform/capacitor/capacitor.config.json — device.test.mjs
   reads that file and fails if the two ever disagree. */
export const PLAY_URL = 'https://play.google.com/store/apps/details?id=com.crema_app.android';

export function mobileOS(nav){
  const ua = (nav && nav.userAgent) || '';
  const platform = (nav && nav.platform) || '';
  const touch = (nav && nav.maxTouchPoints) || 0;
  const hints = nav && nav.userAgentData;
  if(/Android/i.test(ua) || (hints && /android/i.test(hints.platform || ''))) return 'android';
  if(/iPad|iPhone|iPod/.test(platform) || /iPad|iPhone|iPod/.test(ua)
     /* iPadOS 13+ reports as a Mac; the touch points give it away. */
     || (platform === 'MacIntel' && touch > 1)) return 'ios';
  return 'other';
}

const DAY = 864e5;
export const PLAY_REST = { shown: 7 * DAY, opened: 30 * DAY };

/* `last` is what notePlayOffer() wrote, or null. A clock that has been
   set backwards past the last offer is not a reason to stop asking for
   good, so a timestamp in the future counts as due. */
export function playOfferDue(last, now){
  if(!last || typeof last.at !== 'number' || !isFinite(last.at)) return true;
  if(now < last.at) return true;
  const rest = PLAY_REST[last.what] || PLAY_REST.shown;
  return now - last.at >= rest;
}

const KEY = 'crema.playOffer';

export function lastPlayOffer(){
  try{
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v && typeof v === 'object' ? v : null;
  }catch(e){ return null; }
}

export function notePlayOffer(what, now = Date.now()){
  try{ localStorage.setItem(KEY, JSON.stringify({ what, at: now })); }catch(e){ /* private mode, quota */ }
}
