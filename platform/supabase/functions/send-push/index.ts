// ============================================================
// send-push — delivers a notification to a browser or to a phone.
//
// Called by Postgres (pg_net) from push_send(), never by a browser.
// Body: { rows: [ … ] }, where a row is one of two shapes:
//
//   { endpoint, p256dh, auth, title, body, url, tag }   Web Push
//   { token, platform,          title, body, url, tag } FCM (the shell)
//
// Which one it is, is decided by which key is present, and nothing else.
// The two halves are separate all the way down — separate tables
// (push_subscriptions / native_push_tokens), separate protocols
// (./webpush.ts / ./fcm.ts), separate credentials, separate dead-address
// cleanup — because Web Push is live for everyone on crema-app.com right
// now and the native half arrived years later in this codebase's terms.
// A native row cannot change what a web row does, which is the property
// worth having.
//
// The crypto lives in ./webpush.ts, verified against the RFC 8291 §5
// test vector (./webpush.test.mjs). This file is transport: authenticate
// the caller, fan out, and clean up subscriptions the push services say
// are dead.
//
// Secrets (supabase secrets set …):
//   VAPID_PUBLIC_KEY   base64url, 65-byte uncompressed P-256 point.
//                      Must equal VAPID_PUBLIC_KEY in src/config.js — a
//                      subscription is bound to the key that created it,
//                      so a mismatch is a silent 100% failure.
//   VAPID_PRIVATE_KEY  base64url, the 32-byte private scalar. Never in
//                      the repo: it is the authority to send
//                      notifications that appear to come from Crema.
//   VAPID_SUBJECT      mailto: or https: contact, required by RFC 8292.
//   FCM_SERVICE_ACCOUNT  the Firebase service-account JSON, verbatim, for
//                      the phone half. Optional and absent today: while
//                      it is unset every native row is SKIPPED and the
//                      web half behaves exactly as it always has. See
//                      ./fcm.ts for where to get it and what it is not
//                      (it is not google-services.json).
//   PUSH_HOOK_SECRET   shared with Postgres (app.push_secret). This
//                      function is deployed --no-verify-jwt so pg_net
//                      can reach it, so the header check below is the
//                      ONLY thing between it and the open internet.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the
// platform; the service role is needed to delete dead subscriptions,
// which are by definition not the caller's own rows.
// ============================================================
import { authHeader, encryptPayload, utf8 } from "./webpush.ts";
import { configured as fcmConfigured, deliverFcm, type NativeRow } from "./fcm.ts";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@crema-app.com";
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TTL_SECONDS = 12 * 60 * 60; // hold for half a day if the device is off

type WebRow = {
  endpoint: string; p256dh: string; auth: string;
  title?: string; body?: string; url?: string; tag?: string;
};
type Row = WebRow | NativeRow;
const isNative = (r: Row): r is NativeRow =>
  typeof (r as NativeRow).token === "string" && !!(r as NativeRow).token;

async function deliver(row: WebRow): Promise<"ok" | "gone" | "failed"> {
  const audience = new URL(row.endpoint).origin;
  const payload = utf8(JSON.stringify({
    title: row.title ?? "Crema",
    body: row.body ?? "",
    url: row.url ?? "./",
    tag: row.tag ?? "crema",
  }));

  const res = await fetch(row.endpoint, {
    method: "POST",
    headers: {
      Authorization: await authHeader(audience, {
        publicKey: VAPID_PUBLIC, privateKey: VAPID_PRIVATE,
        subject: VAPID_SUBJECT, ttl: TTL_SECONDS,
      }),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(TTL_SECONDS),
      Urgency: "normal",
    },
    body: await encryptPayload(row.p256dh, row.auth, payload),
  });

  if (res.ok) return "ok";
  // The push service is authoritative about which subscriptions still
  // exist: 404/410 means this device is gone for good, not busy.
  if (res.status === 404 || res.status === 410) return "gone";
  console.warn(`push ${res.status} for ${audience}: ${await res.text().catch(() => "")}`);
  return "failed";
}

async function dropDead(endpoints: string[]) {
  if (!endpoints.length) return;
  const list = endpoints.map((e) => `"${encodeURIComponent(e)}"`).join(",");
  await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?endpoint=in.(${list})`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}

// The same job for the phone half, against the other table. Separate
// function rather than a parameter because getting the table wrong here
// deletes live subscriptions, and a `table` argument is exactly the kind
// of thing that gets passed wrong once.
async function dropDeadTokens(tokens: string[]) {
  if (!tokens.length) return;
  const list = tokens.map((t) => `"${encodeURIComponent(t)}"`).join(",");
  await fetch(`${SUPABASE_URL}/rest/v1/native_push_tokens?token=in.(${list})`, {
    method: "DELETE",
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).catch(() => {});
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  // Constant-time comparison would be nicer, but the secret is
  // high-entropy and a network attacker gets no timing oracle for
  // partial matches through the platform's edge.
  if (!HOOK_SECRET || req.headers.get("X-Push-Secret") !== HOOK_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.error("VAPID keys not configured");
    return new Response("Not configured", { status: 500 });
  }

  const { rows } = await req.json().catch(() => ({ rows: [] })) as { rows?: Row[] };
  if (!Array.isArray(rows) || !rows.length) return Response.json({ sent: 0 });

  // A native row with no FCM credential is skipped, not failed: the
  // senders in Postgres include phone tokens unconditionally, and until
  // step 4.2's service account exists that is a normal, expected,
  // uninteresting outcome that must not colour the web half's result.
  const canNative = fcmConfigured();
  let skipped = 0;

  // One slow or hanging push service must not hold up the rest.
  const results = await Promise.allSettled(rows.map((r) => {
    if (!isNative(r)) return deliver(r);
    if (!canNative) { skipped++; return Promise.resolve("skipped" as const); }
    return deliverFcm(r);
  }));

  const gone: string[] = [];
  const goneTokens: string[] = [];
  let sent = 0;
  results.forEach((r, i) => {
    const row = rows[i];
    if (r.status === "rejected") { console.warn("push threw:", r.reason); return; }
    if (r.value === "ok") sent++;
    else if (r.value === "gone") {
      if (isNative(row)) goneTokens.push(row.token); else gone.push(row.endpoint);
    }
  });
  await Promise.all([dropDead(gone), dropDeadTokens(goneTokens)]);

  const dead = gone.length + goneTokens.length;
  return Response.json({
    sent, gone: dead, skipped,
    failed: rows.length - sent - dead - skipped,
  });
});
