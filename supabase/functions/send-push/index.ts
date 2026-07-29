// ============================================================
// send-push — delivers Web Push notifications (roadmap step 1.16).
//
// Called by Postgres (pg_net) from push_send(), never by a browser.
// Body: { rows: [{ endpoint, p256dh, auth, title, body, url, tag }] }
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
//   PUSH_HOOK_SECRET   shared with Postgres (app.push_secret). This
//                      function is deployed --no-verify-jwt so pg_net
//                      can reach it, so the header check below is the
//                      ONLY thing between it and the open internet.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the
// platform; the service role is needed to delete dead subscriptions,
// which are by definition not the caller's own rows.
// ============================================================
import { authHeader, encryptPayload, utf8 } from "./webpush.ts";

const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:hello@crema-app.com";
const HOOK_SECRET = Deno.env.get("PUSH_HOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const TTL_SECONDS = 12 * 60 * 60; // hold for half a day if the device is off

type Row = {
  endpoint: string; p256dh: string; auth: string;
  title?: string; body?: string; url?: string; tag?: string;
};

async function deliver(row: Row): Promise<"ok" | "gone" | "failed"> {
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

  // One slow or hanging push service must not hold up the rest.
  const results = await Promise.allSettled(rows.map(deliver));
  const gone: string[] = [];
  let sent = 0;
  results.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value === "ok") sent++;
    else if (r.status === "fulfilled" && r.value === "gone") gone.push(rows[i].endpoint);
    else if (r.status === "rejected") console.warn("push threw:", r.reason);
  });
  await dropDead(gone);

  return Response.json({ sent, gone: gone.length, failed: rows.length - sent - gone.length });
});
