/* ============================================================
   What the database actually has, asked directly.

   Crema paints optimistically — a pour is on screen before
   createPost() has been awaited, and a like flips the heart before the
   row exists. So every UI assertion in this suite is a statement about
   this browser, not about Postgres. These are the ones that are about
   Postgres.

   Read over PostgREST as `anon`, with the same publishable key the app
   ships. That is not a back door: posts, likes and profiles are exactly
   as readable to this suite as they are to a signed-out visitor, which
   means these assertions also quietly check that RLS still lets the
   public feed be public.
   ============================================================ */
import { SUPABASE_URL, SUPABASE_KEY } from './env.js';

async function get(pathAndQuery) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  if (!res.ok) throw new Error(`PostgREST ${res.status} on ${pathAndQuery}: ${await res.text()}`);
  return res.json();
}

const enc = encodeURIComponent;

/* The pour, by the caption this run stamped into it. Returns the row or
   null — "no such pour" is an answer a test wants to make its own
   sentence about, not an exception from in here. */
export async function pourByCaption(caption) {
  const rows = await get(`posts?caption=eq.${enc(caption)}&select=id,user_id,drink,caption,visibility`);
  return rows[0] || null;
}

export async function likeExists(postId, userId) {
  const rows = await get(`likes?post_id=eq.${enc(postId)}&user_id=eq.${enc(userId)}&select=post_id`);
  return rows.length > 0;
}

export async function profileByHandle(handle) {
  const rows = await get(`profiles?handle=eq.${enc(handle)}&select=id,handle,name,premium,badges`);
  return rows[0] || null;
}

/* Poll, because the client does not await its own write before
   returning to the feed. A second is plenty against a database in the
   same region; the timeout is what turns "eventually" into a failure. */
export async function until(fn, { timeout = 15000, every = 400, what = 'the row' } = {}) {
  const deadline = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > deadline) throw new Error(`timed out after ${timeout}ms waiting for ${what} to reach the database`);
    await new Promise(r => setTimeout(r, every));
  }
}
