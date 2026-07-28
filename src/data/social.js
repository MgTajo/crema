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

/* Added by step-1.13.sql, run by hand against a live app — see
   optionalColumns() in data/supabase.js. */
const opt = optionalColumns(['avatar_key']);
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
    ago: agoFrom(row.created_at),
    likes: countOf(row.comment_likes),
    likedByMe: false
  };
}

/* ---------- follows ---------- */
export async function fetchMyFollows(uid){
  const rows = await rest(`follows?select=followee_id&follower_id=eq.${uid}`);
  return (rows||[]).map(r=>r.followee_id);
}
export const follow   = (uid,target) => rest('follows',{ method:'POST', body:{ follower_id:uid, followee_id:target } });
export const unfollow = (uid,target) => rest(`follows?follower_id=eq.${uid}&followee_id=eq.${target}`,{ method:'DELETE' });

/* The two follower lists, as profiles. Both sides of `follows` reach
   profiles, so each embed has to name its foreign key. */
const fCard = has => `id,handle,name,city,bio,avatar_color,level${withAvatar(has)}`;
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
  `id,body,created_at,user_id,profiles!comments_user_id_fkey(id,handle,name,avatar_color,level${withAvatar(has)}),comment_likes(count)`;

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
