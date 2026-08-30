// ============================================================
// delete-account — the one thing a person can do that we cannot undo.
//
// Step 3.3 of brain/13-infrastructure-plan.md. App Store Review
// Guideline 5.1.1(v) requires it of anything that can create an
// account; GDPR Art. 17 requires it of us regardless of any store.
//
// WHAT IT ACTUALLY DOES, IN ORDER
//   1. Reads who the caller is from their JWT — never from the body.
//   2. Makes them say their own @handle, and checks it against the
//      profile row rather than trusting the client to have checked.
//   3. Empties `posts/<uid>/` in R2. Every photo the account ever
//      uploaded is under that prefix, avatars included (upload-url
//      mints exactly one shape of key), so a prefix listing is more
//      complete than walking the rows would be: it also catches the
//      uploads that were never attached to a post.
//   4. DELETEs the auth user through the Admin API. Every row in
//      `public` goes with it through the foreign keys —
//      profiles.id references auth.users(id) ON DELETE CASCADE, and
//      everything else hangs off profiles. See
//      migrations/20260830200000_account_deletion_and_export.sql.
//
// WHY R2 FIRST
// Neither order is safe if the second half fails, so the choice is
// between two failures. Photos first means a half-failure leaves an
// account whose pictures are broken — visible, annoying, and fixed by
// pressing the button again, which retries cleanly because the prefix
// is already empty. Account first means a half-failure leaves
// photographs of a person in a bucket with nothing left pointing at
// them: nobody sees it, nobody retries it, and it is the exact
// GDPR failure this function exists to prevent. Visible and retryable
// beats silent.
//
// SECRETS
// The same R2 four as upload-url and delete-image (see
// platform/supabase/README.md), plus SUPABASE_SERVICE_ROLE_KEY, which
// Supabase injects into every function by default — there is nothing
// new to set.
//
// ⚠️ The service-role key bypasses RLS entirely. It is used for exactly
//    one call, on exactly one id, and that id comes from the verified
//    JWT. It must never be given an id out of the request body.
// ============================================================
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? "coffee";
const R2_JURISDICTION = Deno.env.get("R2_JURISDICTION") ?? "";
/* Checked rather than assumed. A project with no R2 credentials — a
   fresh staging, say — would otherwise sign requests to
   `https://undefined.r2.cloudflarestorage.com` and report the resulting
   network failure as "could not remove your photos", which is true and
   useless. Answered BEFORE anything is deleted, and with a code the
   caller can branch on, so a misconfigured environment is a clean
   refusal rather than a half-finished deletion. It cannot mean "skip
   the photos and carry on": that is the silent GDPR failure this
   function exists to prevent. */
const R2_READY = !!(R2_ACCOUNT_ID && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);

const R2_HOST = R2_JURISDICTION
  ? `${R2_ACCOUNT_ID}.${R2_JURISDICTION}.r2.cloudflarestorage.com`
  : `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const r2 = new AwsClient({
  accessKeyId: R2_ACCESS_KEY_ID,
  secretAccessKey: R2_SECRET_ACCESS_KEY,
  service: "s3",
  region: "auto",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* One page of keys under a prefix. R2 speaks S3, so this is
   ListObjectsV2 — and the continuation token is what makes an account
   with more than a thousand photos delete completely rather than
   almost. */
async function listPage(prefix: string, token?: string) {
  const u = new URL(`https://${R2_HOST}/${R2_BUCKET}`);
  u.searchParams.set("list-type", "2");
  u.searchParams.set("prefix", prefix);
  u.searchParams.set("max-keys", "1000");
  if (token) u.searchParams.set("continuation-token", token);

  const res = await r2.fetch(u.toString(), { method: "GET" });
  if (!res.ok) throw new Error(`R2 list failed (${res.status})`);
  const xml = await res.text();

  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  );
  const more = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
  return { keys, next: more && next ? next[1] : undefined };
}

/* DeleteObjects, up to 1000 at a time — one signed request per page
   instead of one per photograph. */
async function deleteKeys(keys: string[]) {
  if (!keys.length) return;
  const body =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<Delete xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Quiet>true</Quiet>` +
    keys.map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`).join("") +
    `</Delete>`;
  // aws4fetch signs the body, so a rejected batch is a real failure
  // rather than a signature problem. No Content-MD5: R2 does not
  // require it and WebCrypto has no MD5 to compute it with.
  const res = await r2.fetch(`https://${R2_HOST}/${R2_BUCKET}?delete`, {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body,
  });
  if (!res.ok) throw new Error(`R2 delete failed (${res.status})`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  // Who they are comes from the token, checked against the auth server
  // on every call. Nothing about the identity is taken from the body —
  // same rule as upload-url and delete-image.
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY },
  });
  if (!who.ok) return json({ error: "Invalid or expired session" }, 401);
  const uid = (await who.json())?.id as string | undefined;
  if (!uid) return json({ error: "Invalid session" }, 401);

  if (!R2_READY) {
    return json({
      error: "Photo storage is not configured, so this account cannot be deleted safely.",
      code: "no_storage",
    }, 503);
  }

  // The typed confirmation, checked here rather than only in the
  // browser. A destructive endpoint that fires on an empty POST is one
  // stray fetch away from deleting somebody, and the client-side check
  // is on the wrong side of the network to be the one that counts.
  const { confirm } = await req.json().catch(() => ({ confirm: null }));
  const rows = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${uid}&select=handle`,
    { headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY } },
  );
  const handle = (await rows.json().catch(() => []))?.[0]?.handle as string | undefined;
  if (!handle) return json({ error: "No profile to delete" }, 404);
  if (
    typeof confirm !== "string" ||
    confirm.trim().replace(/^@/, "").toLowerCase() !== handle.toLowerCase()
  ) {
    return json({ error: "Type your username to confirm" }, 400);
  }

  // 1. the photographs
  let removed = 0;
  try {
    let token: string | undefined;
    do {
      const page = await listPage(`posts/${uid}/`, token);
      await deleteKeys(page.keys);
      removed += page.keys.length;
      token = page.next;
    } while (token);
  } catch (e) {
    // Nothing has been lost yet: the account is intact and pressing the
    // button again starts over.
    return json({ error: `Could not remove your photos (${String(e)})` }, 502);
  }

  // 2. the account, and every row that hangs off it
  const gone = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${uid}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
  });
  if (!gone.ok) {
    const detail = await gone.text().catch(() => "");
    return json({ error: `Could not delete the account (${gone.status}) ${detail}` }, 502);
  }

  return json({ ok: true, photos: removed });
});
