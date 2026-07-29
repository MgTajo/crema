"use strict";
/* ============================================================
   data/challenges — the three live challenges, and the board.

   What this replaces: joins, entries and votes. A challenge used to be
   a contest you opted into, submitted a pour to, and were ranked in by
   other people's votes — three separate asks before anything happened,
   and a ranking that only means something once there is a crowd to do
   the voting. It shipped behind "Coming soon" and stayed there.

   A challenge is now a rule the database checks against the coffee you
   were already logging (supabase/step-1.17.sql). There is nothing to
   join and nothing to submit, so there is nothing here to POST: this
   module only reads.

   `my_challenges()` returns the live set with this user's progress
   already computed, in one round trip. It takes the caller's identity
   from auth.uid() inside Postgres, so there is no user id to pass and
   no way to point it at somebody else.
   ============================================================ */
import { agoFrom } from '../core/util.js';
import { rest } from './supabase.js';
import { CAFES, registerUser } from './world.js';
import { rowToUser } from './profiles.js';

/* ---------- the live three ---------- */
/* `progress` is clamped to the goal for the bar, while `raw` keeps what
   they actually did — ten pours against a goal of five is a full bar and
   still worth saying out loud. `done` is the completion row, which is
   what actually paid out: the client never decides that itself. */
const challengeOf = r => ({
  id: r.id,
  cat: r.cat,
  kind: r.kind,
  goal: r.goal|0,
  param: r.param || null,
  title: r.title,
  blurb: r.blurb,
  tag: r.tag,
  pattern: r.pattern || null,
  points: r.points|0,
  startsAt: r.starts_at,
  endsAt: r.ends_at,
  progress: Math.min(r.progress|0, r.goal|0),
  raw: r.progress|0,
  done: !!r.done
});

export async function fetchChallenges(){
  const rows = await rest('rpc/my_challenges', { method:'POST', body:{} });
  return (rows||[]).map(challengeOf);
}

/* Everything this person has ever finished, newest first. Public data —
   a profile can show someone else's. */
export async function fetchChallengeWins(uid){
  const rows = await rest('rpc/challenge_wins', { method:'POST', body:{ uid } });
  return (rows||[]).map(r=>({
    id:r.id, title:r.title, tag:r.tag, pattern:r.pattern||null,
    points:r.points|0, at:r.completed_at, ago:agoFrom(r.completed_at)
  }));
}

/* ---------- the board: pours ranked by likes ---------- */
/* Live, not a scheduled snapshot: a like moves the board on the next
   load. The `top_posts` view (step-1.9.sql) carries the author's columns
   inline, so this is one round trip with no embed to disambiguate.

   Swap in a time window whenever the board wants to reset weekly — add
   `&created_at=gte.<monday>` and nothing else changes. */
export async function fetchTopPosts(myUid=null, { limit=50, blocked=[] }={}){
  /* Blocking has to hold everywhere, not just in the feed: a blocked
     person's pour could otherwise still surface on Explore. */
  let q = `top_posts?select=*&order=like_count.desc,created_at.desc&limit=${limit}`;
  if(blocked.length) q += `&user_id=not.in.(${blocked.map(id=>`"${id}"`).join(',')})`;
  const rows = await rest(q);
  return (rows||[]).filter(r=>(r.like_count|0)>0).map(r=>{
    registerUser(rowToUser({ id:r.user_id, handle:r.handle, name:r.name, city:r.city,
                             avatar_color:r.avatar_color, level:r.level }));
    return {
      id: r.id,
      user: r.user_id===myUid ? 'me' : r.user_id,
      drink: r.drink, art: !!r.art, pattern: r.pattern||null,
      quality: r.quality==null ? null : Number(r.quality),
      img: r.image_key || null, caption: r.caption || '',
      cafe: r.cafe_id ? (CAFES.find(c=>c.id===r.cafe_id)||{}).name : undefined,
      recipe: r.recipe || null,
      createdAt: r.created_at, ago: agoFrom(r.created_at),
      likes: r.like_count|0, commentN: r.comment_count|0,
      likedByMe:false, saved:false, comments:[]
    };
  });
}
