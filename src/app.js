"use strict";
/* ============================================================
   app — composition root & boot sequence.

   Wires the layers together and starts the app:

     1. restore the session (localStorage → refreshed if stale)
     2. reference data, then the feed — today's public pours for a
        guest, this user's world for a member
     3. paint
     4. brand-new account → onboarding; anyone → deep link

   There is no signed-out dead end any more. A visitor with no session
   lands on the real Today feed and is asked for an account the moment
   they try to *do* something (ui/actions.js). Everything below is
   therefore written to run with `auth.session` null.

   Importing ./ui/actions.js registers the global event handlers as a
   side effect.
   ============================================================ */
import { initAuth, getSession } from './data/supabase.js';
import { loadReferenceData } from './data/remote.js';
import { fetchPost } from './data/posts.js';
import { adoptSession, syncWorld, applyMe, findPost, cachePosts, state, ui } from './store/store.js';
import { startLive } from './store/live.js';
import { render } from './ui/views.js';
import { authState } from './ui/gate.js';
import { pushOv } from './ui/overlays.js';
import { applyTheme, tick, toast, syncProfile, initPush, openPost, openRecap } from './ui/actions.js';
import { startAgoTicker } from './ui/timeago.js';
import { canInstallOnIOS } from './data/push.js';
import { seen, markSeen, DAILY_CHAMPION } from './core/announce.js';
import { applyLang, t } from './i18n.js';
import { watchForErrors } from './data/errors.js';
/* Side effect only: measures the window and keeps --app-h in step with it
   for the rest of the session. Module evaluation happens before anything
   below runs, so the shell is the right height for the first paint. */
import './ui/viewport.js';

/* Before anything paints: <html lang> has to match the copy the first
   render is about to write, or the browser offers to translate a page
   that is already in the reader's language. */
applyLang();

/* Two listeners, no network, no work — installed before anything below
   can throw, which is the only placement that makes it useful. A crash
   during boot is exactly the crash nobody currently hears about.
   Nothing is sent until something actually breaks, so this respects
   the rule above it: nothing before the first paint touches the
   network. See src/data/errors.js. */
watchForErrors();

/* ============================================================
   Nothing above the first paint may touch the network.

   That line is the whole of what this boot is now, and it is worth
   saying plainly because the old order looked reasonable and cost
   seconds. It was: refresh the access token, then fetch reference
   data, then run ten social queries one after another, then fetch the
   feed — and only then paint. Every one of those is a round trip to
   Frankfurt, and on a phone waking its radio the first one alone can
   be most of a second. The result was a Play-build cold start that
   showed the splash, then the shell's background colour, and nothing
   else for about three seconds.

   Everything needed for a truthful first screen is already in this
   browser: who is signed in, what the app looked like last time, and
   the cached café and bean tables. So it paints from that, and the
   network arrives into a screen that is already up.
   ============================================================ */

/* top-level await, but not a network one: initAuth() reads the stored
   session and starts its refresh without waiting for it. The exception
   is the way back from an OAuth redirect, which does have to finish
   here — a visitor who has just signed in has no cached screen to be
   shown in the meantime, and painting them as a guest first would be a
   worse answer than waiting. */
const auth = await initAuth();

/* Cafés, beans and challenges are read-only reference data, and every
   post carries a cafe_id that needs them to resolve to a name — so they
   load *before* the feed rather than behind it. Cached for 15 minutes.

   Not awaited here, and deliberately not: loadReferenceData() applies
   whatever is in its cache synchronously, before its own first await,
   so CAFES and BEANS are already filled by the time the paint below
   reads them. The promise is the *network* refresh behind that, and the
   only thing that has to wait for it is the world sync — which writes
   café follower counts and challenge progress into these same arrays,
   and would have them overwritten by a refresh landing afterwards. */
const reference = loadReferenceData();

/* localStorage only — the session, the settings, and the last feed this
   browser saw. The network half of it is syncWorld(), below. */
await adoptSession(auth.session);
applyMe(); applyTheme(); tick();

/* A sign-in that failed on the way back belongs on the sign-in screen,
   where it stays put — a toast for this would fade before it was read.
   It also has to *open* that screen: this visitor is a guest now, and
   the guest feed is the one place the message wouldn't be seen. */
if(auth.error && !auth.session){ authState().error = auth.error; ui.gate=true; }

/* ---------- the first paint ---------- */
render();
setInterval(tick,10000);
/* The clock in the app bar is not the only thing on screen that has to
   keep up with the time: every "4m" under a pour is a clock too, and
   until this ran they all stopped at whatever the last fetch said. */
startAgoTicker();
if(auth.error && auth.session) toast(t(auth.error));

/* ---------- and now the network ----------
   Reference data first, then your social graph and the feed. Repaints
   when it lands, which is the point of having painted already.

   startLive() hangs off the end for the reason it always did: the
   socket and the poller only ever *change* what is on screen, and
   there is nothing to change until the feed is showing. Guests too —
   the live feed is the most persuasive thing on their screen. */
(async()=>{
  await reference;
  await syncWorld();
  applyMe(); render();
})().catch(e=>console.warn('the world did not load',e))
    .then(startLive);

/* Open a pour by id, fetching it when it isn't already on screen.
   Cached rather than pushed into `state.posts`: a shared pour is usually
   not from today, and the feed it would land at the top of is Today.

   `uid` is who is looking, or null — a stranger following a shared link
   is the case this has to work for, since that link is what the OG card
   in index.html exists to earn. RLS hands the `anon` role public pours
   and nothing else, so a followers-only link simply doesn't resolve.

   Opening the pour that is already on top is nothing at all rather than
   a second identical sheet — otherwise tapping the same link twice, now
   that both taps arrive, would cost two back presses to get out of. */
function openPostById(id, uid){
  const top=ui.ovStack[ui.ovStack.length-1];
  if(top && top.type==='post' && top.id===id) return;
  if(findPost(id)){ openPost(id); return; }
  fetchPost(id, uid)
    .then(p=>{ if(p){ cachePosts([p]); openPost(p.id); } })
    .catch(()=>{});
}
const postIn = h => (String(h||'').match(/#p\/([\w-]+)/)||[])[1] || null;
/* Where the Sunday notification lands. The card is the thing that push
   is about, so tapping it opens the card rather than the feed and a
   hunt for the row on the profile. */
const recapIn = h => /#recap\b/.test(String(h||''));

/* Read the hash AND wipe it, in one go.

   A shared link is a one-shot instruction, not a place: once the pour is
   open, leaving `#p/<id>` in the address bar means the *next* link can
   arrive at a URL that differs from the current one in nothing at all —
   and a navigation to an identical URL is not a navigation. That is the
   bug people hit with the app already running in the background: the
   Android launcher hands the link to the live instance, the URL is
   already that link, nothing fires, and Crema comes back up on whatever
   screen it was last on rather than on the pour.

   replaceState keeps `history.state` as it was, so the spare back-button
   entry ui/history.js keeps track of is left exactly where it was. */
function takeHash(){
  const h = location.hash || '';
  if(h && typeof history!=='undefined'){
    try{ history.replaceState(history.state, '', location.pathname + location.search); }catch(e){}
  }
  return h;
}

/* The one place that turns a hash into a screen — used by the cold
   start, by a link that arrives while the app is already open, and by
   the service worker handing over a tapped notification. The session is
   read live rather than captured at boot: someone can sign in between
   the two, and then the fetch should be theirs and not a stranger's. */
function openFromHash(h){
  const id = postIn(h);
  const s = getSession();
  if(id){ openPostById(id, s ? s.user.id : null); return true; }
  if(recapIn(h) && s){ openRecap(); return true; }
  return false;
}

/* A link opened while Crema is already running is a same-document
   navigation: no reload, no boot, just this event. Everything above ran
   once, a long time ago, so without this the link does nothing. */
addEventListener('hashchange', ()=>{ openFromHash(takeHash()); });

if(auth.session){
  /* The profile row is the truth about who this is, and whether the
     account is new enough to still need onboarding. */
  await syncProfile();
  applyMe(); render();

  /* Read once, by whichever of the three branches below greets this
     person, and then done with. */
  const fresh=ui.freshAccount; ui.freshAccount=false;

  if(!state.onboarded){
    pushOv({type:'onboard'});
    /* A brand-new account is not being told what CHANGED — for them the
       daily race is simply how Crema has always worked, and onboarding
       says what points are. Marked seen rather than left pending so the
       card does not ambush them on their second open. */
    markSeen(DAILY_CHAMPION);
  }
  else if(auth.recovery){ pushOv({type:'password'}); toast('Signed in — pick a new password'); }
  else{
    /* Signing up with Google comes back through here rather than
       through onAuthChange: the redirect is a cold boot with a session
       already in hand. The account is brand new and its setup was
       answered before it existed, so there is no sheet to raise — only
       the same two things onboarding would have done. */
    if(fresh){ markSeen(DAILY_CHAMPION); toast(t('Welcome to Crema ☕')); }
    openFromHash(takeHash());
  }
}else{
  openFromHash(takeHash());
}

/* ---------- what changed while you were away ----------
   Once per browser, ever (core/announce.js), and only for somebody who
   has an account and can therefore earn the thing it describes — a
   guest has no level to add points to, and this would be the second
   sheet of their visit.

   Same restraint as the iPhone prompt below it: never over onboarding,
   never over a pour somebody followed a link to, never over the sign-in
   sheet, and behind a short delay so the feed arrives first. The seen
   flag is written when it is DISMISSED, not when it is raised
   (`dismiss-whatsnew` in ui/actions.js) — an app killed while the card
   was on screen has not told anybody anything. */
if(auth.session && state.onboarded && !seen(DAILY_CHAMPION)) setTimeout(()=>{
  if(ui.ovStack.length||ui.gate) return;
  pushOv({type:'whatsnew'});
}, 1400);

/* ---------- the iPhone-in-a-tab prompt ----------
   Raised once per app open, and only when there is nothing else on
   screen to interrupt: not over onboarding, not over a pour somebody
   followed a link to, not over the sign-in sheet. A short delay so it
   arrives after the feed rather than instead of it — the first thing a
   visitor should see is coffee, not a request.

   Nothing is remembered between opens, so this returns every time the
   app is opened in a tab. That is deliberate, and it is also the whole
   cost of it: it stops the moment they install, because
   canInstallOnIOS() is false from a Home Screen launch. */
if(canInstallOnIOS()) setTimeout(()=>{
  if(ui.ovStack.length||ui.gate) return;
  pushOv({type:'ios'});
}, 2200);

/* A newer deploy is in the cache and this page is running the older
   one. See the 'stale' message below for when this is allowed to fire. */
function takeUpdate(){
  if(ui.ovStack.length||ui.gate) return;
  if(performance.now()>10000) return;
  try{
    if(sessionStorage.getItem('crema_took_update')) return;
    sessionStorage.setItem('crema_took_update','1');
  }catch(e){ return; }        // no storage, no way to stop a second one
  location.reload();
}

if('serviceWorker' in navigator && (location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname))){
  let _reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(_reloading)return; _reloading=true; location.reload(); });

  /* Messages from the worker (sw.js).

     `navigate` arrives when a notification is tapped while Crema is
     already open — the worker focuses this tab, but a focused tab does
     not navigate itself, so the deep link is handed over here and
     opened the same way a cold start would open it.

     `push-resubscribed` means the push service rotated our endpoint
     behind our back. The worker cannot write to PostgREST (it has no
     session), so the page stores the new one.

     `stale` is the other half of the cache-first service worker: the
     code running right now came out of the cache, and the copy the
     worker has since fetched is not the same one. Taking it costs a
     reload, so it is only ever done in the first seconds of a start,
     with nothing open on top and nothing typed — a deploy that lands
     while somebody is reading can wait for the next open, which will
     have it either way. Once per tab, so a server that answers with a
     different validator every time cannot turn this into a loop. */
  navigator.serviceWorker.addEventListener('message',e=>{
    const d=e.data||{};
    if(d.type==='navigate'&&d.url){
      const i=String(d.url).indexOf('#');
      if(i>=0) openFromHash(String(d.url).slice(i));
    }
    else if(d.type==='push-resubscribed') initPush();
    else if(d.type==='stale') takeUpdate();
  });

  try{ navigator.serviceWorker.register('./sw.js').then(r=>{ if(r&&r.update) r.update(); }).catch(()=>{}); }catch(e){}

  /* After registration, so navigator.serviceWorker.ready resolves. Does
     not prompt — it only notices an existing subscription and refreshes
     the row that points at it. */
  if(auth.session) initPush().catch(()=>{});
}
