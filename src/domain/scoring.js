"use strict";
/* ============================================================
   domain/scoring — progression & badge rules.

   Points and levels are computed in Postgres (platform/supabase/step-1.9.sql)
   and ride along on the profile row. Everything here presents that
   number: which level a score sits in, and how far the next one is.
   LEVELS is the shared curve.

   What used to live here: scoreFromQ(), which turned a post's `quality`
   into a 0–10 "art score". The client wrote a hardcoded quality of 0.85
   on every art pour, so that score was the same number for everyone —
   and it was never rendered. Judging a pour needs something that can
   actually see it (roadmap, "what comes after"), so nothing pretends to.
   ============================================================ */
import { LEVELS } from '../data/catalog.js';
import { state, myPosts, myBeans, myCountries, streak, challenges } from '../store/store.js';

/* The level a score sits in, as [level, name, threshold]. */
export function levelOf(points){
  const p=points|0;
  let cur=LEVELS[0];
  LEVELS.forEach(l=>{ if(p>=l[2]) cur=l; });
  return cur;
}
/* The next level up, or null at the top of the ladder. */
export const nextLevel = points => LEVELS.find(l=>l[2]>(points|0)) || null;

/* How far through the current level a score is, 0–1, for the bar. */
export function levelProgress(points){
  const p=points|0, cur=levelOf(p), next=nextLevel(p);
  if(!next) return 1;
  const span=next[2]-cur[2];
  return span>0 ? Math.min(1,Math.max(0,(p-cur[2])/span)) : 0;
}
export const levelName = n => (LEVELS.find(l=>l[0]===n)||LEVELS[0])[1];

/* What things are worth, mirrored from user_points() in step-1.14.sql.
   Shown on the levels screen so the rules are visible, not folklore —
   which also means this list has to stay honest: if the SQL changes and
   this doesn't, the app is lying about how it scores people.

   Every line is something you did with coffee, or something a real
   person did in response to it. Nothing pays for using the app. */
export const POINT_RULES=[
  ['Log a coffee','+10'],
  /* step-1.31, and it is a RACE: exactly one pour a day earns this — the
     first one logged in all of Crema, on the Berlin clock the podium
     already uses. step-1.30 paid it to everybody for their own first
     pour, which is an allowance rather than a reward: everyone collects
     it, every day, for what they were going to do anyway. A thing you
     can lose is the only kind you can win. Must match
     crema_first_pour_points() in platform/supabase/step-1.30.sql, which
     step-1.31 leaves in place as the value. */
  ['First coffee in Crema today','+20'],
  ['A bean you\'ve never logged','+15'],
  ['An exact recipe · dose in, yield out','+5'],
  ['Someone comments on your pour','+3'],
  ['Someone likes your pour','+2'],
  /* Not the podium's own ranking math — that weighs a like and a comment
     equally, 1 point each, purely to decide who's in 1st/2nd/3rd for the
     day (platform/supabase/step-1.18.sql, podium_top()). This is the separate
     payout once a day is over: three rows, one per place, added by
     user_points() the same way a finished challenge is. */
  ['1st place on today\'s podium','+15'],
  ['2nd place on today\'s podium','+10'],
  ['3rd place on today\'s podium','+5']
];

/* ------------------------------------------------------------
   Badges.

   `id` is new and is the load-bearing part of it. Until 2026-09-05 a
   badge was an object with a name and a boolean, computed on the device
   of the person who earned it and rendered on one tab of their own
   profile — which made it a private checklist. Nobody else could see
   one, which is why nobody looked at their own.

   They are stored now, on `profiles.badges`, and that column is a list
   of these ids. So an id is a name in the database and must NEVER be
   changed once it has shipped: renaming one silently un-earns it for
   everybody who has it. The English `n` and `d` are display strings and
   are free to be reworded, and both go through t().

   `have`/`need` replace the old `p:'3/7'` string. A number the caller
   can compare is what makes "the one you are closest to" possible —
   see nextBadge() below, which is the whole engagement idea: not
   eleven things you have not done, one you nearly have.

   ⚠️ Badges deliberately pay NO points and unlock NOTHING. They are not
   in POINT_RULES and they are not in user_points(). That is what keeps
   them a side feature rather than a second scoring system competing
   with the one the server owns, and it is also why it is safe for the
   client to write them — see the header of
   migrations/20260905090000_badges_are_public.sql.
   ------------------------------------------------------------ */
/* WHAT a badge is: id, glyph, name, description, and how many of the
   thing it takes. Deliberately free of any reference to the store, so
   that rendering SOMEBODY ELSE'S badges — the whole point of the change
   — needs nothing but their profile row. badgeStrip() in ui/components.js
   is the caller that depends on this being pure. */
export const BADGES = [
  {id:'first-pour',     i:'☕',n:'First pour',        d:'Post your first coffee',     need:1},
  {id:'week-streak',    i:'🔥',n:'Week streak',       d:'7 days of coffee in a row',  need:7},
  {id:'rosetta-groove', i:'🌿',n:'Rosetta groove',    d:'Post 5 rosettas',            need:5},
  {id:'tulip-time',     i:'🌷',n:'Tulip time',        d:'Post your first tulip',      need:1},
  {id:'swan-whisperer', i:'🦢',n:'Swan whisperer',    d:'Post a swan',                need:1},
  {id:'bean-explorer',  i:'🫘',n:'Bean explorer',     d:'Log 7 different beans',      need:7},
  {id:'world-tour',     i:'🌍',n:'World tour',        d:'Try coffees from 5 origins', need:5},
  {id:'cold-brew',      i:'🧊',n:'Cold brew curious', d:'Post a cold brew',           need:1},
  /* Joining is no longer a thing you can do (step 1.17), so this is
     what it always should have been: finishing one. `wins` counts
     completion rows, which outlive the week they were earned in. */
  {id:'challenger',     i:'🎯',n:'Challenger',        d:'Finish a challenge',         need:1},
  {id:'regular-winner', i:'🏆',n:'Regular winner',    d:'Finish 10 challenges',       need:10},
  {id:'century-club',   i:'💯',n:'Century club',      d:'Log 100 pours',              need:100},
];

/* HOW FAR the signed-in person is on each. Reads the store, so it only
   ever answers about them — which is why it is a separate function from
   the list above rather than a field on it. */
export function badgeList(){
  const mine=myPosts(), n=mine.length, pats=p=>mine.filter(x=>x.pattern===p).length;
  const HAVE = {
    'first-pour':n, 'week-streak':streak(),
    'rosetta-groove':pats('rosetta'), 'tulip-time':pats('tulip'), 'swan-whisperer':pats('swan'),
    'bean-explorer':myBeans().length, 'world-tour':myCountries().length,
    'cold-brew':mine.filter(p=>p.drink==='Cold brew').length,
    'challenger':challenges.wins, 'regular-winner':challenges.wins,
    'century-club':n,
  };
  return BADGES.map(b => Object.assign({}, b, { have: HAVE[b.id]|0 }));
}

/* The same list with `e` (earned) and `p` (the '3/7' label) filled in,
   which is the shape every renderer already expects. A badge needing
   one of something shows no counter — "0/1" is not progress, it is the
   description again. */
export function computeBadges(){
  return badgeList().map(b => {
    const have = Math.min(b.have|0, b.need);
    return Object.assign({}, b, {
      e: (b.have|0) >= b.need,
      p: b.need > 1 ? have + '/' + b.need : ''
    });
  });
}

/* Just the ids, for the profile row. Sorted so a re-order in the list
   above cannot make an unchanged set look changed and cause a write. */
export const earnedBadgeIds = () =>
  computeBadges().filter(b=>b.e).map(b=>b.id).sort();

/* ------------------------------------------------------------
   The one you are closest to.

   This is the engagement half of badges and it is deliberately ONE.
   A grid of eleven locked things is a list of ways you have fallen
   short; a single named next one is an idea for tomorrow morning.

   Closest by fraction rather than by remainder, so "5 of 7 beans" beats
   "0 of 1 swan" — the first is somebody already on their way, the
   second is somebody who has not started. Nothing at all is returned
   when they have every badge, and when they have started nothing:
   showing "0/100 pours" to a person on their first day is the app
   telling them how far they are from somewhere they did not ask to go.
   ------------------------------------------------------------ */
export function nextBadge(){
  const open = computeBadges().filter(b=>!b.e && (b.have|0) > 0);
  if(!open.length) return null;
  return open.sort((a,b)=>(b.have/b.need)-(a.have/a.need))[0];
}
