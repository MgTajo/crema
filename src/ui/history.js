"use strict";
/* ============================================================
   ui/history — the system back button, and the browser's.

   Crema is one page: opening a sheet or switching tabs changes state
   without touching session history, so there was never anything for
   `back` to pop. In a browser tab that only meant back left the app.
   In the Play Store build it meant the Android back gesture CLOSED
   Crema outright — a Trusted Web Activity with no history behind it
   simply finishes the activity.

   The fix is one spare history entry, never more. Whenever the app is
   deeper than its root — any sheet open, or any tab other than the one
   you arrived on — a single entry sits behind it. A back press spends
   that entry, the app steps back one level, and if there is still
   somewhere to go the entry is re-armed at once. At the root there is
   no entry, so back does what it should on Android: leaves.

   One entry rather than a faithful mirror of the whole stack, because a
   mirror drifts. pushState is synchronous and history.back() is not, so
   any of the places that close several sheets at once — posting,
   blocking someone, signing out — would leave the browser pointing at a
   depth the app had already left, and every later back press would be
   off by one. With a single entry there is nothing to keep in step: it
   either exists or it doesn't, and arm() is idempotent either way.
   ============================================================ */

let armed=false;      // is our spare entry currently on the stack?
let dropping=false;   // a history.back() of our own is in flight
let depth=()=>0;      // how deep the app is
let step=()=>false;   // take one step back; false when there is nowhere to go

/* Wired up once, from ui/actions.js — this module deliberately imports
   nothing from ui/, so the store and the renderers stay on one side of
   it and the browser API on the other. */
export function initHistory({ depth:d, step:s }){ depth=d; step=s; arm(); }

/* Call after anything that changes how deep the app is. Idempotent: when
   the entry is already in the right state this does nothing, so callers
   can be generous about invoking it. */
export function arm(){
  if(typeof history==='undefined') return;
  /* A drop is in flight and its own popstate will re-check; pushing now
     would race it. */
  if(dropping) return;
  const deep=depth()>0;
  if(deep && !armed){
    armed=true;
    try{ history.pushState({crema:1},''); }catch(e){ armed=false; }
  }else if(!deep && armed){
    /* Closing the last sheet with the X gives the entry back, so a back
       press at the root leaves the app rather than being swallowed. */
    armed=false; dropping=true;
    try{ history.back(); }catch(e){ dropping=false; }
  }
}

if(typeof addEventListener==='function') addEventListener('popstate',()=>{
  if(dropping){ dropping=false; arm(); return; }   // our own doing; re-check and stop
  armed=false;                                     // the entry has been spent
  if(step()) arm();                                // stepped back — re-arm if still deep
});
