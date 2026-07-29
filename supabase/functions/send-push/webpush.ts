// ============================================================
// webpush — RFC 8291 payload encryption and RFC 8292 VAPID auth.
//
// Split out from index.ts so it can be exercised against the RFC 8291 §5
// test vector without a running server (see webpush.test.mjs). That
// matters more than it looks: a self-consistent implementation that has
// swapped, say, the two public keys inside `key_info` will encrypt and
// decrypt happily against itself and fail against every real browser.
// The published vector is the only thing that catches it.
//
// Pure WebCrypto — no npm dependency, and identical on Deno and Node.
// ============================================================

/* ---------- base64url ---------- */
export const b64uEncode = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function b64uDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const utf8 = (s: string) => new TextEncoder().encode(s);

/* ---------- HKDF, by hand ----------
   Single-block expand only: every output here is <= 32 bytes, so the
   general multi-block loop would be dead code. */
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, len: number) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, concat(info, new Uint8Array([1])));
  return okm.slice(0, len);
}

export const RECORD_SIZE = 4096;

/* ---------- RFC 8291 ----------
   `eph` and `salt` are parameters rather than locals so the RFC vector
   can be reproduced exactly; encryptPayload() below supplies fresh
   random ones, which is what production always does. Reusing a salt or
   an ephemeral key across messages would leak the key — never pass
   fixed values outside a test. */
export async function encryptWith(
  uaPublic: Uint8Array,
  authSecret: Uint8Array,
  plaintext: Uint8Array,
  eph: CryptoKeyPair,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256),
  );

  // Two-stage derivation: the auth secret salts the shared point down to
  // an IKM bound to BOTH public keys (receiver first, then sender — the
  // order is normative), then a random per-message salt produces the
  // actual content key and nonce.
  const ikm = await hkdf(authSecret, shared, concat(utf8("WebPush: info\0"), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  const key = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  // 0x02 is the delimiter marking this as the final (and here, only) record.
  const padded = concat(plaintext, new Uint8Array([2]));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));

  // aes128gcm header: salt(16) | record size(4, big-endian) | keyid len(1) | keyid
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, RECORD_SIZE);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/* The real entry point: fresh ephemeral keypair and salt per message. */
export async function encryptPayload(
  p256dh: string,
  auth: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encryptWith(b64uDecode(p256dh), b64uDecode(auth), plaintext, eph as CryptoKeyPair, salt);
}

/* ---------- RFC 8292 ----------
   An ES256 JWT audienced to the push service's origin. Cached per
   origin: the token is valid for hours, and one digest run can touch
   hundreds of subscriptions across only three or four origins. */
const jwtCache = new Map<string, { header: string; exp: number }>();

export async function vapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = b64uDecode(publicKey); // 0x04 || X(32) || Y(32)
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC", crv: "P-256", ext: true,
      d: privateKey,
      x: b64uEncode(pub.slice(1, 33)),
      y: b64uEncode(pub.slice(33, 65)),
    },
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

export async function authHeader(
  audience: string,
  opts: { publicKey: string; privateKey: string; subject: string; ttl: number },
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const hit = jwtCache.get(audience);
  if (hit && hit.exp - now > 300) return hit.header;

  const exp = now + opts.ttl;
  const seg = (o: unknown) => b64uEncode(utf8(JSON.stringify(o)));
  const signing = `${seg({ typ: "JWT", alg: "ES256" })}.${seg({ aud: audience, exp, sub: opts.subject })}`;
  // WebCrypto emits ECDSA as raw r||s, which is exactly what JWS wants —
  // no DER unwrapping, unlike Node's crypto.sign().
  const key = await vapidKey(opts.publicKey, opts.privateKey);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signing)));
  const header = `vapid t=${signing}.${b64uEncode(sig)}, k=${opts.publicKey}`;
  jwtCache.set(audience, { header, exp });
  return header;
}
