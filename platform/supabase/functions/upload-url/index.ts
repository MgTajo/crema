// ============================================================
// upload-url — mints a presigned R2 PUT URL for the signed-in user.
//
// The R2 secret never reaches the browser. This function verifies the
// caller's Supabase session, derives the object key from their own
// user id (never from anything the client sends), and returns a
// short-lived presigned URL. The client PUTs bytes straight to R2 —
// they never transit Supabase (roadmap step 1.6).
//
// Secrets required (see supabase/README.md for the exact commands):
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   R2_BUCKET        (optional — defaults to "coffee")
//   R2_JURISDICTION  (optional — set to "eu" if the bucket was created
//                     with EU jurisdiction. A jurisdictional bucket is
//                     only reachable through its jurisdiction's S3
//                     endpoint; hitting the default endpoint returns
//                     AccessDenied even with correct credentials.)
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the
// platform; do not set them yourself.
// ============================================================
import { AwsClient } from "https://esm.sh/aws4fetch@1.0.20";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const R2_ACCOUNT_ID = Deno.env.get("R2_ACCOUNT_ID")!;
const R2_ACCESS_KEY_ID = Deno.env.get("R2_ACCESS_KEY_ID")!;
const R2_SECRET_ACCESS_KEY = Deno.env.get("R2_SECRET_ACCESS_KEY")!;
const R2_BUCKET = Deno.env.get("R2_BUCKET") ?? "coffee";
const R2_JURISDICTION = Deno.env.get("R2_JURISDICTION") ?? "";
const R2_HOST = R2_JURISDICTION
  ? `${R2_ACCOUNT_ID}.${R2_JURISDICTION}.r2.cloudflarestorage.com`
  : `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const UPLOAD_TTL_SECONDS = 900; // 15 minutes

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EXT_OF: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
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

  // The platform gateway already checked this is a validly-signed JWT
  // (that check accepts the anon key too). This call confirms it
  // belongs to a real, signed-in user and gets their id — the only
  // input that decides the object key, so it can't be spoofed by the
  // request body.
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: SUPABASE_ANON_KEY },
  });
  if (!who.ok) return json({ error: "Invalid or expired session" }, 401);
  const user = await who.json();
  const uid = user?.id as string | undefined;
  if (!uid) return json({ error: "Invalid session" }, 401);

  const body = await req.json().catch(() => ({}));
  const ext = EXT_OF[body.contentType];
  if (!ext) return json({ error: "Unsupported image type — use JPEG, PNG or WebP" }, 400);

  // The rate limit. It runs after the request is checked — a caller
  // who sent an unsupported type should not spend a slot on it — and
  // BEFORE anything is signed: a limit that fires after the signature
  // exists has already handed out the thing it was guarding — the
  // presigned PUT stays valid for 15 minutes whether this function
  // likes it or not.
  //
  // Counted in Postgres (migrations/20260830150000_rate_limits.sql),
  // because a counter in this function is a counter in one instance's
  // memory and instances are recycled and horizontal. Called with the
  // caller's own JWT so `auth.uid()` inside claim_upload_slot() is them.
  const slot = await fetch(`${SUPABASE_URL}/rest/v1/rpc/claim_upload_slot`, {
    method: "POST",
    headers: {
      Authorization: auth,
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!slot.ok) {
    const detail = await slot.json().catch(() => ({} as Record<string, string>));
    // PostgREST turns a P0001 into 400 with the message in `message`.
    // 429 is what the caller should see: this is not a bad request.
    return json({
      error: detail.message ||
        "Too many photos at once — wait a minute and try again.",
    }, 429);
  }

  const key = `posts/${uid}/${crypto.randomUUID()}.${ext}`;

  // Setting X-Amz-Expires before signing is deliberate: aws4fetch only
  // fills in its own 24h default when the param is absent, so this is
  // how the expiry is actually controlled.
  const target = new URL(`https://${R2_HOST}/${R2_BUCKET}/${key}`);
  target.searchParams.set("X-Amz-Expires", String(UPLOAD_TTL_SECONDS));

  const signed = await r2.sign(target.toString(), {
    method: "PUT",
    aws: { signQuery: true },
  });

  return json({ key, uploadUrl: signed.url, expiresIn: UPLOAD_TTL_SECONDS });
});
