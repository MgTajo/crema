"use strict";
/* ============================================================
   ui/shell — the part of Crema that only exists inside the app.

   Everything here is a no-op in a browser. `startShell()` returns on its
   first line, `onDeepLink()` registers a callback nothing will ever
   call, and no plugin is touched. That is the acceptance criterion the
   whole of step 4.1 is held to: people are using crema-app.com right
   now, and the native work is not allowed to move it.

   WHAT "NATIVE TAB BAR" MEANS HERE, since the plan's word for it invites
   the wrong picture. It is NOT a UIKit UITabBar hosting a WebView. That
   design — native chrome around web content — is the one Apple's own
   reviewers treat with most suspicion, it forces every route change
   through a bridge round trip, and it would fork ui/views.js's
   renderTabbar() into two implementations that have to be kept in step
   by hand. Crema's tab bar is already the right shape: it is pinned, it
   is one screen tall, it reads env(safe-area-inset-bottom), and
   ui/viewport.js keeps --app-h honest across resumes. What it lacks is
   everything AROUND it, and that is what this file supplies:

     · a status bar that is the app's colour and follows the theme,
       rather than a white strip with black text over a dark feed;
     · a splash that is dismissed when the app has actually PAINTED, not
       on a timer — the difference between "fast" and "flashes white";
     · the Android hardware back button, wired to the overlay stack so
       it closes a sheet instead of leaving the app;
     · haptics on the tab bar and the compose button, which is the
       single cheapest thing that makes a WebView feel like an app;
     · the keyboard's own accessory bar turned off, and the resize mode
       that keeps window.innerHeight truthful — which is what --app-h is
       measured from.

   The one thing genuinely native in the layout sense is the INSET, and
   the app already handles it. So the honest summary for the plan: the
   tab bar did not need porting, it needed a shell around it.
   ============================================================ */
import { native, isIOSNative, isAndroidNative, plugin, call, haptic } from '../core/native.js';
import { t } from '../i18n.js';
import { completeOAuthCode } from '../data/supabase.js';

/* ---------- deep links ---------- */
/* app.js owns what a hash MEANS; this module only owns how one arrives.
   A list rather than a single callback so nothing here has to know how
   many listeners there are, and a queue so a link that arrives before
   app.js has registered is not lost — which is the cold-start case: iOS
   delivers appUrlOpen while the WebView is still evaluating modules. */
const linkFns = [];
const pending = [];

export function onDeepLink(fn){
  linkFns.push(fn);
  while(pending.length) fn(pending.shift());
  return () => { const i = linkFns.indexOf(fn); if(i >= 0) linkFns.splice(i, 1); };
}

/* Everything after the '#', or '' — the shape openFromHash() expects.

   Three URL forms reach us and all three have to end in the same place:

     https://crema-app.com/#p/<id>   a Universal Link / App Link
     crema://p/<id>                  the custom scheme, used by pushes
     capacitor://crema-app.com/#p/…  an in-bundle link that escaped

   The custom scheme has no fragment — the path IS the route — so it is
   rewritten into one rather than parsed separately. openFromHash() then
   stays the single place that decides what a route means. */
function hashOf(url){
  const u = String(url || '');
  const cut = u.indexOf('#');
  if(cut >= 0) return u.slice(cut);
  const m = /^crema:\/\/(.+)$/i.exec(u);
  return m ? '#' + m[1].replace(/^\/+/, '') : '';
}

/* The OAuth callback is a deep link that is NOT a route.

   crema://auth?code=… is the provider handing back an authorization
   code, and it must be redeemed rather than opened. Routing it through
   openFromHash() like the others would be nonsense — there is no screen
   called 'auth' — so it is intercepted here, before the route handlers
   are consulted, and the in-app browser is closed on the way.

   Returns true when the URL was the callback and has been dealt with. */
const authFns = [];
export function onAuthReturn(fn){ authFns.push(fn); }

function takeOAuth(url){
  const u = String(url || '');
  if(!/^crema:\/\/auth\b/i.test(u) && u.indexOf('code=') < 0) return false;
  let code = '', err = '';
  try{
    const q = new URLSearchParams(u.split('?')[1] || '');
    code = q.get('code') || '';
    err  = q.get('error_description') || q.get('error') || '';
  }catch(e){ return false; }
  if(!code && !err) return false;

  /* The sheet has served its purpose and the app is about to change
     underneath it. Closing it here rather than letting the user do it
     is the difference between "signed in" and "signed in, now dismiss
     this browser". */
  call('Browser', 'close');

  Promise.resolve(err ? err : completeOAuthCode(code))
    .then(message => { for(const fn of authFns) fn(message || null); });
  return true;
}

function deliver(url){
  if(takeOAuth(url)) return;
  const h = hashOf(url);
  if(!h) return;
  if(!linkFns.length){ pending.push(h); return; }
  for(const fn of linkFns) fn(h);
}

/* ---------- the status bar ---------- */
/* Crema's two themes are a warm cream and a near-black, and the status
   bar has to be told which one it is sitting on — a WebView does not
   work it out. Style names are inverted from what they look like:
   'DARK' means dark CONTENT (black glyphs), which is what a light
   background needs. Getting this backwards is invisible in a screenshot
   taken in the wrong theme, so it is written out here.

   The colour is only set on Android. iOS status bars are transparent
   over the app and take the page's own background, which is what
   viewport-fit=cover and the .appbar's safe-area padding already
   arrange. Setting a colour there would paint a bar the app has to
   draw under anyway. */
function paintStatusBar(){
  if(!native()) return;
  const dark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme
        && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  call('StatusBar', 'setStyle', { style: dark ? 'LIGHT' : 'DARK' });
  if(isAndroidNative()){
    call('StatusBar', 'setBackgroundColor', { color: dark ? '#17100B' : '#F7F1E7' });
    /* The app draws its own background under the bar (viewport-fit=cover
       plus the .appbar padding rule in styles.css), so the bar overlays
       rather than pushing the layout down. */
    call('StatusBar', 'setOverlaysWebView', { overlay: true });
  }
}

/* ---------- the Android back button ----------
   Android users expect back to unwind the app, and a WebView that has
   nothing left in history closes it instead — which, with a sheet open,
   reads as "the app crashed when I dismissed something".

   ui/history.js already keeps a spare history entry so the browser back
   button closes an overlay rather than leaving the page; the hardware
   button is the same intent arriving through a different door, so it is
   routed to the same place. history.back() rather than a direct popOv():
   that keeps ONE implementation of "what does back mean here", and
   ui/history.js is it.

   Only when there is genuinely nothing to unwind does the app exit, and
   that is the plugin's own default — `canGoBack` is what the runtime
   tells us, and it accounts for the spare entry. */
function wireBackButton(){
  if(!isAndroidNative()) return;
  const app = plugin('App');
  if(!app || typeof app.addListener !== 'function') return;
  app.addListener('backButton', ({ canGoBack }) => {
    if(canGoBack){ history.back(); return; }
    call('App', 'exitApp');
  });
}

/* ---------- haptics on the things that are buttons ----------
   Delegated, capture-phase, and deliberately dumb: it fires on the tab
   bar and the compose button and nothing else. Every control in the app
   would be a phone that buzzes continuously, which is worse than none.

   Capture phase so it lands even where a handler downstream calls
   stopPropagation — the tap happened either way. */
function wireHaptics(){
  if(!native()) return;
  document.addEventListener('click', e => {
    const el = e.target.closest('.tab, [data-action="open-create"]');
    if(el) haptic(el.classList.contains('plus') ? 'medium' : 'light');
  }, true);
}

/* ---------- the keyboard ----------
   `resize: native` is set in capacitor.config.json, which shrinks the
   WebView rather than sliding it — the same contract
   interactive-widget=resizes-content asks the browser for in
   index.html, and the one ui/viewport.js measures --app-h against.

   The accessory bar (iOS's grey "< > Done" strip) is turned off because
   Crema's inputs are single-line fields inside sheets that have their
   own visible buttons, so it is a second, uglier toolbar over the first.

   The listeners exist because a WKWebView does not always fire
   window.resize when the keyboard moves, and --app-h is measured from
   window.innerHeight. Rather than reimplement that measurement here, we
   just poke the events ui/viewport.js is already listening for. */
function wireKeyboard(){
  if(!native()) return;
  call('Keyboard', 'setAccessoryBarVisible', { isVisible: false });
  const kb = plugin('Keyboard');
  if(!kb || typeof kb.addListener !== 'function') return;
  const nudge = () => {
    window.dispatchEvent(new Event('resize'));
    /* Once more after the animation, for the same reason
       ui/viewport.js's remeasure() measures three times. */
    setTimeout(() => window.dispatchEvent(new Event('resize')), 320);
  };
  kb.addListener('keyboardDidShow', nudge);
  kb.addListener('keyboardDidHide', nudge);
}

/* ---------- resume ----------
   A phone app is backgrounded far more often than a tab is hidden, and
   coming back is when it must not look stale. The web already handles
   this through visibilitychange (ui/actions.js's refreshOnReturn, and
   the realtime reconnect in data/realtime.js). Android and iOS deliver
   it as appStateChange, so it is translated rather than duplicated —
   one refresh path, two doorbells. */
function wireResume(){
  if(!native()) return;
  const app = plugin('App');
  if(!app || typeof app.addListener !== 'function') return;
  app.addListener('appStateChange', ({ isActive }) => {
    if(!isActive) return;
    paintStatusBar();
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/* ---------- offline ----------
   Acceptance criterion 7: a real offline state, never a white screen or
   a browser error page. It has three layers and this is the middle one.

     · The app itself is in the binary, so losing the network does not
       stop Crema opening. That is most of the answer, and it is what
       `webDir` buys — see platform/capacitor/sync.mjs.
     · This strip, which says so. Without it a phone with no signal
       shows a feed that simply never updates and a compose button that
       appears to do nothing, which reads as a broken app rather than as
       a missing network.
     · platform/capacitor/offline.html, the floor: what the WebView
       shows if it could not load the app at all.

   Native only, and that is a deliberate limit rather than an oversight.
   On the web sw.js already serves the cached shell and the browser has
   its own offline vocabulary — a tab that goes quiet is a tab. Adding a
   banner there would change what people using crema-app.com right now
   see, which this step is not allowed to do. It is a good candidate for
   the web separately, on its own merits.

   `navigator.onLine` is famously weak — it reports the radio, not
   whether anything answers — so it is used only in the direction it is
   reliable in: false really does mean no network. True is not treated
   as proof of anything. */
function offlineBar(){
  if(!native()) return;
  const screen = document.querySelector('.screen');
  if(!screen) return;

  const el = document.createElement('div');
  el.className = 'offbar';
  el.id = 'offbar';
  el.innerHTML = `<b>${t('Offline')}</b> · ${t('Crema will catch up when you are back')}`;
  /* After the appbar so it sits under it in the flex column. */
  const appbar = screen.querySelector('#appbar');
  if(appbar && appbar.nextSibling) screen.insertBefore(el, appbar.nextSibling);
  else screen.appendChild(el);

  const paint = () => el.classList.toggle('show', navigator.onLine === false);
  window.addEventListener('online',  paint);
  window.addEventListener('offline', paint);
  paint();
}

/* ---------- boot ---------- */
let started = false;

export function startShell(){
  if(started || !native()) return;
  started = true;

  /* Links that arrive while the app runs, and the one that launched it.
     getLaunchUrl() is asked separately because a cold start's URL is not
     redelivered as an event — the app was not running to hear it. */
  const app = plugin('App');
  if(app && typeof app.addListener === 'function'){
    app.addListener('appUrlOpen', ({ url }) => deliver(url));
  }
  call('App', 'getLaunchUrl').then(r => { if(r.ok && r.value && r.value.url) deliver(r.value.url); });

  paintStatusBar();
  if(window.matchMedia){
    window.matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', paintStatusBar);
  }
  /* The in-app theme switch writes data-theme on <html>. */
  new MutationObserver(paintStatusBar)
    .observe(document.documentElement, { attributes:true, attributeFilter:['data-theme'] });

  wireBackButton();
  wireHaptics();
  offlineBar();
  wireKeyboard();
  wireResume();

  hideSplash();
}

/* The splash goes when there are pixels, not when a timer says so.
   `launchAutoHide: false` in capacitor.config.json is what makes this
   ours to decide; two rAFs is "the first paint has been committed". A
   cold start paints in 45 ms of local work since 2026-08-20
   (D-2026-08-20-01), so this is not a wait — it is the difference
   between the splash cutting to the app and cutting to white.

   ⚠️ AND A TIMEOUT BESIDE IT, which is not belt-and-braces padding but a
   fix for a real failure found while verifying this file.
   requestAnimationFrame does not fire at all while the page is hidden —
   not slowly, not eventually: zero callbacks, indefinitely. A phone can
   launch an app WITHOUT showing it, and a push that wakes Crema in the
   background is exactly that case. The rAF chain would then never run,
   `launchAutoHide: false` means nothing else hides the splash, and the
   user brings the app forward to a splash screen that never leaves.
   There is no recovery from inside the app; they would force-quit it.

   So: whichever comes first, and only once. 2.5 seconds is far longer
   than a paint and far shorter than a person's patience. */
function hideSplash(){
  let done = false;
  const go = () => {
    if(done) return;
    done = true;
    call('SplashScreen', 'hide', { fadeOutDuration: 180 });
  };
  requestAnimationFrame(() => requestAnimationFrame(go));
  setTimeout(go, 2500);
}

/* Exported for the same reason data/push.js exports its capability
   predicates: the UI sometimes needs to say something true about where
   it is running. */
export { native, isIOSNative, isAndroidNative };
