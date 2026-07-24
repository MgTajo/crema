"use strict";
/* ============================================================
   app — composition root & boot sequence.
   Wires the layers together and starts the app: load persisted
   state, apply identity + theme, paint, then resume onboarding or a
   deep link. Importing ./ui/actions.js registers the global event
   handlers as a side effect.
   ============================================================ */
import { load, applyMe, findPost, state } from './store/store.js';
import { render } from './ui/views.js';
import { pushOv } from './ui/overlays.js';
import { applyTheme, tick } from './ui/actions.js';

/* ---------- boot ---------- */
load(); applyMe(); applyTheme(); tick(); render();
setInterval(tick,10000);
if(!state.onboarded){ pushOv({type:'onboard'}); }
else { const m=location.hash.match(/#p\/(p\d+)/); if(m&&findPost(m[1])) pushOv({type:'post',id:m[1]}); }
if('serviceWorker' in navigator && (location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname))){
  let _reloading=false;
  navigator.serviceWorker.addEventListener('controllerchange',()=>{ if(_reloading)return; _reloading=true; location.reload(); });
  try{ navigator.serviceWorker.register('./sw.js').then(r=>{ if(r&&r.update) r.update(); }).catch(()=>{}); }catch(e){}
}
