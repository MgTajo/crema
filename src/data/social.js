"use strict";
/* ============================================================
   data/social — follows, likes, saves, comments, reports, blocks.

   These are the highest-traffic writes in the app, and the UI has
   always been optimistic about them: mutate state, repaint, then
   persist. That pattern is unchanged — the call at the end is just a
   network request now, and actions.js reverts on failure.

   Every write is idempotent-ish by construction: the tables are keyed
   on (user_id, target_id), so a double-tap inserts once (409) or
   deletes nothing, and the local state stays authoritative.
   ============================================================ */
import { agoFrom } from '../core/util.js';
import { rest, optionalColumns } from './supabase.js';
import { registerUser } from './world.js';
import { rowToUser } from './profiles.js';

/* Added by hand-run migrations against a live app — see optionalColumns()
   in data/supabase.js. `status` (step-1.15) is kept separate from the
   profile columns because they sit on different tables and land in
   different migrations. */
const opt = optionalColumns(['avatar_key']);
const optFollow = optionalColumns(['status','avatar_key']);
const withAvatar = has => has('avatar_key') ? ',avatar_key' : '';

/* PostgREST needs a quoted, comma-joined list for in.(…) */
const inList = ids => `(${ids.map(id=>`"${id}"`).join(',')})`;
const countOf = agg => (Array.isArray(agg) && agg.length ? (agg[0].count|0) : 0);

/* a comments row → the shape ui/components.js commentRow() renders */
export function commentOf(row, myUid){
  if(row.profiles) registerUser(rowToUser(row.profiles));
  return {
    id: row.id,
    u: row.user_id===myUid ? 'me' : row.user_id,
    t: row.body,
    /* Both: `ago` is the label as it read when the row arrived, `at` is
       what ui/timeago.js recomputes it from a minute later. */
    ago: agoFrom(row.created_at),
    at: row.created_at,
    likes: countOf(row.comment_likes),
    likedByMe: false
  };
}

/* ---------- follows ----------
   A follow is a request until the other person accepts it (step-1.15),
   so "who do I follow" is now two answers, and the UI needs both: an
   accepted follow shows Following, a pending one shows Requested. */
export async function fetchMyFollows(uid){
  return optFollow.run(has=>`follows?select=followee_id${has('status')?',status':''}&follower_id=eq.${uid}`)
    .then(rows=>{
      const accepted=[], pending=[];
      (rows||[]).forEach(r=>{
        /* no status column yet means every follow is a plain follow */
        (r.status==='pending' ? pending : accepted).push(r.followee_id);
      });
      return { accepted, pending };
    });
}

/* People waiting on you, newest first, with enough of their profile to
   render a row without a second round trip. */
export async function fetchFollowRequests(uid){
  if(!optFollow.has('status')) return [];
  const rows = await optFollow.run(has=>
    `follows?select=follower_id,created_at,profiles!follows_follower_id_fkey(${fCard(has)})`
    + `&followee_id=eq.${uid}&status=eq.pending&order=created_at.desc&limit=100`);
  return (rows||[]).map(r=>{
    const u = r.profiles ? registerUser(rowToUser(r.profiles)) : null;
    return u ? { id:u.id, user:u, ago:agoFrom(r.created_at), at:r.created_at } : null;
  }).filter(Boolean);
}

/* Asking. The database refuses anything but 'pending' here, so this is
   the only shape a follow can start in. */
export const follow = (uid,target) => optFollow.run(has=>({
  path:'follows', method:'POST',
  body: has('status') ? { follower_id:uid, followee_id:target, status:'pending' }
                      : { follower_id:uid, followee_id:target } }));

/* Covers unfollowing, withdrawing a request, and — from the other side —
   declining one or removing a follower. One row, one delete. */
export const unfollow = (uid,target) => rest(`follows?follower_id=eq.${uid}&followee_id=eq.${target}`,{ method:'DELETE' });
export const acceptFollow  = (uid,follower) =>
  rest(`follows?follower_id=eq.${follower}&followee_id=eq.${uid}`,{ method:'PATCH', body:{ status:'accepted' } });
export const declineFollow = (uid,follower) =>
  rest(`follows?follower_id=eq.${follower}&followee_id=eq.${uid}`,{ method:'DELETE' });

/* The two follower lists, as profiles. Both sides of `follows` reach
   profiles, so each embed has to name its foreign key. */
const fCard = has => `id,handle,name,city,bio,avatar_color,level,premium${withAvatar(has)}`;
async function followList(build, key){
  const rows = await opt.run(build);
  return (rows||[]).map(r=>r[key]).filter(Boolean).map(p=>registerUser(rowToUser(p)));
}
export const fetchFollowers = uid =>
  followList(has=>`follows?select=profiles!follows_follower_id_fkey(${fCard(has)})&followee_id=eq.${uid}&limit=200`,
             'profiles');
export const fetchFollowing = uid =>
  followList(has=>`follows?select=profiles!follows_followee_id_fkey(${fCard(has)})&follower_id=eq.${uid}&limit=200`,
             'profiles');

/* ---------- likes ---------- */
export async function fetchMyLikes(uid, postIds){
  if(!postIds.length) return [];
  const rows = await rest(`likes?select=post_id&user_id=eq.${uid}&post_id=in.${inList(postIds)}`);
  return (rows||[]).map(r=>r.post_id);
}
export const like   = (uid,postId) => rest('likes',{ method:'POST', body:{ user_id:uid, post_id:postId } });
export const unlike = (uid,postId) => rest(`likes?user_id=eq.${uid}&post_id=eq.${postId}`,{ method:'DELETE' });

/* ---------- saves (RLS already limits these to you) ---------- */
export async function fetchMySaves(postIds){
  if(!postIds.length) return [];
  const rows = await rest(`saves?select=post_id&post_id=in.${inList(postIds)}`);
  return (rows||[]).map(r=>r.post_id);
}
export const savePost   = (uid,postId) => rest('saves',{ method:'POST', body:{ user_id:uid, post_id:postId } });
export const unsavePost = (uid,postId) => rest(`saves?user_id=eq.${uid}&post_id=eq.${postId}`,{ method:'DELETE' });

/* ---------- café follows ---------- */
export async function fetchMyCafeFollows(uid){
  const rows = await rest(`cafe_follows?select=cafe_id&user_id=eq.${uid}`);
  return (rows||[]).map(r=>r.cafe_id);
}
/* cafe_id → follower count, for every café at once. Counted from the
   rows rather than read off a column, so the number is always the truth. */
export async function fetchCafeFollowCounts(){
  const rows = await rest('cafe_follows?select=cafe_id&limit=5000');
  const out={}; (rows||[]).forEach(r=>{ out[r.cafe_id]=(out[r.cafe_id]||0)+1; });
  return out;
}
export const followCafe   = (uid,cafeId) => rest('cafe_follows',{ method:'POST', body:{ user_id:uid, cafe_id:cafeId } });
export const unfollowCafe = (uid,cafeId) => rest(`cafe_follows?user_id=eq.${uid}&cafe_id=eq.${cafeId}`,{ method:'DELETE' });

/* ---------- comments ---------- */
/* Same foreign-key trap as posts: comments reaches profiles directly
   and again through comment_likes, so the embed must name the key. */
const commentSelect = has =>
  `id,body,created_at,user_id,profiles!comments_user_id_fkey(id,handle,name,avatar_color,level,premium${withAvatar(has)}),comment_likes(count)`;

export async function fetchComments(postId){
  return (await opt.run(has=>`comments?select=${commentSelect(has)}&post_id=eq.${postId}&order=created_at.asc`)) || [];
}
export async function addComment(uid, postId, body){
  const rows = await rest('comments',{ method:'POST', prefer:'return=representation',
    body:{ post_id:postId, user_id:uid, body } });
  return rows && rows[0];
}
export const deleteComment = id => rest(`comments?id=eq.${id}`,{ method:'DELETE' });

export const likeComment   = (uid,commentId) => rest('comment_likes',{ method:'POST', body:{ user_id:uid, comment_id:commentId } });
export const unlikeComment = (uid,commentId) => rest(`comment_likes?user_id=eq.${uid}&comment_id=eq.${commentId}`,{ method:'DELETE' });

export async function fetchMyCommentLikes(commentIds){
  if(!commentIds.length) return [];
  const rows = await rest(`comment_likes?select=comment_id&comment_id=in.${inList(commentIds)}`);
  return (rows||[]).map(r=>r.comment_id);
}

/* ---------- moderation ---------- */
/* The Report button used to be a toast that did nothing. */
export function report(uid, { postId=null, commentId=null, userId=null, reason, note=null }){
  return rest('reports',{ method:'POST',
    body:{ reporter_id:uid, post_id:postId, comment_id:commentId, user_id:userId, reason, note } });
}

export async function fetchMyBlocks(uid){
  const rows = await rest(`blocks?select=blocked_id&blocker_id=eq.${uid}`);
  return (rows||[]).map(r=>r.blocked_id);
}
export const block   = (uid,target) => rest('blocks',{ method:'POST', body:{ blocker_id:uid, blocked_id:target } });
export const unblock = (uid,target) => rest(`blocks?blocker_id=eq.${uid}&blocked_id=eq.${target}`,{ method:'DELETE' });
