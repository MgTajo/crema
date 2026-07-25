"use strict";
/* ============================================================
   data/world — the shared world: people, cafés, challenges and the
   weekly leaderboard.

   Nothing in here is invented. Every array starts EMPTY and is filled
   from Postgres:

     USERS       ← profiles rows, via registerUser() (see data/profiles)
     CAFES       ← cafes table        (data/remote)
     CHALLENGES  ← challenges table   (data/remote)
     LEADERBOARD ← leaderboard_weekly (data/challenges)

   The arrays are exported as live bindings and refilled IN PLACE, so
   every module that already did `import { CAFES }` keeps working — the
   array identity never changes.

   USERS.me is the one entry that exists before any network call: it is
   the signed-in user's own row, mirrored from state.me by the store's
   applyMe() so views can look themselves up like anyone else.
   ============================================================ */

/* ---------- people ---------- */
export const USERS={
  me:{id:'me',name:'You',handle:'@you',color:'#8a5a30',level:1,levelName:'First Sips',city:'',followerN:0,pourN:0,bio:''}
};

/* handle → user id (mutated by the store's applyMe when the user renames) */
export const handleToUid={ you:'me' };

/* Authors that arrive with remote rows join the same map, keyed by their
   auth uuid. Everything in ui/ looks people up through USERS, so a
   remote profile renders exactly like the local one. */
export function registerUser(u){
  if(!u||!u.id) return null;
  USERS[u.id]=Object.assign({followerN:0,pourN:0,bio:'',city:'',level:1},USERS[u.id],u);
  if(u.handle) handleToUid[u.handle.replace(/^@/,'')]=u.id;
  return USERS[u.id];
}

/* Someone we have a row for but no profile — a deleted account, or an
   embed that failed. Views must still render, and must not pretend to
   know who it was. */
export const userOf = uid => USERS[uid] || {
  id:uid, name:'Someone', handle:'@unknown', color:'#8d8378',
  level:1, levelName:'First Sips', city:'', followerN:0, pourN:0, bio:''
};

/* ---------- reference data, filled by data/remote.js ---------- */
export const CAFES=[];
export const CHALLENGES=[];

/* ---------- the board: pours ranked by likes, filled by
   data/challenges.js fetchTopPosts(). Holds posts, not people. ---------- */
export const TOP_POSTS=[];
