// ============================================================
// fcm — the other half of send-push, for phones instead of browsers.
//
// Web Push (./webpush.ts) delivers to an endpoint URL the browser minted
// and encrypts the payload to keys only that browser holds. FCM does
// none of that: Google holds the device's registration token, we hold a
// service account, and the payload travels in the clear over TLS to
// Google, who fan it out. Two different protocols for the same sentence,
// which is why they are two files and why index.ts routes per row rather
// than trying to make one shape serve both.
//
// WHY HTTP v1 AND NOT THE LEGACY SERVER KEY. The legacy endpoint
// (fcm.googleapis.com/fcm/send with an `Authorization: key=…` header)
// was turned off by Google in June 2024. There is no simpler path left:
// v1 requires an OAuth2 access token, which requires a signed JWT, which
// requires the service account's RSA key. All of that is below and it is
// about forty lines.
//
// Secrets (supabase secrets set …):
//   FCM_SERVICE_ACCOUNT   the whole service-account JSON, verbatim, as
//                         downloaded from the Firebase console
//                         (Project settings → Service accounts →
//                         Generate new private key). It contains
//                         `project_id`, `client_email` and
//                         `private_key`, which is everything needed —
//                         no second variable to keep in step.
//
// ⚠️ That JSON is the authority to send notifications that appear to
// come from Crema, exactly as VAPID_PRIVATE_KEY is on the web side. It
// never goes in the repo, and it is not the same thing as
// google-services.json — that one ships INSIDE the app and only
// identifies the project to the phone.
//
// UNCONFIGURED IS A NORMAL STATE, not an error: `configured()` is false
// until the secret exists, index.ts skips every native row, and the web
// half is untouched. That is the state this file ships in.
// ============================================================
import { b64uEncode, utf8 } from "./webpush.ts";

type Account = { project_id: string; client_email: string; private_key: string };

let account: Account | null | undefined;   // undefined = not looked at yet

function serviceAccount(): Account | null {
  if (account !== undefined) return account;
  const raw = Deno.env.get("FCM_SERVICE_ACCOUNT") ?? "";
  if (!raw.trim()) { account = null; return account; }
  try {
    const j = JSON.parse(raw) as Account;
    account = (j.project_id && j.client_email && j.private_key) ? j : null;
    if (!account) console.error("FCM_SERVICE_ACCOUNT is missing project_id, client_email or private_key");
  } catch (e) {
    console.error("FCM_SERVICE_ACCOUNT is not valid JSON:", e);
    account = null;
  }
  return account;
}

export const configured = () => serviceAccount() !== null;

/* ---------- the service account's key ----------
   The JSON carries a PKCS#8 PEM, and `supabase secrets set` round-trips
   it with the newlines still written as the two characters \n — which is
   also how the file itself stores them. Both spellings have to import,
   because which one arrives depends on how the secret was set, and the
   failure mode is a 100% silent delivery failure either way. */
function pkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/\\n/g, "\n")
    .replace(/-----[^-]+-----/g, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ---------- OAuth2, cached ----------
   Google's token is good for an hour and one notification can fan out to
   several devices, so minting one per send would triple the latency of a
   digest for nothing. Refreshed a minute early. */
let token: { value: string; exp: number } | null = null;

async function accessToken(): Promise<string | null> {
  const acct = serviceAccount();
  if (!acct) return null;

  const now = Math.floor(Date.now() / 1000);
  if (token && token.exp - now > 60) return token.value;

  const seg = (o: unknown) => b64uEncode(utf8(JSON.stringify(o)));
  const claim = {
    iss: acct.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const signing = `${seg({ alg: "RS256", typ: "JWT" })}.${seg(claim)}`;

  let jwt: string;
  try {
    const key = await crypto.subtle.importKey(
      "pkcs8",
      pkcs8(acct.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, utf8(signing)));
    jwt = `${signing}.${b64uEncode(sig)}`;
  } catch (e) {
    console.error("FCM service account key would not import:", e);
    return null;
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) {
    console.error(`FCM token exchange ${res.status}: ${await res.text().catch(() => "")}`);
    return null;
  }
  const body = await res.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  token = { value: body.access_token, exp: now + (body.expires_in ?? 3600) };
  return token.value;
}

export type NativeRow = {
  token: string;
  platform?: string;
  title?: string; body?: string; url?: string; tag?: string;
};

/* One notification to one device. The three outcomes are the same three
   the web side reports, and they mean the same things, so index.ts can
   treat both kinds of row identically once this returns. */
export async function deliverFcm(row: NativeRow): Promise<"ok" | "gone" | "failed"> {
  const acct = serviceAccount();
  const auth = await accessToken();
  if (!acct || !auth) return "failed";

  const message = {
    token: row.token,
    // `notification` is what makes Android draw it while the app is
    // closed. `data` is what the app reads when it is tapped —
    // watchNativeTaps() in src/data/push.js pulls `url` out of exactly
    // this, and it is the same "./#p/<id>" string sw.js gets on the web.
    notification: { title: row.title ?? "Crema", body: row.body ?? "" },
    data: { url: row.url ?? "./", tag: row.tag ?? "crema" },
    android: {
      priority: "HIGH",
      // The lock-screen collapsing the plpgsql senders already compute.
      // Same tag, same meaning: a friend with three cups before ten is
      // one line, not three. collapse_key also tells FCM itself to drop
      // the older undelivered one, which is the behaviour we want.
      collapse_key: row.tag ?? "crema",
      notification: { tag: row.tag ?? "crema", default_sound: true },
    },
    apns: {
      headers: { "apns-collapse-id": (row.tag ?? "crema").slice(0, 64) },
      payload: { aps: { sound: "default", "thread-id": row.tag ?? "crema" } },
    },
  };

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${acct.project_id}/messages:send`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    },
  );

  if (res.ok) return "ok";
  const text = await res.text().catch(() => "");
  // FCM says a token is dead with 404 UNREGISTERED, and says it is not a
  // token at all with 400 INVALID_ARGUMENT. Both mean stop keeping the
  // row; everything else is worth a retry on the next notification.
  if (res.status === 404 || /UNREGISTERED|NOT_FOUND/.test(text)) return "gone";
  if (res.status === 400 && /INVALID_ARGUMENT/.test(text) && /token/i.test(text)) return "gone";
  console.warn(`fcm ${res.status}: ${text}`);
  return "failed";
}
