"use strict";
/* ============================================================
   data/errors — the app tells the database when it breaks.

   Step 1b.5 of brain/13-infrastructure-plan.md, first-party half. This
   is the whole of Crema's error monitoring: no SDK, no third-party
   processor, no breadcrumbs. One row per distinct crash, per person.

   WHAT IT IS FOR
   Until now a JavaScript exception in front of a user was invisible —
   they saw a screen that stopped working and nobody ever found out.
   That is survivable while a fix is a `git push` away. It stops being
   survivable in Phase 4, when the same code ships inside a store
   binary and a fix is a review cycle away.

   FIVE RULES, and every one of them is here because an error reporter
   that misbehaves is worse than none at all:

     1. It never throws. Everything below is inside try/catch, and the
        POST's rejection is swallowed. A reporter that throws inside an
        error handler is a loop.
     2. It never reports itself. `sending` guards re-entry, so a
        failure in the POST cannot become a second report.
     3. It reports each distinct problem once per page load. The same
        message from the same place is one row, not one per frame — a
        throw inside a render repeats at 60Hz.
     4. It stops after MAX_PER_LOAD. The database has its own limit
        (drop_client_error_flood), which is the one that counts; this
        one exists so the network is not the thing that suffers.
     5. It only speaks for a signed-in person. The insert policy is
        `auth.uid() = user_id`, so a guest's crash has nowhere to go —
        deliberate, and the known gap: see the note at the bottom.
   ============================================================ */
import { rest, currentUser } from './supabase.js';
import { BACKEND } from '../config.js';
import { lang } from '../i18n.js';

const MAX_PER_LOAD = 5;
const seen = new Set();
let sent = 0;
let sending = false;

/* Which build is running. Read from the service worker's cache name
   ('crema-v43') rather than a constant kept in step with sw.js by hand:
   the number that matters is the one the browser actually has, and a
   constant would tell us what the tab was *served*, not what it is
   running. Resolved once, lazily, and never awaited by the caller. */
let version = null;
async function appVersion(){
  if(version !== null) return version;
  version = '';
  try{
    if(self.caches && caches.keys){
      const ks = await caches.keys();
      version = ks.find(k => k.startsWith('crema-v')) || '';
    }
  }catch(_){ /* caches is unavailable in a private window on some browsers */ }
  return version;
}

/* file.js:120:15 — the browser gives the three separately. */
function where(e){
  if(!e) return null;
  if(e.filename) return `${e.filename}:${e.lineno||0}:${e.colno||0}`;
  return null;
}

function clip(s, n){
  if(s == null) return null;
  const str = String(s);
  return str.length > n ? str.slice(0, n) : str;
}

/* One row. Fire and forget: the caller is an error handler and has
   nothing useful to do with a promise. */
async function report(message, source, stack){
  try{
    if(!BACKEND || sending) return;
    if(sent >= MAX_PER_LOAD) return;
    const u = currentUser();
    if(!u) return;                       // a guest has nowhere to write

    /* Dedupe on what the problem IS, not on when it happened. */
    const key = `${message}|${source||''}`;
    if(seen.has(key)) return;
    seen.add(key);
    sent++;

    sending = true;
    const app_version = await appVersion();
    await rest('client_errors', { method:'POST', prefer:'return=minimal', body:{
      user_id: u.id,
      message: clip(message, 500) || 'Unknown error',
      source:  clip(source, 300),
      stack:   clip(stack, 4000),
      app_version: app_version || null,
      lang
    }});
  }catch(_){
    /* Swallowed on purpose — rule 1. If the report cannot be filed
       there is nobody left to tell. */
  }finally{
    sending = false;
  }
}

/* Installed once, from the boot sequence. Both handlers are passive:
   neither calls preventDefault(), so the browser still logs to the
   console exactly as it did before and nothing about how the app fails
   is changed by watching it. */
export function watchForErrors(){
  try{
    addEventListener('error', e => {
      /* A failed <img>/<script> load fires this too, with no `error`
         object. Those are not crashes and there are a lot of them. */
      if(!e || !e.error) return;
      report(e.message || String(e.error), where(e), e.error && e.error.stack);
    });
    addEventListener('unhandledrejection', e => {
      const r = e && e.reason;
      if(!r) return;
      report(
        (r && r.message) || String(r),
        null,
        r && r.stack
      );
    });
  }catch(_){ /* an environment without addEventListener is not one we can help */ }
}

/* KNOWN GAP, written down rather than discovered later: a crash that
   happens to a signed-out visitor is not recorded, because the insert
   policy is `auth.uid() = user_id` and a guest has no uid. That covers
   the whole of guest mode and the sign-up flow — which is precisely
   where a first impression is lost. Closing it means either a nullable
   user_id with an anon insert policy (an unauthenticated write endpoint,
   rate-limited by nothing) or a signed token. Neither is free, and the
   trade was taken knowingly: see D-2026-08-30-06. */
