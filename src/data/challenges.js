"use strict";
/* ============================================================
   data/challenges — the three live challenges, and the board.

   What this replaces: joins, entries and votes. A challenge used to be
   a contest you opted into, submitted a pour to, and were ranked in by
   other people's votes — three separate asks before anything happened,
   and a ranking that only means something once there is a crowd to do
   the voting. It shipped behind "Coming soon" and stayed there.

   A challenge is now a rule the database checks against the coffee you
   were already logging (platform/supabase/step-1.17.sql). There is nothing to
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

/* ---------- today's podium: the three most-engaged pours of the day ------ */
/* Live, not a scheduled snapshot: a like moves the podium on the next
   load. The `podium_today` view (step-1.18.sql) carries the author's
   columns inline, so this is one round trip with no embed to disambiguate.

   The day window and the ranking both live in Postgres on purpose. The
   places are announced to their authors as notifications by podium_check(),
   and a board that decided "today" for itself in the browser would sooner
   or later disagree with the notification someone already received —
   different clock, different timezone, different answer. The server is the
   only one that gets to say. */
export async function fetchPodium(myUid=null, { limit=3, blocked=[] }={}){
  /* Blocking has to hold everywhere, not just in the feed: a blocked
     person's pour could otherwise still surface on Explore. This can leave
     the podium short, which is correct — the places belong to the pours,
     not to the slots. */
  let q = `podium_today?select=*&order=place.asc&limit=${limit}`;
  if(blocked.length) q += `&user_id=not.in.(${blocked.map(id=>`"${id}"`).join(',')})`;
  /* No client-side "did this earn its place" filter: podium_top() (step-
     1.18.sql) already only returns pours with positive engagement, and
     engagement now counts comments as well as likes. A pour that reached
     the podium on comments with zero likes is real and must not be
     dropped by a filter that only ever checked like_count. */
  const rows = await rest(q);
  return (rows||[]).map(r=>{
    registerUser(rowToUser({ id:r.user_id, handle:r.handle, name:r.name, city:r.city,
                             avatar_color:r.avatar_color, level:r.level }));
    return {
      id: r.id,
      /* The server's place, not the array index. Blocking can remove the
         pour in front of you, and the medal you see must still be the
         medal its author was told about. */
      place: r.place|0,
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
