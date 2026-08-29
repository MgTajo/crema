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
import { noReactions } from './reactions.js';

const COLS = 'id,user_id,drink,art,pattern,quality,image_key,caption,cafe_id,recipe,created_at';
/* The author embed MUST name the foreign key. posts↔profiles is reachable
   both directly (posts.user_id) and many-to-many via likes/saves/comments,
   so a bare `profiles(...)` is ambiguous and PostgREST answers 300. */
const AUTHOR = 'profiles!posts_user_id_fkey(id,handle,name,city,bio,avatar_color,level,premium,avatar_key)';
/* Counts come from PostgREST's aggregate embedding rather than counter
   columns — views/aggregates first, denormalize only if it measurably
   hurts. Which posts *you* liked or saved is a separate query, because
   it changes per viewer and would bust any shared cache. */
const COUNTS = 'likes(count),comments(count)';
/* edited_at, visibility, hidden_at and image_keys used to be optional:
   they arrived with hand-run migrations while the app was already
   deployed, so the select had to survive their absence. Since
   .github/workflows/release.yml the schema is applied before the site
   is, so a column the code names is a column the database has. */
const SELECT = `${COLS},edited_at,visibility,hidden_at,image_keys,${AUTHOR},${COUNTS}`;
const q = build => rest(build(SELECT));

const countOf = agg => (Array.isArray(agg) && agg.length ? (agg[0].count|0) : 0);

/* One list of photos out of two columns that can disagree. `image_keys`
   is authoritative when it is there; before the migration it simply
   isn't, and the single key stands in. Capped at three here as well as
   in Postgres, because a row written by something other than this app
   is still a row this app has to render. */
function imagesOf(row){
  const arr = Array.isArray(row.image_keys) ? row.image_keys.filter(Boolean) : [];
  if(arr.length) return arr.slice(0,3);
  return row.image_key ? [row.image_key] : [];
}

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
    /* Up to three photos (step-1.28), oldest column first. `image_key`
       is still the first of them and is never retired: the OG card, the
       week recap and every client older than the migration read it, and
       a pour that only they can see half of is worse than one photo.
       So `imgs` is always the whole set INCLUDING the first, and `img`
       is always imgs[0] — no caller has to remember which is which. */
    imgs: imagesOf(row),
    caption: row.caption || '',
    cafe: cafe ? cafe.name : undefined,
    recipe: row.recipe || null,
    createdAt: row.created_at,
    edited: !!row.edited_at,           // the timestamp itself is never shown; see postCard()
    /* 'public' or 'followers'. Absent means the column isn't there yet,
       and everything predating it was posted as public — see rowOf(). */
    visibility: row.visibility==='followers' ? 'followers' : 'public',
    /* Hidden by a moderator (step-1.27). RLS means the only people who
       ever receive such a row are its author and an admin, so this is
       true on exactly the screens where saying so is the honest thing
       to do — the author was told why in their inbox, and the pour
       sitting there looking normal would contradict that. */
    hidden: !!row.hidden_at,
    ago: agoFrom(row.created_at),
    likes: countOf(row.likes),
    commentN: countOf(row.comments),   // the full thread loads when the post opens
    likedByMe: false, saved: false, comments: [],
    /* Reactions are their own table and their own request (data/reactions),
       so a post starts with an empty tally and is filled in once the page
       it belongs to has been hydrated. Zero is a real answer here — most
       pours have none — so nothing waits on it. */
    reactions: noReactions(), myReactions: []
  };
}

/* ---------- the app's post shape → an insert row ---------- */
export function rowOf(p, uid){
  const cafe = p.cafe ? CAFES.find(c=>c.name===p.cafe) : null;
  const row = baseRow(p,uid,cafe);
  row.visibility = p.visibility==='followers' ? 'followers' : 'public';
  row.image_keys = keysOf(p);
  return row;
}
function baseRow(p, uid, cafe){
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
/* The photo list — see step-1.28. Written
   as null rather than an empty array for a pour with no photo, so the
   column means "not applicable" rather than "an empty gallery". */
const keysOf = p => {
  const l=(p.imgs&&p.imgs.length?p.imgs:(p.img?[p.img]:[])).filter(Boolean).slice(0,3);
  return l.length?l:null;
};

/* A live UPDATE (data/realtime.js) carries the `posts` row and nothing
   embedded with it — no author, no counts. Those haven't changed, and
   the post on screen already has them, so an edit is applied field by
   field rather than by rebuilding the post through postOf() and losing
   half of it. Exactly the columns EDITABLE (below) lets a PATCH touch,
   plus the `edited_at` the database stamps in response. */
export function applyRowEdit(post, row){
  if(!post || !row) return post;
  post.drink=row.drink;
  post.art=!!row.art;
  post.pattern=row.pattern||null;
  post.caption=row.caption||'';
  post.recipe=row.recipe||null;
  const cafe=row.cafe_id ? CAFES.find(c=>c.id===row.cafe_id) : null;
  post.cafe=cafe?cafe.name:undefined;
  if('image_keys' in row){ post.imgs=imagesOf(row); post.img=post.imgs[0]||post.img||null; }
  if('visibility' in row) post.visibility = row.visibility==='followers'?'followers':'public';
  if('edited_at' in row) post.edited=!!row.edited_at;
  return post;
}

export const newPostId = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{
        const r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }));

/* ---------- reads ---------- */
/* Newest first, keyset-paginated on created_at. `before` is the
   created_at of the last row you already have. */
export async function fetchFeed({ before=null, limit=FEED_PAGE, myUid=null, authors=null,
                                  blocked=null, since=null, publicOnly=false }={}){
  const list = ids => `(${ids.map(id=>`"${id}"`).join(',')})`;
  const rows = await q(sel=>{
    let p = `posts?select=${sel}&order=created_at.desc&limit=${limit}`;
    if(before) p += `&created_at=lt.${encodeURIComponent(before)}`;
    /* Today is "since your local midnight", so the cut-off is computed
       where the user's clock is and sent as an absolute instant. */
    if(since) p += `&created_at=gte.${encodeURIComponent(since)}`;
    /* the Following tab filters server-side, so pagination stays correct */
    if(authors) p += `&user_id=in.${list(authors)}`;
    if(blocked && blocked.length) p += `&user_id=not.in.${list(blocked)}`;
    /* Belt and braces: RLS already hides other people's private pours,
       so this is about not showing YOUR private pours in a public feed. */
    if(publicOnly) p += `&visibility=eq.public`;
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
  const rows = await rest('posts', { method:'POST',
    prefer:'return=representation', body:rowOf(p,uid) });
  return rows && rows.length ? postOf(rows[0],uid) : null;
}

/* An edit rewrites what the author *said*, never what they shot: the
   photo (`image_key`), the author and the timestamp are deliberately not
   in this list, so a PATCH can't touch them even if the caller asks.
   `edited_at` is stamped by the database trigger, not by the client — a
   client that sets its own marker is a client that can also unset it.

   `visibility` IS editable: who you meant to show a pour to is part of
   what you said, and changing your mind the same day is the same kind of
   fix as a typo. It can't unring the bell for anyone who already saw it,
   but it stops it being shown again. */
const EDITABLE = ['drink','art','pattern','cafe_id','caption','recipe','visibility'];
export async function updatePost(id, p){
  const full = rowOf(p, null);
  const patch = {};
  EDITABLE.forEach(k=>{ if(k in full) patch[k] = full[k]; });
  return rest(`posts?id=eq.${id}`, { method:'PATCH', body:patch });
}

export async function deletePost(id){
  return rest(`posts?id=eq.${id}`,{ method:'DELETE' });
}
