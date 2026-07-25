// ============================================================
// delete-image — removes one object from R2 on behalf of its owner.
//
// Used when a post is deleted, so a post's photo doesn't outlive the
// post. The key must be prefixed posts/<caller's uid>/ — verified
// server-side from the JWT, so a user can only ever delete their own
// objects, never anyone else's by guessing a key.
//
// Same secrets as upload-url (see supabase/README.md).
// ============================================================
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? "coffee";
// Jurisdictional buckets (e.g. EU) are only reachable via their own S3
// endpoint — see the comment in upload-url/index.ts.
const R2_JURISDICTION = Deno.env.get("R2_JURISDICTION") ?? "";
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Missing Authorization" }, 401);

  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY },
  });
  if (!who.ok) return json({ error: "Invalid or expired session" }, 401);
  const user = await who.json();
  const uid = user?.id as string | undefined;
  if (!uid) return json({ error: "Invalid session" }, 401);

  const { key } = await req.json().catch(() => ({ key: null }));
  if (typeof key !== "string" || !key.startsWith(`posts/${uid}/`)) {
    // Not this user's object — say nothing about whether it exists.
    return json({ error: "Not found" }, 404);
  }

  const target = `https://${R2_HOST}/${R2_BUCKET}/${key}`;
  const res = await r2.fetch(target, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    return json({ error: `R2 delete failed (${res.status})` }, 502);
  }
  return json({ ok: true });
});
