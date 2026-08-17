"use strict";
/* ============================================================
   data/recap — where your week stands, among everyone else's.

   One number on the week card cannot be worked out in the browser: how
   your week's pour count compares with every other account's over the
   same seven days. That is a count across every account, and the
   client can see exactly one.

   (The card's other server-shaped number, likes and comments, turned
   out not to need a trip here at all — postOf() embeds both straight
   off the `posts` row for every fetch, including fetchMine(), so the
   store already has them without asking.)

   week_standing() takes the window as two timestamps rather than
   working the week out itself: the browser already decided which week
   the card is about, in the user's own timezone, and a server that
   recomputed it from UTC would sooner or later draw a card for a
   different seven days than the one printed across the top of it.

   The function reads auth.uid() inside Postgres, so there is no user id
   to pass and no way to aim it at somebody else. It returns aggregates
   only — a count of people and a count of pours, never a row.

   Never throws. Every caller is drawing a card that is already complete
   without this; a standing that did not arrive is a tile the card fills
   with something else, not an error anybody needs to see.
   ============================================================ */
import { rest } from './supabase.js';

/* ---------- one row when a card actually leaves the device ----------
   The weekly card is the growth loop, and until step-1.26.sql nothing
   counted whether anyone ever exported one — which made the whole
   weekly-versus-daily question unfalsifiable (brain/09-red-team.md,
   risk 5). This is the counter, and it is the whole of it: who, which
   week, and whether the file went to the share sheet or to disk.

   `weekKey` is the Monday the card is about, in the user's own
   timezone, because the browser already decided which seven days the
   card covers and a server recomputing it from UTC would sooner or
   later count a different week than the one printed on the card.

   Never throws and never awaited by the caller: the card has already
   been shared by the time this runs, and a counter that can break a
   share is worse than no counter. An unrun migration answers 404 and
   the app carries on knowing nothing, which is where it started. */
export function logRecapExport(uid, weekKey, kind='share'){
  if(!uid || !weekKey) return Promise.resolve();
  return rest('recap_exports',{ method:'POST', body:{
    /* Sent rather than inferred, because the row's policy is
       `auth.uid() = user_id`: the id is checked against the token, so
       naming somebody else here fails rather than mislabels. */
    user_id: uid,
    week_start: weekKey,
    kind: kind==='download' ? 'download' : 'share'
  }}).catch(()=>{});
}

export async function fetchWeekStanding(from, to){
  try{
    const rows=await rest('rpc/week_standing',{ method:'POST', body:{
      /* Inclusive of the whole last day: the window the store hands
         over is midnight-to-midnight of the first and last day, and the
         Sunday belongs to the week. */
      from_ts: from.toISOString(),
      to_ts:   new Date(to.getTime()+864e5).toISOString()
    }});
    const r=(rows&&rows[0])||null;
    if(!r) return null;
    return {
      drinkers: r.drinkers|0,
      pours:    r.pours|0,
      /* null is a real answer and means "not enough of a crowd to place
         you in" — the card must not read that as 0%. */
      aheadPct: r.ahead_pct==null?null:r.ahead_pct|0
    };
  }catch(e){
    console.warn('week standing unavailable — run platform/supabase/step-1.22.sql',e);
    return null;
  }
}
