"use strict";
/* ============================================================
   config — backend endpoints.

   The publishable key is *designed* to ship in client code: it only
   ever grants the `anon` role, and Row Level Security is what actually
   protects the data (see platform/supabase/schema.sql). It is committed on
   purpose — the app is a static site, so there is no build step to
   inject it at deploy time.

   The service_role key must NEVER appear in this file or any other
   file the browser can fetch. It bypasses RLS entirely.

   Both values are required, for guests as much as for members: there is
   no bundled sample feed to fall back on. With either one blank the app
   can only show the sign-in screen and say it isn't configured.
   ============================================================ */

/* ------------------------------------------------------------
   Which backend this page talks to.

   There is no build step, so the environment cannot be injected at
   deploy time — and a static site does not need it to be. The page
   already knows where it is being served from, and the hostname is
   exactly the fact we want to switch on. ~40 lines here buys the same
   thing build-time injection would, and keeps the buildless property
   (brain/13-infrastructure-plan.md, step 1.2).

   Adding an environment is adding an entry below and a hostname to one
   of the three lists. Nothing else in the app reads these directly:
   everything imports SUPABASE_URL / SUPABASE_KEY / BACKEND, which are
   resolved once, here.
   ------------------------------------------------------------ */

const ENVIRONMENTS = {
  production: {
    url: 'https://diabtvahplwoipvrprvb.supabase.co',
    key: 'sb_publishable_Dl-0fert2JgI005EaRauNw_ytYbmeVL',
  },
  /* Staging. Fill both in from the staging project's dashboard
     (Project Settings → API): the URL and the *publishable* key, never
     the service_role one. While these are blank, localhost keeps using
     production and says so in the console — see pickEnvironment(). */
  staging: {
    url: 'https://qqyurcqrikqvqgbjcjhg.supabase.co',
    key: 'sb_publishable_oucpi3Bkw-bxQS_gUnp8Xg_lctghGb2',
  },
};

/* The live app. mgtajo.github.io is here because it still redirects to
   crema-app.com and is in Supabase's redirect allowlist. */
const PRODUCTION_HOSTS = ['crema-app.com', 'www.crema-app.com', 'mgtajo.github.io'];

/* Hosts that must reach staging and must never quietly fall back to
   production — an unconfigured staging host is a misconfiguration, and
   the app is supposed to say so rather than write to the real database. */
const STAGING_HOSTS = ['staging.crema-app.com'];

/* devserver.py, and anything else served off this machine. */
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'];

/* ------------------------------------------------------------
   The native shell, before anything else is asked.

   `[CANON]` A store build must talk to production, always, and it must
   not be able to reach staging by accident. This branch is the reason
   the whole function is not just the hostname.

   Capacitor serves the bundled app from a LOCAL origin — http://
   localhost on Android, capacitor://localhost on iOS, unless
   capacitor.config.json sets `server.hostname`, which ours does. Read
   the hostname rules below with that in mind: 'localhost' is in
   LOCAL_HOSTS, staging is now configured, and so a native build that
   fell through to them would resolve to STAGING and ship to the App
   Store writing every pour into the test database. Nothing about that
   failure is visible from inside the app — it looks like a working
   Crema with an empty feed.

   So the shell is asked first and answered flatly. Two independent
   guards, because this is a mistake you only get to make once:

     1. this branch, which does not consult the hostname at all;
     2. `server.hostname: "crema-app.com"` in capacitor.config.json,
        which makes the native origin's hostname a PRODUCTION_HOST even
        if somebody deletes this branch.

   The check is inlined rather than imported from core/native.js on
   purpose. config.js is the deepest module in the app — data/ imports
   it and it imports nothing — and giving it an import to satisfy the
   layering rule would be the wrong trade for six lines. */
function isNativeShell(){
  const c = (typeof window !== 'undefined' && window.Capacitor) || null;
  if(!c) return false;
  try{ return typeof c.isNativePlatform === 'function' ? c.isNativePlatform() : !!c.isNative; }
  catch(e){ return false; }
}

function pickEnvironment(){
  if(isNativeShell()) return 'production';
  const host = (typeof location !== 'undefined' && location.hostname) || '';
  if(STAGING_HOSTS.includes(host)) return 'staging';
  if(PRODUCTION_HOSTS.includes(host)) return 'production';
  if(LOCAL_HOSTS.includes(host) || host.endsWith('.local')){
    if(ENVIRONMENTS.staging.url && ENVIRONMENTS.staging.key) return 'staging';
    /* Deliberate, and deliberately loud. Local development against
       production is what this step exists to end, but breaking the dev
       server on the day the switch lands — before the staging project
       exists — would just get the switch reverted. This warning is the
       whole remedy: fill in ENVIRONMENTS.staging above. */
    if(typeof console !== 'undefined'){
      console.warn('[crema] staging is not configured — this page is talking to PRODUCTION. Fill in ENVIRONMENTS.staging in src/config.js.');
    }
    return 'production';
  }
  /* An unlisted host — a fork, a preview domain, someone's own copy.
     Production is what it resolved to before this switch existed, so it
     is what it resolves to now. A new staging host goes in the list
     above; it does not get here by accident. */
  return 'production';
}

/* Which one this page picked. Exported so anything that needs to say it
   out loud — a banner, a test, the console — reads it rather than
   re-deriving it from the hostname. */
export const ENV = pickEnvironment();

export const SUPABASE_URL = ENVIRONMENTS[ENV].url;
export const SUPABASE_KEY = ENVIRONMENTS[ENV].key;

if(ENV !== 'production' && typeof console !== 'undefined'){
  console.info(`[crema] backend: ${ENV} (${SUPABASE_URL || 'not configured'})`);
}

/* R2 custom domain, bound to the "coffee" bucket with Cloudflare
   Image Transformations enabled on the zone (roadmap step 1.6). Public
   and read-only — safe to commit, same as the URL/key above.

   ⚠️ One bucket, both environments: a photo uploaded from staging lands
   next to the real ones. Harmless while staging is one person testing,
   and a second bucket is the fix if that stops being true. */
export const MEDIA_BASE = 'https://media.crema-app.com';

/* Sanity check on the two values above. False means the app is
   misconfigured, not that it has a fallback to fall back to. */
export const BACKEND = !!(SUPABASE_URL && SUPABASE_KEY);

/* How long cached reference data (cafés, beans, challenges) stays fresh
   before we re-fetch. Short enough that dashboard edits show up quickly,
   long enough that the PWA works offline. */
export const REFERENCE_TTL_MS = 15 * 60 * 1000;

/* Feed page size for the paginated post feed. */
export const FEED_PAGE = 12;

/* How often store/live.js asks whether anything changed, when the
   Realtime socket is not carrying that answer for us — a blocked
   WebSocket, or platform/supabase/step-1.25.sql not yet run. Only ever
   while the tab is on screen, and two small requests per tick.

   A minute is the honest floor for a poll: short enough that a pour
   posted across the table shows up while you are still holding the cup,
   long enough that a morning open in the background costs nothing worth
   naming. Realtime, when it is up, makes this moot — the socket answers
   in well under a second. */
export const LIVE_POLL_MS = 60 * 1000;

/* VAPID public key for Web Push (roadmap step 1.16). Public by design:
   it identifies Crema to the browser's push service and is handed to
   PushManager.subscribe() in client code, so it belongs here next to the
   other publishable values.

   The matching PRIVATE key must never appear in this repo. It lives as a
   Supabase Edge Function secret (VAPID_PRIVATE_KEY) — anyone holding it
   can send notifications that appear to come from Crema.

   Blank disables push everywhere: pushSupported() is false, the toggle
   in Settings hides itself, and the in-app nudges carry on unaffected. */
export const VAPID_PUBLIC_KEY = 'BG6-xot5uE9TXxaK4JkMntrlmbGCRO1SXZG6_zDWJ9J7I7vGQ60aorseelDTIEoJrOd6SAWwyABMOvgtDJCZZnk';
export const VAPID_SUBJECT = 'mailto:hello@crema-app.com';

/* ------------------------------------------------------------
   Native push: which shells can actually deliver one.

   ⚠️ THIS CONSTANT EXISTS BECAUSE THE ALTERNATIVE IS A CRASH, not
   because it is a nice place for a feature flag.

   @capacitor/push-notifications' Android `register()` is one line:
   `FirebaseMessaging.getInstance()`. With no google-services.json in the
   project that throws IllegalStateException — and Capacitor's
   Bridge.callPluginMethod rethrows a plugin failure as a RuntimeException
   from a Runnable posted to its task handler, where nothing catches it.
   An uncaught exception on any thread ends the process. So tapping
   "Remind me" in the Play alpha did not fail: it closed the app, exactly
   as reported, and no try/catch in JavaScript can prevent that, because
   the throw happens in Java after the bridge call has already returned.

   The only defence a web layer has is not to make the call. That is what
   this is: a list of the platforms whose shell has the credential its
   push service needs. Empty means "ask nobody", and data/push.js then
   reports the reminders toggle as unavailable and says so honestly
   instead of offering a button that kills the app.

   TO TURN ANDROID ON, in this order — both halves or neither:
     1. platform/capacitor/android/app/google-services.json, from the
        Firebase project (Project settings → Your apps → Android, package
        com.crema_app.android). app/build.gradle already applies the
        google-services plugin the moment that file exists.
     2. add 'android' here.
   `node platform/capacitor/configure-native.mjs --check` fails when
   those two disagree in either direction, so this cannot rot into a
   crash again.

   iOS stays out until the shell has been compiled at all and an APNs key
   exists (brain/11-open-questions.md Q19).

   Falsy in a browser by construction: nothing reads this unless
   core/native.js says the app is running inside a shell. */
export const NATIVE_PUSH_PLATFORMS = [];
