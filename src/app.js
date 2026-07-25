"use strict";
/* ============================================================
   app — composition root & boot sequence.

   Wires the layers together and starts the app:

     1. restore the session (localStorage → refreshed if stale)
     2. no session → paint the sign-in gate and stop. Crema needs an
        account; there is no signed-out mode.
     3. session → reference data, then this user's world, then paint
     4. brand-new account → onboarding; returning visitor → deep link

   Importing ./ui/actions.js registers the global event handlers as a
   side effect.
   ============================================================ */
import { initAuth } from './data/supabase.js';
import { loadReferenceData } from './data/remote.js';
import { fetchPost } from './data/posts.js';
import { useSession, applyMe, findPost, state } from './store/store.js';
import { render } from './ui/views.js';
import { authState } from './ui/gate.js';
import { pushOv } from './ui/overlays.js';
import { applyTheme, tick, toast, syncProfile } from './ui/actions.js';

/* top-level await: the session decides what the first paint even is. */
const auth = await initAuth();

/* Cafés, beans and challenges are read-only reference data, and every
   post carries a cafe_id that needs them to resolve to a name — so they
   load *before* the feed rather than behind it. Cached for 15 minutes,
   so this is usually instant, and it works offline. */
if(auth.session) await loadReferenceData();

await useSession(auth.session);
applyMe(); applyTheme(); tick();

/* A sign-in that failed on the way back belongs on the sign-in screen,
   where it stays put — a toast for this would fade before it was read. */
if(auth.error && !auth.session) authState().error = auth.error;
render();
setInterval(tick,10000);
if(auth.error && auth.session) toast(auth.error);

if(auth.session){
  /* The profile row is the truth about who this is, and whether the
     account is new enough to still need onboarding. */
  await syncProfile();
  applyMe(); render();

  if(!state.onboarded){ pushOv({type:'onboard'}); }
  else if(auth.recovery){ pushOv({type:'password'}); toast('Signed in — pick a new password'); }
  else {
    const m=location.hash.match(/#p\/([\w-]+)/);
    if(m){
      if(findPost(m[1])) pushOv({type:'post',id:m[1]});
      else fetchPost(m[1],auth.session.user.id)
        .then(p=>{ if(p){ state.posts.unshift(p); pushOv({type:'post',id:p.id}); } })
        .catch(()=>{});
    }
  }
}

if('serviceWorker' in navigator && (location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname))){
  let _reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(_reloading)return; _reloading=true; location.reload(); });
  try{ navigator.serviceWorker.register('./sw.js').then(r=>{ if(r&&r.update) r.update(); }).catch(()=>{}); }catch(e){}
}
