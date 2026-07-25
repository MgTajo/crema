"use strict";
/* ============================================================
   data/posts — posts as granular API calls, not one state blob.

   The mapping between a `posts` row and the shape ui/ already renders
   lives here and nowhere else. Selectors in the store keep their names,
   so no view changed when this landed:

     feedPosts()   → GET /posts?…                (paginated, newest first)
     myPosts()     → GET /posts?user_id=eq.me
     submitPost()  → POST /posts
     findPost(id)  → GET /posts?id=eq.…

   Likes, saves and comments are their own tables with their own
   modules (data/social.js); the counts here come from PostgREST
   aggregates over them.
   ============================================================ */
import { FEED_PAGE } from '../config.js';
import { agoFrom } from '../core/util.js';
import { rest } from './supabase.js';
import { CAFES, registerUser } from './world.js';
import { rowToUser } from './profiles.js';

const COLS = 'id,user_id,drink,art,pattern,quality,image_key,caption,cafe_id,recipe,created_at';
/* The author embed MUST name the foreign key. posts↔profiles is reachable
   both directly (posts.user_id) and many-to-many via likes/saves/comments,
   so a bare `profiles(...)` is ambiguous and PostgREST answers 300. */
const AUTHOR = 'profiles!posts_user_id_fkey(id,handle,name,city,bio,avatar_color,level)';
/* Counts come from PostgREST's aggregate embedding rather than counter
   columns — views/aggregates first, denormalize only if it measurably
   hurts. Which posts *you* liked or saved is a separate query, because
   it changes per viewer and would bust any shared cache. */
const COUNTS = 'likes(count),comments(count)';
const SELECT = `${COLS},${AUTHOR},${COUNTS}`;

const countOf = agg => (Array.isArray(agg) && agg.length ? (agg[0].count|0) : 0);

/* ---------- row → the app's post shape ---------- */
export function postOf(row, myUid){
  if(row.profiles) registerUser(rowToUser(row.profiles));
  const cafe = row.cafe_id ? CAFES.find(c=>c.id===row.cafe_id) : null;
  return {
    id: row.id,
    /* the app has always addressed the local user as 'me'; keep that so
       ownership checks, myPosts() and the profile grid keep working */
    user: row.user_id===myUid ? 'me' : row.user_id,
    drink: row.drink,
    art: !!row.art,
    pattern: row.pattern || null,
    quality: row.quality==null ? null : Number(row.quality),
    img: row.image_key || null,        // becomes a CDN URL in step 1.6
    caption: row.caption || '',
    cafe: cafe ? cafe.name : undefined,
    recipe: row.recipe || null,
    createdAt: row.created_at,
    ago: agoFrom(row.created_at),
    likes: countOf(row.likes),
    commentN: countOf(row.comments),   // the full thread loads when the post opens
    likedByMe: false, saved: false, comments: []
  };
}

/* ---------- the app's post shape → an insert row ---------- */
export function rowOf(p, uid){
  const cafe = p.cafe ? CAFES.find(c=>c.name===p.cafe) : null;
  return {
    id: p.id,                          // client-generated uuid: keeps ids stable
    user_id: uid,
    drink: p.drink,
    art: !!p.art,
    pattern: p.pattern || null,
    quality: p.quality==null ? null : p.quality,
    image_key: p.img || null,
    caption: p.caption || null,
    cafe_id: cafe ? cafe.id : null,
    recipe: p.recipe || null
  };
}

export const newPostId = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
        const r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }));

/* ---------- reads ---------- */
/* Newest first, keyset-paginated on created_at. `before` is the
   created_at of the last row you already have. */
export async function fetchFeed({ before=null, limit=FEED_PAGE, myUid=null, authors=null, blocked=null }={}){
  const list = ids => `(${ids.map(id=>`"${id}"`).join(',')})`;
  let q = `posts?select=${SELECT}&order=created_at.desc&limit=${limit}`;
  if(before) q += `&created_at=lt.${encodeURIComponent(before)}`;
  /* the Following tab filters server-side, so pagination stays correct */
  if(authors) q += `&user_id=in.${list(authors)}`;
  if(blocked && blocked.length) q += `&user_id=not.in.${list(blocked)}`;
  const rows = await rest(q);
  return (rows||[]).map(r=>postOf(r,myUid));
}

export async function fetchMine(uid, { limit=100 }={}){
  const rows = await rest(`posts?select=${SELECT}&user_id=eq.${uid}&order=created_at.desc&limit=${limit}`);
  return (rows||[]).map(r=>postOf(r,uid));
}

export async function fetchPost(id, myUid=null){
  const rows = await rest(`posts?select=${SELECT}&id=eq.${id}&limit=1`);
  return rows && rows.length ? postOf(rows[0],myUid) : null;
}

/* ---------- writes ---------- */
export async function createPost(p, uid){
  const rows = await rest('posts',{ method:'POST', prefer:'return=representation', body:rowOf(p,uid) });
  return rows && rows.length ? postOf(rows[0],uid) : null;
}

export async function deletePost(id){
  return rest(`posts?id=eq.${id}`,{ method:'DELETE' });
}
