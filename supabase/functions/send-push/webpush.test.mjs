/* Verifies the Web Push crypto against the published RFC test vectors.
   Run:  node --experimental-strip-types supabase/functions/send-push/webpush.test.mjs

   The RFC 8291 §5 vector is the important one. It pins down the things a
   self-consistent implementation gets away with being wrong about: the
   order of the two public keys inside `key_info`, the exact info
   strings, the aes128gcm header layout and the 0x02 record delimiter.
   Encrypting the vector's plaintext with the vector's ephemeral key and
   salt must reproduce the vector's body byte for byte. */
import { encryptWith, authHeader, b64uDecode, b64uEncode, hkdf, utf8 }
  from "./webpush.ts";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok  ", label); }
  else { fail++; console.log("  FAIL", label, extra); }
};

/* ---------- RFC 8291 §5 ---------- */
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

console.log("RFC 8291 §5 — aes128gcm payload encryption");

const pub = b64uDecode(V.asPublic);
const ephPrivate = await crypto.subtle.importKey(
  "jwk",
  { kty: "EC", crv: "P-256", ext: true, d: V.asPrivate,
    x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33, 65)) },
  { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"],
);
const ephPublic = await crypto.subtle.importKey(
  "raw", pub, { name: "ECDH", namedCurve: "P-256" }, true, [],
);

const got = await encryptWith(
  b64uDecode(V.uaPublic),
  b64uDecode(V.authSecret),
  utf8(V.plaintext),
  { privateKey: ephPrivate, publicKey: ephPublic },
  b64uDecode(V.salt),
);

const gotB64 = b64uEncode(got);
ok("body matches the published vector byte for byte", gotB64 === V.body,
   `\n        got  ${gotB64}\n        want ${V.body}`);
ok("header salt is the first 16 bytes", b64uEncode(got.slice(0, 16)) === V.salt);
ok("record size field is 4096", new DataView(got.buffer, got.byteOffset + 16, 4).getUint32(0) === 4096);
ok("key id length byte is 65", got[20] === 65);
ok("key id is the sender public key", b64uEncode(got.slice(21, 86)) === V.asPublic);

/* ---------- RFC 5869 §A.1 — the HKDF underneath it ---------- */
console.log("\nRFC 5869 §A.1 — HKDF-SHA256");
const okm = await hkdf(
  new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
  new Uint8Array(22).fill(0x0b),
  new Uint8Array([0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9]),
  32,
);
const hex = [...okm].map((b) => b.toString(16).padStart(2, "0")).join("");
ok("first 32 bytes of OKM match",
   hex === "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf",
   `\n        got  ${hex}`);

/* ---------- RFC 8292 — the VAPID header ---------- */
console.log("\nRFC 8292 — VAPID Authorization header");
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const rawPub = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
const opts = {
  publicKey: b64uEncode(rawPub), privateKey: jwk.d,
  subject: "mailto:hello@crema-app.com", ttl: 43200,
};
const header = await authHeader("https://fcm.googleapis.com", opts);
ok("header has the vapid t=/k= shape", /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/.test(header), `\n        ${header}`);

const [, token] = header.match(/t=([^,]+)/);
const [h64, p64, s64] = token.split(".");
const claims = JSON.parse(new TextDecoder().decode(b64uDecode(p64)));
ok("alg is ES256", JSON.parse(new TextDecoder().decode(b64uDecode(h64))).alg === "ES256");
ok("aud is the push service origin", claims.aud === "https://fcm.googleapis.com");
ok("sub is the contact", claims.sub === "mailto:hello@crema-app.com");
ok("exp is in the future and within 24h",
   claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400);
ok("signature is 64 raw bytes (r||s, not DER)", b64uDecode(s64).length === 64);
ok("signature verifies against the public key",
   await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, kp.publicKey,
                              b64uDecode(s64), utf8(`${h64}.${p64}`)));
ok("k= carries the public key that signed it", header.endsWith(`k=${b64uEncode(rawPub)}`));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
