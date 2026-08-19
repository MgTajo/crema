"use strict";
/* ============================================================
   core/announce — "you have already been told this once".

   A one-shot flag per announcement, per browser. Nothing else: no
   scheduling, no copy, no DOM. ui/overlays.js owns what a card says and
   app.js owns when it is raised.

   Why this is not in the store blob. `state` is persisted under a key
   scoped to the signed-in user (store/persistence.js), and it is wiped
   on sign-out — so a flag kept there would show the same card again to
   the second account on a shared laptop, and again to anybody who
   signed out and back in. "Once per device" has to be stored the way
   the language preference is: one flat localStorage key, outside the
   session, below every layer. See i18n.js, which has the same shape for
   the same reason.

   Keyed by the announcement, not by a version number. A release does
   not reset anybody's history, and adding the next card is adding the
   next id — never bumping a counter that would re-show the last one.

   A browser with storage disabled reads false and writes nothing, so
   the card is shown on every open rather than never. That is the right
   way round: the failure that shows a dismissible card twice is smaller
   than the one that silently swallows the only time anybody is told a
   feature exists.
   ============================================================ */

const KEY = 'crema.seen';

/* Every announcement Crema has ever made, oldest first. The ids are
   permanent — one is only ever appended, never renamed, or the card it
   names comes back for everybody who already dismissed it.

   FIRST_POUR_BONUS is spent and nothing raises it any more. It is kept
   here rather than deleted because the key it wrote is still sitting in
   people's browsers, and the list is the only record of what that key
   means. It described a +20 for your OWN first pour of the day; a day
   later that became a race for a single daily +20 (step-1.31), which is
   a different promise to the same people — so it is a NEW announcement
   with a new id rather than an edit to the old copy. Anybody who
   dismissed the first card sees the corrected one once. */
export const FIRST_POUR_BONUS = 'first-pour-bonus';   // superseded 2026-08-19
export const DAILY_CHAMPION   = 'daily-champion';

export function seen(id){
  try{ return localStorage.getItem(`${KEY}.${id}`) === '1'; }catch(e){ return false; }
}

export function markSeen(id){
  try{ localStorage.setItem(`${KEY}.${id}`, '1'); }catch(e){ /* private mode, quota */ }
}
