#!/usr/bin/env node
/* ============================================================
   Move photos that were stored inline into R2, once.

   Every post created before the R2 bucket had a CORS policy holds its
   photo as a base64 data URI in `posts.image_key`. The upload failed in
   the browser (the preflight to R2 was rejected), the client fell back to
   keeping the image inline, and the post went out with 300 KB of base64
   in a column meant for an object key like `posts/<uid>/<uuid>.jpg`.

   This walks those rows, PUTs the bytes to R2 under the key the app
   would have used, and rewrites `image_key`. It is idempotent: a row is
   only touched if it still starts with `data:`.

   Run it AFTER fixing the bucket CORS policy — not because this script
   needs CORS (it signs requests directly, no browser involved), but
   because there is no point migrating while new posts keep arriving
   inline.

   Usage:

     SUPABASE_URL=https://<ref>.supabase.co \
     SUPABASE_SERVICE_ROLE_KEY=<service role key> \
     R2_ACCOUNT_ID=<id> R2_ACCESS_KEY_ID=<id> R2_SECRET_ACCESS_KEY=<secret> \
     R2_BUCKET=coffee [R2_JURISDICTION=eu] \
     node supabase/migrate-base64-images.mjs [--apply]

   Without --apply it prints what it would do and changes nothing.

   The service-role key bypasses RLS, which is why this is a local script
   you run rather than anything the app can reach. Never commit it, and
   never paste it into a chat window.
   ============================================================ */
import crypto from 'node:crypto';

const {
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET = 'coffee', R2_JURISDICTION = ''
} = process.env;

const APPLY = process.argv.includes('--apply');

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
    R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY })) {
  if (!v) { console.error(`Missing ${k}. See the header of this file.`); process.exit(1); }
}

const R2_HOST = R2_JURISDICTION
  ? `${R2_ACCOUNT_ID}.${R2_JURISDICTION}.r2.cloudflarestorage.com`
  : `${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

/* ---------- AWS SigV4, enough of it for one signed PUT ---------- */
const sha256hex = b => crypto.createHash('sha256').update(b).digest('hex');
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

function signedPutHeaders(key, body, contentType) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');   // 20260726T101500Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const canonicalUri = '/' + [R2_BUCKET, ...key.split('/')].map(encodeURIComponent).join('/');

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${R2_HOST}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest =
    ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign =
    ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const signingKey = hmac(hmac(hmac(hmac('AWS4' + R2_SECRET_ACCESS_KEY, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  return {
    'Content-Type': contentType,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${scope}, ` +
                   `SignedHeaders=${signedHeaders}, Signature=${signature}`
  };
}

/* ---------- Supabase, as service role ---------- */
const SB = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json'
};
async function rest(path, init = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: SB });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/* ---------- the migration ---------- */
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function decodeDataUri(uri) {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  const contentType = m[1];
  const body = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  return { contentType, body };
}

const rows = await rest('posts?select=id,user_id,image_key&image_key=like.data:*');
if (!rows.length) { console.log('Nothing to migrate — no post holds an inline image.'); process.exit(0); }

console.log(`${rows.length} post(s) with inline images${APPLY ? '' : '  (dry run — pass --apply to write)'}\n`);

let moved = 0, failed = 0, skipped = 0;
for (const p of rows) {
  const decoded = decodeDataUri(p.image_key);
  if (!decoded) { console.log(`  ${p.id}  ✗ not a data URI I understand — left alone`); skipped++; continue; }

  const { contentType, body } = decoded;
  const ext = EXT[contentType] || 'jpg';
  const key = `posts/${p.user_id}/${p.id}.${ext}`;
  const kb = Math.round(body.length / 1024);

  if (!APPLY) { console.log(`  ${p.id}  ${kb} KB ${contentType} → ${key}`); continue; }

  try {
    const put = await fetch(`https://${R2_HOST}/${R2_BUCKET}/${key}`, {
      method: 'PUT', body, headers: signedPutHeaders(key, body, contentType)
    });
    if (!put.ok) throw new Error(`R2 PUT ${put.status} ${(await put.text()).slice(0, 160)}`);

    /* Read it back before rewriting the row. This script's SigV4 is
       hand-rolled and was never run against R2 before you ran it — if the
       object isn't actually retrievable, the row must keep its inline copy
       rather than end up pointing at nothing. The delivery domain is
       public, so this check needs no signing. */
    const check = await fetch(`https://media.crema-app.com/${key}`, { method: 'HEAD' });
    if (!check.ok) throw new Error(`PUT succeeded but the object is not readable (${check.status}) — row left alone`);

    await rest(`posts?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ image_key: key }) });
    console.log(`  ${p.id}  ${kb} KB → ${key}  ✓ verified`);
    moved++;
  } catch (e) {
    console.log(`  ${p.id}  ✗ ${e.message}`);
    failed++;
  }
}

if (APPLY) {
  console.log(`\nmoved ${moved} · failed ${failed} · skipped ${skipped}`);
  if (!failed && !skipped) {
    console.log('\nAll clear. Now enforce it so this cannot come back:');
    console.log('  alter table posts validate constraint posts_image_key_is_a_key;');
  }
}
