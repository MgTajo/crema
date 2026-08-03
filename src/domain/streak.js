"use strict";
/* ============================================================
   domain/streak — how many days in a row, and is it about to end.

   Pure: everything here takes a set of day-indices (0 = today, 1 =
   yesterday, …) and returns numbers. No state, no DOM, no clock beyond
   the one that produced the indices — so the same rules run unchanged
   in a React Native app, or in Postgres if the reminder job ever needs
   to agree with the client (it does — see platform/supabase/step-1.16.sql).

   Two rules, and they are the whole feature:

   1. A streak is consecutive days on which you logged at least one
      pour, counted up to today or up to yesterday. Not-yet-poured
      today does not break it — you haven't had your coffee yet.

   2. A REST DAY. Once a streak has reached REST_AFTER days, a single
      missed day is forgiven, once per streak. This is not generosity
      for its own sake: losing a 40-day streak to one hotel morning is
      the moment people quit an app like this, and a streak nobody
      believes they can keep is not a habit, it's a countdown. One
      forgiven day keeps the number honest — you did pour on all those
      other days — while removing the cliff.

   Rest days are DERIVED, never stored, in keeping with the rest of
   Crema's counts: replay the same pours and you get the same streak.
   ============================================================ */

/* A streak must reach this many days before a missed day is forgiven.
   Below it, a break is just a break — a 2-day streak that skips a day
   was never a habit, and forgiving it would make the number meaningless. */
export const REST_AFTER = 7;

/* Consecutive pour days from `d` going back in time, no allowances.
   This is what decides whether a gap has a week behind it. */
function plainRun(days, d){
  let n = 0;
  while(days.has(d)){ n++; d++; }
  return n;
}

/* Walk back from `start`, counting days present in `days`, allowing one
   gap when a week's habit sits on either side of it. Returns the run
   length in days (the rest day included — you kept the habit, not the
   calendar) and whether the allowance was spent.

   Note the direction: index 0 is today, so `d + 1` is *older*. The week
   that earns the rest is therefore usually the run on the far side of
   the gap, not the days walked so far — someone who pours for a month,
   misses one morning, then pours today has walked exactly one day when
   the gap is reached. Both sides count.

   The look-ahead deliberately uses plainRun() and not this function: a
   recursive check would let each forgiven gap earn the next one, and a
   pour every other day forever would read as an unbroken streak. One
   rest, once, is the rule.

   A gap is only ever forgiven if a pour day sits on the older side of
   it — two blank days in a row end the streak no matter how long it
   was, because that is a stop, not a rest. */
function runFrom(days, start){
  let n = 0, rested = false, d = start;
  for(;;){
    if(days.has(d)){ n++; d++; continue; }
    if(!rested && days.has(d + 1)
       && (n >= REST_AFTER || plainRun(days, d + 1) >= REST_AFTER)){
      rested = true; n++; d++; continue;
    }
    return { n, rested };
  }
}

/* The live streak, from a set of day-indices.

   Returns:
     days      the streak length, 0 if there isn't one
     poured    did they already pour today
     atRisk    a real streak that ends tonight unless they pour
     rested    the rest day has been spent in this streak
     canRest   this streak is long enough that a miss would be forgiven
*/
export function streakFrom(days){
  const poured = days.has(0);
  if(!days.size) return { days:0, poured:false, atRisk:false, rested:false, canRest:false };

  const start = poured ? 0 : (days.has(1) ? 1 : -1);
  if(start < 0){
    /* Nothing today and nothing yesterday. The streak can only still be
       alive if it earned a rest day and is spending it on yesterday —
       in which case today is the last chance to come back, and the
       allowance is gone. */
    const older = runFrom(days, 2);
    return older.n >= REST_AFTER && !older.rested
      ? { days:older.n, poured:false, atRisk:true, rested:true, canRest:false }
      : { days:0, poured:false, atRisk:false, rested:false, canRest:false };
  }

  const { n, rested } = runFrom(days, start);
  return {
    days: n,
    poured,
    atRisk: !poured && n > 0,
    rested,
    canRest: !rested && n >= REST_AFTER
  };
}

/* The longest run this person has ever had, for the "personal best" the
   live streak is chased against. Same rules, applied at every day they
   poured — a past streak that used its rest day still counts as the run
   it was. */
export function bestStreakFrom(days){
  let best = 0;
  days.forEach(d => {
    /* runFrom() walks *backwards in time* (index 0 is today, so d+1 is
       older). A run therefore starts at the most recent day of a block:
       the days where d-1 is absent. Every rest-day-merged run is still
       found, because the day on the far side of a forgiven gap is itself
       a block head and its run swallows the block below it. */
    if(days.has(d - 1)) return;
    const { n } = runFrom(days, d);
    if(n > best) best = n;
  });
  return best;
}
