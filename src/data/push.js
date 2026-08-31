"use strict";
/* ============================================================
   data/push — Web Push subscriptions.

   The browser holds the subscription (an endpoint URL at the vendor's
   push service, plus two keys); we store a copy per device in
   `push_subscriptions` so the server can reach it later. The row is
   owner-only under RLS, and the endpoint is the primary key so the same
   device re-subscribing updates rather than duplicates.

   WHERE THIS WORKS — the part worth knowing before designing around it:

     · Chrome / Edge / Firefox, desktop and Android: in an ordinary
       browser tab. No install, no store.
     · Safari on macOS 16.4+: in an ordinary tab too.
     · Safari on iOS / iPadOS 16.4+: ONLY once the site has been added
       to the Home Screen. Apple ships no Web Push in a Safari tab, and
       there is no flag or workaround — the PushManager simply isn't
       there. This is why iosNeedsInstall() exists and why the streak
       sheet asks iPhone users to add Crema to their Home Screen.
     · Anything older, or a browser with notifications denied: nothing.

   So push is a bonus channel, never the only one. Every nudge it
   carries is also visible in the app (the streak block on Home, the
   notification inbox), because a meaningful share of the audience is
   on an iPhone in a Safari tab and will never get a single push.
   ============================================================ */
import { VAPID_PUBLIC_KEY, NATIVE_PUSH_PLATFORMS } from '../config.js';
import { rest } from './supabase.js';
import { lang } from '../i18n.js';
import { native, platform, plugin, call } from '../core/native.js';

/* ============================================================
   THE NATIVE HALF — step 4.1.

   Everything above this line and below the native block is Web Push and
   is unchanged. In a browser `native()` is false, none of the functions
   below are reached, and the module behaves exactly as it did.

   Inside the Capacitor shell the mechanism is different in every part:
   there is no service worker, no PushManager, no VAPID and no endpoint.
   The OS hands the app a device token — APNs on iOS, FCM on Android —
   and the app stores it. Same intent, same UI, same settings toggle;
   different plumbing underneath, which is exactly what the plan means
   by "replacing Web Push on native only".

   ⚠️ WHAT IS AND IS NOT WIRED UP, said plainly so nobody reads this as
   finished. The road is now complete except for one credential:

     · storing a token          — here, since step 4.1.
     · fanning a notification out to it — migration 20260831140000:
       `push_devices` unions native_push_tokens with push_subscriptions
       and all four senders read it.
     · delivering it            — functions/send-push/fcm.ts, FCM HTTP v1.
     · ANDROID ASKING FOR A TOKEN AT ALL — blocked. It needs
       google-services.json in the app module, and without it the
       register() call does not fail, it CLOSES THE APP (see
       nativePushReady() below). So NATIVE_PUSH_PLATFORMS is empty,
       nothing here asks, and the reminders block says so.
     · sending                  — needs FCM_SERVICE_ACCOUNT as an Edge
       Function secret. Without it send-push skips native rows.

   Both of those are step 4.2 and both are downloads from a Firebase
   project, which the plan lists under what an agent cannot do. iOS is
   further back still: the shell has never been compiled (Q19).

   The table this writes to (`native_push_tokens`, migration
   20260831090000) is deliberately separate from `push_subscriptions` so
   that Web Push — which is live, in production, for everyone on the web
   today — cannot be affected by any of this.
   ============================================================ */

const TOKENS = 'native_push_tokens';

/* ⚠️ Can this shell be asked for a push token at all?

   Not a preference and not a feature flag: on Android, calling
   PushNotifications.register() without a google-services.json in the
   binary ENDS THE PROCESS. FirebaseMessaging.getInstance() throws,
   Capacitor's Bridge rethrows it as a RuntimeException from its task
   handler, and an uncaught exception on any thread kills the app. That
   is the "I tap Remind me and the app closes" bug from the Play alpha,
   and it cannot be caught here — the throw happens in Java, after the
   bridge call this side has already returned from.

   So the rule is: never make the call unless the shell has the
   credential. NATIVE_PUSH_PLATFORMS in config.js is the list, it is
   empty until Firebase exists, and configure-native.mjs --check keeps it
   honest against what is actually in the Android project.

   Everything downstream treats false as "this device cannot be reached",
   which is the truth, and which the reminders block in ui/overlays.js
   now says out loud rather than offering a button. */
const nativePushReady = () => native() && NATIVE_PUSH_PLATFORMS.includes(platform());

/* One row per device, keyed on the token, upserted — the same contract
   push_subscriptions has with `endpoint`, for the same reason: APNs and
   FCM both rotate tokens without warning, and a device that re-registers
   must move its row rather than add one. */
const upsertToken = (token, uid) => rest(TOKENS, { method:'POST',
  body: {
    token,
    user_id: uid,
    platform: platform(),
    tz_offset: -new Date().getTimezoneOffset(),
    lang,
    last_seen: new Date().toISOString(),
  },
  prefer:'resolution=merge-duplicates' });

/* The registration handshake is asynchronous in a way the web one is
   not: `register()` resolves when the OS has been ASKED, and the token
   arrives later on a listener. So the listener is attached once, at
   module level, and a promise is what register() actually waits on. */
let tokenPromise = null;
let lastToken = null;

function awaitToken(){
  if(tokenPromise) return tokenPromise;
  const p = plugin('PushNotifications');
  if(!p || typeof p.addListener !== 'function') return Promise.resolve(null);

  tokenPromise = new Promise(resolve => {
    /* 20 seconds, then give up. A phone in airplane mode never gets a
       token from APNs and the promise would otherwise be held forever,
       with the settings toggle spinning. */
    const done = setTimeout(() => resolve(null), 20000);
    p.addListener('registration', ({ value }) => {
      clearTimeout(done); lastToken = value || null; resolve(lastToken);
    });
    p.addListener('registrationError', err => {
      clearTimeout(done); console.warn('native push registration failed', err); resolve(null);
    });
  });
  return tokenPromise;
}

/* A tapped notification, native-side. The web gets this through the
   service worker's `navigate` message (see app.js); on native the OS
   delivers it here instead, and it is turned into the same deep link so
   that openFromHash() stays the single place that decides what a route
   means. The payload's shape is ours: the sender puts `{ url: "#p/…" }`
   in the data, exactly as sw.js does today. */
export function watchNativeTaps(onHash){
  if(!native()) return;
  const p = plugin('PushNotifications');
  if(!p || typeof p.addListener !== 'function') return;
  p.addListener('pushNotificationActionPerformed', ev => {
    const d = (ev && ev.notification && ev.notification.data) || {};
    const url = d.url || d.link || '';
    const cut = String(url).indexOf('#');
    if(cut >= 0) onHash(String(url).slice(cut));
  });
}

async function enableNativePush(uid){
  /* Before the permission dialog, not after: asking someone to allow
     notifications and then telling them the app cannot send any is worse
     than never asking. */
  if(!nativePushReady()) return { ok:false, reason:'native-unconfigured' };
  const perm = await call('PushNotifications', 'checkPermissions');
  let status = perm.ok && perm.value ? perm.value.receive : 'prompt';
  if(status === 'prompt' || status === 'prompt-with-rationale'){
    const asked = await call('PushNotifications', 'requestPermissions');
    status = asked.ok && asked.value ? asked.value.receive : 'denied';
  }
  if(status !== 'granted') return { ok:false, reason:'denied' };

  const token = awaitToken();
  const reg = await call('PushNotifications', 'register');
  if(!reg.ok) return { ok:false, reason:'subscribe-failed' };

  const value = await token;
  if(!value) return { ok:false, reason:'subscribe-failed' };

  try{ await upsertToken(value, uid); }
  catch(e){ console.warn('storing the device token failed', e); return { ok:false, reason:'store-failed' }; }
  return { ok:true };
}

async function disableNativePush(){
  const token = lastToken;
  /* Stop the OS delivering, then forget the row. Order matters only in
     that a failure of the second leaves a token nothing will ever send
     to, which is harmless; the reverse leaves notifications arriving
     after the user turned them off, which is not. */
  await call('PushNotifications', 'unregister');
  if(token){
    try{ await rest(`${TOKENS}?token=eq.${encodeURIComponent(token)}`, { method:'DELETE' }); }
    catch(e){ console.warn('removing the device token failed', e); }
  }
  lastToken = null; tokenPromise = null;
  return true;
}

async function nativePushEnabled(){
  /* A shell that cannot send is not "on" no matter what Android says
     about the permission — and answering true here would send syncPush()
     into register() on the next boot, which is the crash again, this time
     with nobody having tapped anything. */
  if(!nativePushReady()) return false;
  const perm = await call('PushNotifications', 'checkPermissions');
  if(!perm.ok || !perm.value || perm.value.receive !== 'granted') return false;
  return true;
}

export const pushSupported = () =>
  /* Inside the shell this is an OS capability rather than a browser one,
     so none of the four web conditions below apply — but it is still only
     true if the shell was built with the push credential. It was not,
     until step 4.2; see nativePushReady() above. */
  (native() ? nativePushReady() :
  (typeof navigator!=='undefined' && 'serviceWorker' in navigator
  && typeof window!=='undefined' && 'PushManager' in window && 'Notification' in window
  && !!VAPID_PUBLIC_KEY));

/* Running from the Home Screen / as an installed app rather than a tab. */
export const standalone = () =>
  /* The shell is not "installed to the Home Screen", it IS the app —
     and every caller of this asks the same underlying question: is this
     a browser tab? Answering false inside the app would put the
     "add Crema to your Home Screen" prompt inside Crema. */
  native() ||
  (typeof window!=='undefined' && window.matchMedia
    && window.matchMedia('(display-mode: standalone)').matches)
  || (typeof navigator!=='undefined' && navigator.standalone===true);

export const isIOS = () =>
  typeof navigator!=='undefined'
  && (/iPad|iPhone|iPod/.test(navigator.platform||'')
      /* iPadOS 13+ reports as a Mac; the touch points give it away. */
      || (navigator.platform==='MacIntel' && (navigator.maxTouchPoints||0) > 1));

/* Safari specifically, not just "an iPhone".
   On iOS every browser is WebKit underneath, but only Safari puts "Add
   to Home Screen" in the share sheet — Chrome and Firefox have their
   own menus in their own places. So the prompt is shown only where the
   instructions it gives are actually true, and the others are left
   alone rather than sent looking for a button that isn't there. */
export const iosSafari = () =>
  isIOS() && typeof navigator!=='undefined'
  && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome|Android/i.test(navigator.userAgent||'');

/* The whole question this answers: is this person reading Crema in a
   Safari tab when they could be running it from their Home Screen?
   `standalone` is what tells the two apart — iOS sets
   navigator.standalone on a home-screen launch, and the installed app
   also matches display-mode: standalone. Either one means installed,
   and means this prompt has nothing to say. */
export const canInstallOnIOS = () => !native() && iosSafari() && !standalone();

/* True when the only thing standing between this user and push is
   Apple's Home Screen requirement — worth saying out loud, because the
   fix is one menu away and otherwise the toggle just looks broken. */
export const iosNeedsInstall = () => !native() && isIOS() && !standalone() && !('PushManager' in window);

export const pushPermission = () =>
  (typeof Notification!=='undefined' && Notification.permission) || 'default';

/* VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(b64){
  const pad='='.repeat((4 - b64.length % 4) % 4);
  const raw=atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));
  const out=new Uint8Array(raw.length);
  for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
  return out;
}
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

async function currentSubscription(){
  if(!pushSupported()) return null;
  const reg=await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/* Is this device set up to receive pushes right now?

   The live subscription is the answer, not Notification.permission. In
   the Play build Crema runs as a Trusted Web Activity, where notification
   permission is delegated to the Android app: the web content's
   Notification.permission reads 'default' on a cold start even though the
   subscription is alive and pushes are arriving. Requiring 'granted' here
   meant every launch decided reminders were off, and tapping "Remind me"
   appeared to fix it instantly — the delegated requestPermission() returns
   granted and the existing subscription is reused — only to forget again
   next launch. That was the whole bug.

   An explicit 'denied' still wins: the browser will not deliver, whatever
   subscription happens to be lying around. */
export async function pushEnabled(){
  if(native()) return nativePushEnabled();
  if(pushPermission()==='denied') return false;
  return !!(await currentSubscription());
}

function rowFrom(sub, uid){
  const j=sub.toJSON();
  return {
    endpoint: sub.endpoint,
    user_id: uid,
    p256dh: (j.keys&&j.keys.p256dh) || b64(sub.getKey('p256dh')),
    auth:   (j.keys&&j.keys.auth)   || b64(sub.getKey('auth')),
    /* Minutes east of UTC, so the reminder job can fire in the evening
       where the user actually is rather than in the evening in Germany. */
    tz_offset: -new Date().getTimezoneOffset(),
    /* And which language to say it in. Per DEVICE rather than per
       account, for exactly the reason tz_offset is: the notification
       appears on this phone, and the language is this browser's
       (localStorage, see i18n.js). A tablet left in English keeps
       getting English while the phone switched to German.

       The server composes push text in plpgsql and cannot ask the
       browser at send time, so this is the only way it can know —
       step-1.32.sql. */
    lang,
    last_seen: new Date().toISOString()
  };
}

const upsert = (sub, uid) => rest('push_subscriptions', { method:'POST',
  body: rowFrom(sub, uid), prefer:'resolution=merge-duplicates' });

/* Ask, subscribe, store. Returns a reason string on failure so the UI can
   say something truer than "didn't work". */
export async function enablePush(uid){
  if(native()) return enableNativePush(uid);
  if(!pushSupported()) return { ok:false, reason: iosNeedsInstall() ? 'ios-install' : 'unsupported' };
  const perm = pushPermission()==='granted' ? 'granted' : await Notification.requestPermission();
  if(perm!=='granted') return { ok:false, reason: perm==='denied' ? 'denied' : 'dismissed' };

  const reg=await navigator.serviceWorker.ready;
  let sub=await reg.pushManager.getSubscription();
  /* A subscription minted under a different VAPID key can never be
     delivered to — drop it and take a fresh one. */
  if(sub){
    const want=urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
    const have=new Uint8Array(sub.options&&sub.options.applicationServerKey||new ArrayBuffer(0));
    const same=have.length===want.length && have.every((v,i)=>v===want[i]);
    if(!same){ await sub.unsubscribe().catch(()=>{}); sub=null; }
  }
  if(!sub){
    sub=await reg.pushManager.subscribe({
      userVisibleOnly:true,
      applicationServerKey:urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    }).catch(e=>{ console.warn('subscribe failed',e); return null; });
  }
  if(!sub) return { ok:false, reason:'subscribe-failed' };

  try{ await upsert(sub, uid); }
  catch(e){ console.warn('storing push subscription failed',e); return { ok:false, reason:'store-failed' }; }
  return { ok:true };
}

/* Off means off on this device: the row goes, so the server stops trying,
   and the browser subscription goes with it. Other devices keep theirs. */
export async function disablePush(){
  if(native()) return disableNativePush();
  const sub=await currentSubscription();
  if(!sub) return true;
  const endpoint=sub.endpoint;
  await sub.unsubscribe().catch(()=>{});
  try{ await rest(`push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`,{ method:'DELETE' }); }
  catch(e){ console.warn('removing push subscription failed',e); }
  return true;
}

/* Called on boot. Browsers rotate endpoints without telling anyone, and a
   row pointing at a dead endpoint means silently missed notifications —
   so an already-granted device re-states where it is, once per load.
   Never prompts: no permission request happens here. */
export async function syncPush(uid){
  if(!uid || !(await pushEnabled())) return;
  if(native()){
    /* Same job as the web branch below — restate where this device is,
       once per launch, because the token may have rotated while the app
       was closed. register() is safe to call again: permission is
       already granted, so nothing prompts. Unreachable unless
       pushEnabled() said yes, which already requires nativePushReady();
       stated again because this is the boot path and the cost of being
       wrong here is an app that closes on launch. */
    if(!nativePushReady()) return;
    const token = awaitToken();
    await call('PushNotifications', 'register');
    const value = await token;
    if(value) await upsertToken(value, uid).catch(()=>{});
    return;
  }
  const sub=await currentSubscription();
  if(sub) await upsert(sub, uid).catch(()=>{});
}
