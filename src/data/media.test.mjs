/* ============================================================
   media — a photo upload survives a session that ended somewhere else.

     node src/data/media.test.mjs

   2026-09-15: signing out on crema-app.com sent GoTrue's default,
   scope=global, and revoked the Android app's session with it. The app
   kept reading the feed on its unexpired token — PostgREST checks only
   the signature — while upload-url, which asks GoTrue, answered 401 to
   every photo, and the app said "tap Post to retry" to something no
   retry could fix. Reproduced against staging before this was written.

   fetch is a script here, so nothing reaches a network.
   ============================================================ */
import assert from 'node:assert';

let n = 0;
const check = async (name, fn) => { await fn(); n++; console.log('  ok  ' + name); };

/* Just enough browser for data/supabase.js and data/media.js to load. */
const mem = new Map();
globalThis.localStorage = {
  getItem: k => mem.has(k) ? mem.get(k) : null,
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};
globalThis.location = { href:'https://crema-app.com/', hostname:'crema-app.com', hash:'', search:'' };

/* Each test hands fetch a list of answers, matched in order by URL. */
let script = [], calls = [];
const res = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body ?? {} });
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url: String(url), opts });
  const i = script.findIndex(s => s.match.test(String(url)));
  assert.ok(i >= 0, `unexpected request: ${opts.method || 'GET'} ${url}`);
  const [s] = script.splice(i, 1);
  if (s.throws) throw new TypeError('Failed to fetch');
  return res(s.status, s.body);
};

const sb = await import('./supabase.js');
const { uploadImage } = await import('./media.js');

const tokens = at => ({ access_token: at, refresh_token: 'rt-' + at, expires_in: 3600, user: { id: 'u1' } });
async function signedIn(at = 'A'){
  script = [{ match: /grant_type=password/, status: 200, body: tokens(at) }];
  await sb.signInWithPassword('x@crema-app.com', 'pw');
  calls = [];
}
const blob = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
const signed = { key: 'posts/u1/k.jpg', uploadUrl: 'https://r2.example/put', expiresIn: 900 };
const bearer = c => c.opts.headers && c.opts.headers.Authorization;

await check('signing out revokes this device only (scope=local)', async () => {
  await signedIn();
  script = [{ match: /\/auth\/v1\/logout/, status: 204 }];
  await sb.signOut();
  assert.match(calls[0].url, /\/auth\/v1\/logout\?scope=local$/);
  assert.equal(sb.getSession(), null);
});

await check('an ordinary upload is one presign and one PUT', async () => {
  await signedIn();
  script = [
    { match: /upload-url/, status: 200, body: signed },
    { match: /r2\.example/, status: 200 },
  ];
  assert.equal(await uploadImage(blob), signed.key);
  assert.equal(calls.length, 2);
});

await check('a revoked session that can still refresh: refresh, presign again, upload', async () => {
  await signedIn('A');
  script = [
    { match: /upload-url/, status: 401, body: { error: 'Invalid or expired session' } },
    { match: /grant_type=refresh_token/, status: 200, body: tokens('B') },
    { match: /upload-url/, status: 200, body: signed },
    { match: /r2\.example/, status: 200 },
  ];
  assert.equal(await uploadImage(blob), signed.key);
  const presigns = calls.filter(c => /upload-url/.test(c.url));
  assert.deepEqual(presigns.map(bearer), ['Bearer A', 'Bearer B']);
  assert.ok(sb.getSession());
});

await check('a revoked session whose refresh is refused too: signed out, told to sign in, no PUT', async () => {
  await signedIn('A');
  let heard = 0; const off = sb.onAuthChange(s => { if (!s) heard++; });
  script = [
    { match: /upload-url/, status: 401, body: { error: 'Invalid or expired session' } },
    { match: /grant_type=refresh_token/, status: 400, body: { msg: 'Invalid Refresh Token: Refresh Token Not Found' } },
  ];
  await assert.rejects(uploadImage(blob), e => e.signedOut === true && e.status === 401);
  off();
  assert.equal(sb.getSession(), null);
  assert.equal(heard, 1, 'the app is told the session ended, so it shows the sign-in');
  assert.ok(!calls.some(c => /r2\.example/.test(c.url)));
  assert.equal(calls.filter(c => /upload-url/.test(c.url)).length, 1, 'no second presign');
});

await check('a 401 and then no network: still signed in, and not told to sign in', async () => {
  await signedIn('A');
  script = [
    { match: /upload-url/, status: 401, body: { error: 'Invalid or expired session' } },
    { match: /grant_type=refresh_token/, throws: true },
  ];
  await assert.rejects(uploadImage(blob), e => !e.signedOut && e.status === 401);
  assert.ok(sb.getSession(), 'a network failure never costs someone their session');
});

await check('a second 401 after a good refresh is not a loop', async () => {
  await signedIn('A');
  script = [
    { match: /upload-url/, status: 401 },
    { match: /grant_type=refresh_token/, status: 200, body: tokens('B') },
    { match: /upload-url/, status: 401 },
  ];
  await assert.rejects(uploadImage(blob), e => e.status === 401);
  assert.equal(calls.filter(c => /upload-url/.test(c.url)).length, 2);
  assert.equal(script.length, 0);
});

await check('429 from upload-url is still an answer, not a sign-out', async () => {
  await signedIn('A');
  script = [{ match: /upload-url/, status: 429, body: { error: 'Too many photos at once — wait a minute and try again.' } }];
  await assert.rejects(uploadImage(blob), e => e.status === 429 && !e.signedOut);
  assert.ok(sb.getSession());
});

console.log(`media: ${n} checks passed`);
