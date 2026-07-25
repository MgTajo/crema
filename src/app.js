"use strict";
/* ============================================================
   app — composition root & boot sequence.
   Wires the layers together and starts the app: load persisted
   state, apply identity + theme, paint, then resume onboarding or a
   deep link. Importing ./ui/actions.js registers the global event
   handlers as a side effect.
   ============================================================ */
import { initAuth } from './data/supabase.js';
import { loadReferenceData } from './data/remote.js';
import { fetchPost } from './data/posts.js';
import { useSession, applyMe, findPost, state } from './store/store.js';
import { render } from './ui/views.js';
import { pushOv } from './ui/overlays.js';
import { applyTheme, tick, toast, syncProfile } from './ui/actions.js';

/* ---------- boot ---------- */
/* Restore the session first: it decides which persistence adapter the
   store loads from. Signed out, this resolves to null immediately and
   the app boots exactly as it always has. */
const auth = await initAuth();

/* top-level await: state must be loaded before the first paint, and the
   persistence adapter may be a network one. */
await useSession(auth.session);
applyMe(); applyTheme(); tick(); render();
setInterval(tick,10000);
if(auth.error) toast(auth.error);
if(auth.session) syncProfile().then(render);

/* Reference data refreshes behind the first paint: the bundled arrays are
   already on screen, so this only ever swaps in newer content. */
loadReferenceData().then(src=>{ if(src==='network'||src==='stale-cache') render(); });

if(!state.onboarded){ pushOv({type:'onboard'}); }
else {
  /* ids are seed-style ('p101') locally and uuids once posts are remote */
  const m=location.hash.match(/#p\/([\w-]+)/);
  if(m){
    if(findPost(m[1])) pushOv({type:'post',id:m[1]});
    else if(auth.session) fetchPost(m[1],auth.session.user.id)
      .then(p=>{ if(p){ state.posts.unshift(p); pushOv({type:'post',id:p.id}); } })
      .catch(()=>{});
  }
}
if('serviceWorker' in navigator && (location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname))){
  let _reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(_reloading)return; _reloading=true; location.reload(); });
  try{ navigator.serviceWorker.register('./sw.js').then(r=>{ if(r&&r.update) r.update(); }).catch(()=>{}); }catch(e){}
}
