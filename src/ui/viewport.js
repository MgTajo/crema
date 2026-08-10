"use strict";
/* ============================================================
   viewport — keeps --app-h equal to the height the app actually has.

   The phone shell is one screen tall and never scrolls: the appbar and
   the tabbar are pinned, and only .view moves. That only holds while the
   shell's height matches the window's. CSS can express this on its own
   (100dvh), but a standalone install — the Android TWA especially —
   comes back from the background with the dynamic viewport measured
   before the system bars have settled, and the stale value sticks until
   something forces a reflow. Too tall, and the appbar and tabbar sit off
   both ends of the glass; a cold boot measures once, correctly, which is
   why restarting "fixes" it.

   So the height is measured in JS, published as --app-h, and re-measured
   on every event that can invalidate it. styles.css keeps 100dvh as the
   fallback for the first paint and for anyone who never gets here.

   window.innerHeight, not visualViewport.height: innerHeight is the
   layout viewport, which the keyboard shrinks (we asked for that with
   interactive-widget=resizes-content) but pinch-zoom does not. Measuring
   the visual viewport instead would resize the whole app under a
   two-finger zoom.
   ============================================================ */

let last = 0;

function measure(){
  const h = window.innerHeight;
  /* Sub-pixel churn during a bar animation would otherwise write the
     custom property on every frame, and each write is a full relayout of
     a flex column. A pixel is the smallest change worth repainting for. */
  if(!h || Math.abs(h - last) < 1) return;
  last = h;
  document.documentElement.style.setProperty('--app-h', h + 'px');
}

/* A resume reports the *old* height for a frame or two while the window
   is still being resized around the system bars — the exact stale read
   this module exists to undo. So a resume measures three times: now, on
   the next frame, and once more after the bar animation has had time to
   finish. measure() is idempotent and bails when nothing moved, so the
   extra passes cost a property read each. */
function remeasure(){
  /* Forget the cached height first. On these paths the shell may be the
     wrong size while innerHeight has never changed — a restored bfcache
     page, or a resume where the window was resized twice and settled back
     — and a measure() that only writes on a *difference* would decide
     there was nothing to do. The rare path is allowed to be the
     unconditional one; it costs a single property write. */
  last = 0;
  measure();
  requestAnimationFrame(measure);
  setTimeout(measure, 300);
}

measure();

window.addEventListener('resize', measure);
window.addEventListener('orientationchange', remeasure);
/* Back/forward cache: the page is restored wholesale, layout and all,
   without a resize if the window happens to match. It often doesn't. */
window.addEventListener('pageshow', remeasure);
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState==='visible') remeasure();
});
/* Chrome resizes the visual viewport for the keyboard and the URL bar
   without always firing window.resize; the handler still reads
   innerHeight, this is only the trigger. */
if(window.visualViewport) window.visualViewport.addEventListener('resize', measure);
