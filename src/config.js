"use strict";
/* ============================================================
   config — backend endpoints.

   The publishable key is *designed* to ship in client code: it only
   ever grants the `anon` role, and Row Level Security is what actually
   protects the data (see supabase/schema.sql). It is committed on
   purpose — the app is a static site, so there is no build step to
   inject it at deploy time.

   The service_role key must NEVER appear in this file or any other
   file the browser can fetch. It bypasses RLS entirely.

   Both values are required: Crema has no offline/demo mode. With
   either one blank the app can only show the sign-in screen and say
   it isn't configured.
   ============================================================ */

export const SUPABASE_URL = 'https://diabtvahplwoipvrprvb.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_Dl-0fert2JgI005EaRauNw_ytYbmeVL';

/* R2 custom domain, bound to the "coffee" bucket with Cloudflare
   Image Transformations enabled on the zone (roadmap step 1.6). Public
   and read-only — safe to commit, same as the URL/key above. */
export const MEDIA_BASE = 'https://media.crema-app.com';

/* Sanity check on the two values above. False means the app is
   misconfigured, not that it has a fallback to fall back to. */
export const BACKEND = !!(SUPABASE_URL && SUPABASE_KEY);

/* How long cached reference data (cafés, beans, challenges) stays fresh
   before we re-fetch. Short enough that dashboard edits show up quickly,
   long enough that the PWA works offline. */
export const REFERENCE_TTL_MS = 15 * 60 * 1000;

/* Feed page size for the paginated post feed. */
export const FEED_PAGE = 12;
