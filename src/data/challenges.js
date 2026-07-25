"use strict";
/* ============================================================
   data/challenges — challenge joins, entries, votes and the weekly
   leaderboard.

   What this replaces: challengeEntries() in ui/overlays.js used to
   invent vote counts from a hash of the post id (`seedOf(id)*7 % 480`)
   and treat every matching pour as an entry. Entering was a local flag.
   Now an entry is a row, a vote is a row, and the leaderboard is a
   table a scheduled job fills — not arithmetic done on read.
   ============================================================ */
import { agoFrom } from '../core/util.js';
import { rest } from './supabase.js';
import { CAFES, registerUser } from './world.js';
import { rowToUser } from './profiles.js';

const countOf = agg => (Array.isArray(agg) && agg.length ? (agg[0].count|0) : 0);
const inList  = ids => `(${ids.map(id=>`"${id}"`).join(',')})`;

/* Name every foreign key: challenge_entries reaches profiles and posts
   by more than one path, and an ambiguous embed is a 300, not a row. */
const ENTRY_SELECT = [
  'id,challenge_id,user_id,post_id,created_at',
  'entry_votes(count)',
  'posts!challenge_entries_post_id_fkey(id,drink,art,pattern,quality,image_key,caption,cafe_id,created_at)',
  'profiles!challenge_entries_user_id_fkey(id,handle,name,city,avatar_color,level)'
].join(',');

/* ---------- joins ---------- */
export async function fetchMyJoins(uid){
  const rows = await rest(`challenge_joins?select=challenge_id&user_id=eq.${uid}`);
  return (rows||[]).map(r=>r.challenge_id);
}
/* challenge_id → participant count. The `participants` column in the
   challenges table is editorial; this is the real number. */
export async function fetchJoinCounts(){
  const rows = await rest('challenge_joins?select=challenge_id&limit=5000');
  const out={}; (rows||[]).forEach(r=>{ out[r.challenge_id]=(out[r.challenge_id]||0)+1; });
  return out;
}
export const joinChallenge  = (uid,id) => rest('challenge_joins',{ method:'POST', body:{ user_id:uid, challenge_id:id } });
export const leaveChallenge = (uid,id) => rest(`challenge_joins?user_id=eq.${uid}&challenge_id=eq.${id}`,{ method:'DELETE' });

/* ---------- entries ---------- */
export function entryOf(row, myUid){
  if(row.profiles) registerUser(rowToUser(row.profiles));
  const src = row.posts || {};
  const cafe = src.cafe_id ? CAFES.find(c=>c.id===src.cafe_id) : null;
  return {
    id: row.id,
    challengeId: row.challenge_id,
    votes: countOf(row.entry_votes),
    mine: row.user_id===myUid,
    votedByMe: false,
    p: {
      id: src.id,
      user: row.user_id===myUid ? 'me' : row.user_id,
      drink: src.drink, art: !!src.art, pattern: src.pattern||null,
      quality: src.quality==null ? null : Number(src.quality),
      img: src.image_key || null, caption: src.caption || '',
      cafe: cafe ? cafe.name : undefined,
      createdAt: src.created_at, ago: agoFrom(src.created_at),
      likes:0, likedByMe:false, saved:false, comments:[]
    }
  };
}

export async function fetchEntries(challengeId, myUid){
  const rows = await rest(`challenge_entries?select=${ENTRY_SELECT}&challenge_id=eq.${challengeId}`);
  const list = (rows||[]).map(r=>entryOf(r,myUid));
  return list.sort((a,b)=>b.votes-a.votes);
}

export async function submitEntry(uid, challengeId, postId){
  const rows = await rest('challenge_entries',{ method:'POST', prefer:'return=representation',
    body:{ challenge_id:challengeId, user_id:uid, post_id:postId } });
  return rows && rows[0];
}
export const withdrawEntry = (uid,challengeId) =>
  rest(`challenge_entries?user_id=eq.${uid}&challenge_id=eq.${challengeId}`,{ method:'DELETE' });

/* ---------- votes ---------- */
export async function fetchMyVotes(entryIds){
  if(!entryIds.length) return [];
  const rows = await rest(`entry_votes?select=entry_id&entry_id=in.${inList(entryIds)}`);
  return (rows||[]).map(r=>r.entry_id);
}
export const voteEntry   = (uid,entryId) => rest('entry_votes',{ method:'POST', body:{ user_id:uid, entry_id:entryId } });
export const unvoteEntry = (uid,entryId) => rest(`entry_votes?user_id=eq.${uid}&entry_id=eq.${entryId}`,{ method:'DELETE' });

/* ---------- the board: pours ranked by likes ---------- */
/* Live, not a scheduled snapshot: a like moves the board on the next
   load. The `top_posts` view (step-1.9.sql) carries the author's columns
   inline, so this is one round trip with no embed to disambiguate.

   Swap in a time window whenever the board wants to reset weekly — add
   `&created_at=gte.<monday>` and nothing else changes. */
export async function fetchTopPosts(myUid=null, { limit=50 }={}){
  const rows = await rest(`top_posts?select=*&order=like_count.desc,created_at.desc&limit=${limit}`);
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
