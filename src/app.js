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
import { useSession, applyMe, findPost, cachePosts, state, ui } from './store/store.js';
import { startLive } from './store/live.js';
import { render } from './ui/views.js';
import { authState } from './ui/gate.js';
import { pushOv } from './ui/overlays.js';
import { applyTheme, tick, toast, syncProfile, initPush, openPost, openRecap } from './ui/actions.js';
import { applyLang } from './i18n.js';
/* Side effect only: measures the window and keeps --app-h in step with it
   for the rest of the session. Module evaluation happens before anything
   below runs, so the shell is the right height for the first paint. */
import './ui/viewport.js';

/* Before anything paints: <html lang> has to match the copy the first
   render is about to write, or the browser offers to translate a page
   that is already in the reader's language. */
applyLang();

/* top-level await: the session decides what the first paint even is. */
const auth = await initAuth();

/* Cafés, beans and challenges are read-only reference data, and every
   post carries a cafe_id that needs them to resolve to a name — so they
   load *before* the feed rather than behind it. Cached for 15 minutes,
   so this is usually instant, and it works offline. Guests too: the
   tables are world-readable, and a pour whose café renders as nothing
   is a worse advert than one that names the place. */
await loadReferenceData();

await useSession(auth.session);
applyMe(); applyTheme(); tick();

/* A sign-in that failed on the way back belongs on the sign-in screen,
   where it stays put — a toast for this would fade before it was read.
   It also has to *open* that screen: this visitor is a guest now, and
   the guest feed is the one place the message wouldn't be seen. */
if(auth.error && !auth.session){ authState().error = auth.error; ui.gate=true; }
render();
setInterval(tick,10000);
/* After the first paint, never before it: the socket and the poller both
   only ever *change* what is on screen, and there is nothing to change
   until the feed that just loaded is showing. Guests too — the live
   feed is the most persuasive thing on their screen. */
startLive();
if(auth.error && auth.session) toast(auth.error);

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

  if(!state.onboarded){ pushOv({type:'onboard'}); }
  else if(auth.recovery){ pushOv({type:'password'}); toast('Signed in — pick a new password'); }
  else openFromHash(takeHash());
}else{
  openFromHash(takeHash());
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
     session), so the page stores the new one. */
  navigator.serviceWorker.addEventListener('message',e=>{
    const d=e.data||{};
    if(d.type==='navigate'&&d.url){
      const i=String(d.url).indexOf('#');
      if(i>=0) openFromHash(String(d.url).slice(i));
    }
    else if(d.type==='push-resubscribed') initPush();
  });

  try{ navigator.serviceWorker.register('./sw.js').then(r=>{ if(r&&r.update) r.update(); }).catch(()=>{}); }catch(e){}

  /* After registration, so navigator.serviceWorker.ready resolves. Does
     not prompt — it only notices an existing subscription and refreshes
     the row that points at it. */
  if(auth.session) initPush().catch(()=>{});
}
