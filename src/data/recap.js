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
