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
import { rest, optionalColumns } from './supabase.js';
import { CAFES, registerUser } from './world.js';
import { rowToUser } from './profiles.js';

const COLS = 'id,user_id,drink,art,pattern,quality,image_key,caption,cafe_id,recipe,created_at';
/* The author embed MUST name the foreign key. posts↔profiles is reachable
   both directly (posts.user_id) and many-to-many via likes/saves/comments,
   so a bare `profiles(...)` is ambiguous and PostgREST answers 300. */
const author = has => `profiles!posts_user_id_fkey(id,handle,name,city,bio,avatar_color,level${has('avatar_key')?',avatar_key':''})`;
/* Counts come from PostgREST's aggregate embedding rather than counter
   columns — views/aggregates first, denormalize only if it measurably
   hurts. Which posts *you* liked or saved is a separate query, because
   it changes per viewer and would bust any shared cache. */
const COUNTS = 'likes(count),comments(count)';
/* Both optional columns are added by hand-run migrations (step-1.12 and
   step-1.13), so the select has to survive their absence — see
   optionalColumns() in data/supabase.js. */
const opt = optionalColumns(['edited_at','avatar_key']);
const select = has => `${COLS}${has('edited_at')?',edited_at':''},${author(has)},${COUNTS}`;
const q = build => opt.run(has=>build(select(has)));

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
    edited: !!row.edited_at,           // the timestamp itself is never shown; see postCard()
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
  const rows = await q(sel=>{
    let p = `posts?select=${sel}&order=created_at.desc&limit=${limit}`;
    if(before) p += `&created_at=lt.${encodeURIComponent(before)}`;
    /* the Following tab filters server-side, so pagination stays correct */
    if(authors) p += `&user_id=in.${list(authors)}`;
    if(blocked && blocked.length) p += `&user_id=not.in.${list(blocked)}`;
    return p;
  });
  return (rows||[]).map(r=>postOf(r,myUid));
}

/* One person's pours. `myUid` is who is *looking* — pass the viewer, not
   the author, or everyone else's posts come back marked as your own. */
export async function fetchMine(uid, { limit=100, myUid=uid }={}){
  const rows = await q(sel=>`posts?select=${sel}&user_id=eq.${uid}&order=created_at.desc&limit=${limit}`);
  return (rows||[]).map(r=>postOf(r,myUid));
}

/* Your saved collection. The `saves` rows have always existed; nothing
   ever read them back, so the Saved tab could only show saves that
   happened to be on the current feed page. */
export async function fetchSavedPosts(uid, { limit=100 }={}){
  const rows = await rest(`saves?select=post_id&user_id=eq.${uid}&order=created_at.desc&limit=${limit}`);
  const ids = (rows||[]).map(r=>r.post_id);
  if(!ids.length) return [];
  const list = await q(sel=>`posts?select=${sel}&id=in.(${ids.map(i=>`"${i}"`).join(',')})`);
  /* Keep the order the user saved them in, not the order Postgres returned. */
  const byId = new Map((list||[]).map(r=>[r.id, r]));
  return ids.map(id=>byId.get(id)).filter(Boolean).map(r=>{ const p=postOf(r,uid); p.saved=true; return p; });
}

export async function fetchPost(id, myUid=null){
  const rows = await q(sel=>`posts?select=${sel}&id=eq.${id}&limit=1`);
  return rows && rows.length ? postOf(rows[0],myUid) : null;
}

/* ---------- writes ---------- */
export async function createPost(p, uid){
  const rows = await rest('posts',{ method:'POST', prefer:'return=representation', body:rowOf(p,uid) });
  return rows && rows.length ? postOf(rows[0],uid) : null;
}

/* An edit rewrites what the author *said*, never what they shot: the
   photo (`image_key`), the author and the timestamp are deliberately not
   in this list, so a PATCH can't touch them even if the caller asks.
   `edited_at` is stamped by the database trigger, not by the client — a
   client that sets its own marker is a client that can also unset it. */
const EDITABLE = ['drink','art','pattern','cafe_id','caption','recipe'];
export async function updatePost(id, p){
  const full = rowOf(p, null);
  const patch = {};
  EDITABLE.forEach(k=>{ patch[k] = full[k]; });
  const rows = await rest(`posts?id=eq.${id}`,{ method:'PATCH', prefer:'return=representation', body:patch });
  return rows && rows.length ? rows[0] : null;
}

export async function deletePost(id){
  return rest(`posts?id=eq.${id}`,{ method:'DELETE' });
}
