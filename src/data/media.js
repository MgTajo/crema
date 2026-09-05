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
  /* A face in a list. Measured 2026-09-05 in Chromium at 412 CSS px:
     40x40 in a feed row and a notification, 34 in a comment, 30 in the
     mention picker, 26 on the today strip. 40 at DPR 3 is 120 device
     pixels, which is the number this is. `thumb` was serving 240 to all
     of them — four times the pixels for the single most repeated image
     in the app. The bigger faces (avatar.big at 56, avatar.xl at 74,
     .prof-av at 84) stay on `thumb`, which is right for them. */
  face:  'width=120,height=120,fit=cover,quality=78,format=auto',
  thumb: 'width=240,height=240,fit=cover,quality=78,format=auto',
  feed:  'width=800,quality=82,format=auto',
  hero:  'width=1200,quality=85,format=auto'
};

/* Widths a surface is willing to be served at, for srcset. The browser
   picks; `size` above stays the src, so a browser that ignores srcset
   gets exactly what it got before.

   `feed` renders at 346 CSS px in the phone frame on a laptop and
   356-378 on a phone (measured 2026-09-05 at five viewports), so one
   fixed width is wrong twice: 800 is 2.2x what a DPR-1 screen can show
   and two thirds of what a DPR-3 phone wants. 1080 rather than 1134 is
   not a rounding — handleUpload() downscales the short side to 1080
   before it ever leaves the phone, so that is the whole photograph. */
const WIDTHS = {
  feed: [400, 800, 1080]
};

/* What `sizes` has to say for the widths above to be picked correctly.
   Same measurement: a fixed 346px frame from tablet width up, and the
   viewport less a 34px gutter below it. */
const SIZES = {
  feed: '(min-width: 640px) 346px, calc(100vw - 34px)'
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

/* Everything an <img> needs for one surface, in one object: the src it
   has always had, plus srcset/sizes where a surface has more than one
   sensible width. Built here for the same reason imageUrl() is — a call
   site asks for a surface, never for a width — and returned as attrs
   rather than a URL because the extra two are only meaningful together.

   A size with no WIDTHS entry, or a src that is not ours to transform
   (a bundled asset, a data: URL from a pour that has not uploaded yet),
   gets `{src}` alone and behaves exactly as it did before. */
export function imageAttrs(src, size='feed'){
  const out = { src: imageUrl(src, size) };
  const ws = WIDTHS[size];
  if(!ws || !looksLikeKey(src)) return out;
  const rest = (VARIANTS[size]||VARIANTS.feed).replace(/(^|,)width=\d+/, '');
  out.srcset = ws.map(w=>`${MEDIA_BASE}/cdn-cgi/image/width=${w}${rest}/${src} ${w}w`).join(', ');
  out.sizes = SIZES[size] || '';
  return out;
}

/* The stored object itself, with no transform in front of it.
   Deliberately NOT for display — imageUrl() is, and it serves a tenth
   of the bytes.

   This exists because the two URLs differ in one way that has nothing
   to do with pixels: `/cdn-cgi/image/…` is answered by Cloudflare's
   resizing edge, which does not carry the bucket's CORS headers, while
   the object's own URL does (the `coffee` bucket already allows GET
   from the app's origins — see platform/supabase/README.md). So a
   transformed image can be *shown* but never *read*: drawing one into a
   canvas taints it, and a tainted canvas cannot be exported at all.

   The week card has to read pixels, not just show them, so it asks for
   the object and downscales it itself. See loadShotPhotos() in
   ui/recap.js. If the transform edge ever starts sending
   Access-Control-Allow-Origin, this can go back to a thumb. */
export function imageSource(src){
  if(!looksLikeKey(src)) return src;
  return `${MEDIA_BASE}/${src}`;
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
  if(!r.ok){
    const e = new Error(body.error || `Could not get an upload URL (${r.status})`);
    e.status = r.status;                 // 429 is the rate limit, and is an answer
    throw e;
  }
  return body; // { key, uploadUrl, expiresIn }
}

const sleep = ms => new Promise(r=>setTimeout(r,ms));

/* ------------------------------------------------------------
   Why the PUT is tried more than once.

   The failure this exists for is not a bug, it is a morning: a phone
   handing off between cells while the kettle boils, a radio that has
   been asleep, a lift. One PUT against that loses the photo the person
   just took, and the app's only remedy was to ask them to press Post
   again — which is a fine last resort and a poor first one.

   Retried against the SAME presigned URL, not a fresh one. The URL is
   good for fifteen minutes and asking for another spends a slot against
   claim_upload_slot() (15 per five minutes), so re-presigning on every
   attempt would let a bad connection walk somebody into their own rate
   limit. The one case that genuinely needs a new signature is 403 —
   an expired or rejected one — and that gets exactly one.

   What is NOT retried: anything Crema's own upload-url function has
   answered on purpose. 401 (no session), 400 (not an image we take) and
   429 (too many photos at once) are true the second time as well, and
   repeating a 429 is the one thing that makes a rate limit worse. Those
   throw out of presign() below and never reach the loop at all — the
   429 in retryablePut() is R2's own throttle, which is a different
   thing and is worth waiting out. */
const RETRY_PUT = 3;
const backoffMs = attempt => 400 * Math.pow(3, attempt) + Math.floor(Math.random()*250);
const retryablePut = status => status===0 || status===408 || status===425 || status===429 || status>=500;

/* Upload an already-downscaled blob; returns the R2 key to store on
   the post (not a URL — imageUrl() builds the URL per surface).

   A Blob body can be sent again — it is bytes, not a stream — which is
   what makes the loop below legal at all. */
export async function uploadImage(blob, contentType='image/jpeg'){
  let signed = await presign(contentType);
  let repressigned = false;
  let last;

  for(let attempt = 0; attempt < RETRY_PUT; attempt++){
    if(attempt) await sleep(backoffMs(attempt-1));
    let status = 0;                       // 0 means the request never got an answer
    try{
      const put = await fetch(signed.uploadUrl, { method:'PUT', headers:{ 'Content-Type':contentType }, body:blob });
      if(put.ok) return signed.key;
      status = put.status;
    }catch(err){ last = err; }

    /* R2 refusing the signature is the one failure a second signature
       can fix. Once, so a genuinely wrong credential does not become a
       loop against the rate limit. */
    if(status===403 && !repressigned){
      repressigned = true;
      try{ signed = await presign(contentType); continue; }catch(err){ throw err; }
    }
    if(status && !retryablePut(status)){
      const e = new Error(`Upload failed (${status})`); e.status = status; throw e;
    }
    last = last || Object.assign(new Error(`Upload failed (${status})`), { status });
  }
  throw last || new Error('Upload failed');
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
