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

export function computeBadges(){
  const mine=myPosts(), n=mine.length, pats=p=>mine.filter(x=>x.pattern===p).length;
  const beansN=myBeans().length;
  const origins=myCountries().length;
  return [
    {i:'☕',n:'First pour',d:'Post your first coffee',e:n>0},
    {i:'🔥',n:'Week streak',d:'7 days of coffee in a row',e:streak()>=7},
    {i:'🌿',n:'Rosetta groove',d:'Post 5 rosettas',e:pats('rosetta')>=5,p:Math.min(pats('rosetta'),5)+'/5'},
    {i:'🌷',n:'Tulip time',d:'Post your first tulip',e:pats('tulip')>=1},
    {i:'🦢',n:'Swan whisperer',d:'Post a swan',e:pats('swan')>=1,p:pats('swan')+'/1'},
    {i:'🫘',n:'Bean explorer',d:'Log 7 different beans',e:beansN>=7,p:Math.min(beansN,7)+'/7'},
    {i:'🌍',n:'World tour',d:'Try coffees from 5 origins',e:origins>=5,p:Math.min(origins,5)+'/5'},
    {i:'🧊',n:'Cold brew curious',d:'Post a cold brew',e:mine.some(p=>p.drink==='Cold brew')},
    /* Joining is no longer a thing you can do (step 1.17), so this is
       what it always should have been: finishing one. `wins` counts
       completion rows, which outlive the week they were earned in. */
    {i:'🎯',n:'Challenger',d:'Finish a challenge',e:challenges.wins>0},
    {i:'🏆',n:'Regular winner',d:'Finish 10 challenges',e:challenges.wins>=10,p:Math.min(challenges.wins,10)+'/10'},
    {i:'💯',n:'Century club',d:'Log 100 pours',e:n>=100,p:n+'/100'}];
}
