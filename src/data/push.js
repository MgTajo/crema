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
import { VAPID_PUBLIC_KEY } from '../config.js';
import { rest } from './supabase.js';

export const pushSupported = () =>
  typeof navigator!=='undefined' && 'serviceWorker' in navigator
  && typeof window!=='undefined' && 'PushManager' in window && 'Notification' in window
  && !!VAPID_PUBLIC_KEY;

/* Running from the Home Screen / as an installed app rather than a tab. */
export const standalone = () =>
  (typeof window!=='undefined' && window.matchMedia
    && window.matchMedia('(display-mode: standalone)').matches)
  || (typeof navigator!=='undefined' && navigator.standalone===true);

const isIOS = () =>
  typeof navigator!=='undefined'
  && (/iPad|iPhone|iPod/.test(navigator.platform||'')
      /* iPadOS 13+ reports as a Mac; the touch points give it away. */
      || (navigator.platform==='MacIntel' && (navigator.maxTouchPoints||0) > 1));

/* True when the only thing standing between this user and push is
   Apple's Home Screen requirement — worth saying out loud, because the
   fix is one menu away and otherwise the toggle just looks broken. */
export const iosNeedsInstall = () => isIOS() && !standalone() && !('PushManager' in window);

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
    last_seen: new Date().toISOString()
  };
}

const upsert = row =>
  rest('push_subscriptions', { method:'POST', body:row, prefer:'resolution=merge-duplicates' });

/* Ask, subscribe, store. Returns a reason string on failure so the UI can
   say something truer than "didn't work". */
export async function enablePush(uid){
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

  try{ await upsert(rowFrom(sub, uid)); }
  catch(e){ console.warn('storing push subscription failed',e); return { ok:false, reason:'store-failed' }; }
  return { ok:true };
}

/* Off means off on this device: the row goes, so the server stops trying,
   and the browser subscription goes with it. Other devices keep theirs. */
export async function disablePush(){
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
  const sub=await currentSubscription();
  if(sub) await upsert(rowFrom(sub, uid)).catch(()=>{});
}
