"use strict";
/* ============================================================
   data/media — post photos, from the browser to R2 to the screen.

   Upload: the client never holds an R2 credential. It asks the
   `upload-url` Edge Function (platform/supabase/functions/upload-url) for a
   short-lived presigned PUT URL scoped to its own key — derived
   server-side from the caller's JWT, not from anything the client
   sends — then PUTs bytes straight to R2. Bytes never transit Supabase.

   Delivery: reads go through the custom domain with transform params
   in the URL, via imageUrl(key, size), so call sites ask for a named
   size instead of hand-writing `/cdn-cgi/image/...` strings.
   ============================================================ */
import { SUPABASE_URL, SUPABASE_KEY, MEDIA_BASE } from '../config.js';
import { accessToken } from './supabase.js';

/* One width per surface, matched to where the image actually renders.
   Storing a single fixed size would waste bandwidth on the feed to
   satisfy the hero, or blur the hero to satisfy the feed. The upload
   path already downscales to 1080px (handleUpload() in ui/actions.js)
   — a CDN optimizer downstream doesn't make a 12MP original free. */
const VARIANTS = {
  thumb: 'width=240,height=240,fit=cover,quality=78,format=auto',
  feed:  'width=800,quality=82,format=auto',
  hero:  'width=1200,quality=85,format=auto'
};

/* An R2 object key looks like posts/<uid>/<uuid>.jpg. Anything else —
   a bundled asset path, a data: URL from a not-yet-uploaded or
   offline-created post, or an already-absolute URL — passes through
   untouched, so this is safe to wrap around every image src in the app. */
const looksLikeKey = src => !!src && !/^(https?:|data:|assets\/)/.test(src);

export function imageUrl(src, size='feed'){
  if(!looksLikeKey(src)) return src;
  return `${MEDIA_BASE}/cdn-cgi/image/${VARIANTS[size]||VARIANTS.feed}/${src}`;
}

async function presign(contentType){
  const token = await accessToken();
  if(!token) throw new Error('Sign in to upload a photo');
  const r = await fetch(`${SUPABASE_URL}/functions/v1/upload-url`,{
    method:'POST',
    headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ contentType })
  });
  const body = await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(body.error || `Could not get an upload URL (${r.status})`);
  return body; // { key, uploadUrl, expiresIn }
}

/* Upload an already-downscaled blob; returns the R2 key to store on
   the post (not a URL — imageUrl() builds the URL per surface). */
export async function uploadImage(blob, contentType='image/jpeg'){
  const { key, uploadUrl } = await presign(contentType);
  const put = await fetch(uploadUrl, { method:'PUT', headers:{ 'Content-Type':contentType }, body:blob });
  if(!put.ok) throw new Error(`Upload failed (${put.status})`);
  return key;
}

/* Best-effort delete, used when a post is removed and when an account
   is deleted (GDPR: deletion must purge R2, not just the DB row).
   Never throws — an orphaned object is cheap; a delete that blocks the
   user's action on a network blip is not. */
export async function deleteImage(key){
  if(!looksLikeKey(key)) return;
  try{
    const token = await accessToken(); if(!token) return;
    await fetch(`${SUPABASE_URL}/functions/v1/delete-image`,{
      method:'POST',
      headers:{ apikey:SUPABASE_KEY, Authorization:`Bearer ${token}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ key })
    });
  }catch(e){ console.warn('image delete failed',e); }
}
