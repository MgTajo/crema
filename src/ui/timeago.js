"use strict";
/* ============================================================
   ui/timeago — relative timestamps that keep moving.

   "4m" used to be computed once, in data/posts.js postOf(), at the
   moment the row was fetched, and then written into the markup and
   never touched again. A feed left open through a second cup therefore
   read exactly as it had on arrival: every pour four minutes old,
   forever, until someone reloaded the app.

   Realtime made that worse rather than better. A friend's pour now
   slides in on its own — above five cards whose clocks stopped.

   Two halves:

     agoTag()   the label, wrapped in a span that keeps the timestamp it
                was computed from
     the ticker walks those spans and rewrites the ones whose label has
                moved on

   Text and nothing else. No card is rebuilt, so a photo doesn't blink,
   a half-typed comment survives, and the reader's scroll position is
   where they left it — which is the whole reason this patches in place
   rather than repainting the view on a timer. Same rule ui/actions.js
   follows for likes and reactions: never move what a thumb is on.

   The granularity is agoFrom()'s, and it is coarse on purpose above the
   first hour — exact minutes while a pour is fresh, because "now" and
   "twenty minutes ago" are two different mornings, then whole hours,
   then days. So half a minute of drift is invisible below the hour and
   literally unobservable above it, and 30s is a generous tick.
   ============================================================ */
import { $$, agoFrom, esc } from '../core/util.js';

const TICK_MS = 30000;

/* One relative label.

   `iso` is the raw timestamp. `fallback` is what to say without one — a
   comment of your own that hasn't come back from the server yet has no
   created_at, and 'now' is both true and the last thing that row will
   ever need to say. A fallback renders as plain text with no tag, which
   is correct: there is nothing to recompute it from, so nothing should
   pretend it will change. */
export function agoTag(iso, fallback){
  if(!isFinite(Date.parse(iso))) return esc(fallback==null?'':fallback);
  return `<span class="ago" data-ago="${esc(iso)}">${esc(agoFrom(iso))}</span>`;
}

/* Rewrite every label that has moved on. Compared before it is written:
   an unchanged node is left alone, so a tick during a selection or a
   CSS transition replaces nothing for nothing — and on a quiet minute
   the whole pass touches the DOM zero times. */
export function tickAgo(root){
  $$('[data-ago]', root || document).forEach(el=>{
    const next=agoFrom(el.dataset.ago);
    if(el.textContent!==next) el.textContent=next;
  });
}

/* Only while the tab is on screen. The labels are derived from the
   timestamp rather than counted up, so a tab hidden for an hour is not
   behind — it is correct the moment it comes back, which is what the
   visibilitychange tick is for. */
let timer=null;
export function startAgoTicker(){
  if(timer) return;
  timer=setInterval(()=>{ if(document.visibilityState==='visible') tickAgo(); }, TICK_MS);
  document.addEventListener('visibilitychange',()=>{
    if(document.visibilityState==='visible') tickAgo();
  });
}
