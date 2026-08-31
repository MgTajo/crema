/* ============================================================
   config — which backend does this build talk to?

     node src/config.test.mjs

   There is one bug this file exists to prevent, and it is the worst one
   available in step 4.1: a store build that writes to STAGING.

   The setup that makes it possible is not obvious, which is exactly why
   it needs a test rather than a comment. Capacitor serves the bundled
   app from a local origin. 'localhost' is in config.js's LOCAL_HOSTS,
   because that is where devserver.py serves from. Since 2026-08-30
   staging is configured, so LOCAL_HOSTS resolves to staging — correctly,
   for a developer. A native shell falling through to the same rule would
   ship to the App Store pointed at the test database, and would look
   completely normal doing it: a working Crema with an empty feed.

   So: three assertions about the native shell, and five about the web,
   because the web app is what people are using right now and the native
   branch is not allowed to have moved it by a millimetre.

   ENV is resolved once, at module evaluation, from globals. Each case
   therefore sets the globals and imports a fresh copy — the query string
   is what defeats the module cache.
   ============================================================ */
import assert from 'node:assert';

let n = 0;
/* `capacitor` is the object Capacitor puts on window; null means a
   browser. `hostname` is what location reports. */
async function envFor({ hostname, capacitor = null }){
  globalThis.window   = capacitor ? { Capacitor: capacitor } : {};
  globalThis.location = { hostname, href:`https://${hostname}/`, search:'' };
  const m = await import(`./config.js?case=${++n}`);
  return { ENV: m.ENV, url: m.SUPABASE_URL };
}

const PROD    = 'https://diabtvahplwoipvrprvb.supabase.co';
const STAGING = 'https://qqyurcqrikqvqgbjcjhg.supabase.co';

console.log('config — environment resolution\n');

/* ---------- the native shell ---------- */

const iosShell     = { isNativePlatform: () => true, getPlatform: () => 'ios' };
const androidShell = { isNativePlatform: () => true, getPlatform: () => 'android' };
/* Capacitor's own web target: the object is present and says so. */
const webTarget    = { isNativePlatform: () => false, getPlatform: () => 'web' };

/* Each assertion re-imports config.js, so they run sequentially. */
const cases = [
  ['iOS shell reporting localhost talks to production', async () => {
    const e = await envFor({ hostname:'localhost', capacitor: iosShell });
    assert.equal(e.ENV, 'production');
    assert.equal(e.url, PROD);
  }],
  ['Android shell reporting localhost talks to production', async () => {
    const e = await envFor({ hostname:'localhost', capacitor: androidShell });
    assert.equal(e.ENV, 'production');
    assert.equal(e.url, PROD);
  }],
  ['a native shell ignores even an explicit staging hostname', async () => {
    /* Belt and braces: if someone points server.hostname at staging in
       capacitor.config.json, the shell still refuses. A store binary has
       no business reaching the test database by any route. */
    const e = await envFor({ hostname:'staging.crema-app.com', capacitor: iosShell });
    assert.equal(e.ENV, 'production');
  }],

  /* ---------- the web app, unmoved ---------- */

  ['crema-app.com is production', async () => {
    const e = await envFor({ hostname:'crema-app.com' });
    assert.equal(e.ENV, 'production');
    assert.equal(e.url, PROD);
  }],
  ['staging.crema-app.com is staging', async () => {
    const e = await envFor({ hostname:'staging.crema-app.com' });
    assert.equal(e.ENV, 'staging');
    assert.equal(e.url, STAGING);
  }],
  ['localhost in a browser is still staging', async () => {
    /* The developer path, and the one the native guard is most likely to
       break by being written too broadly. */
    const e = await envFor({ hostname:'localhost' });
    assert.equal(e.ENV, 'staging');
  }],
  ['127.0.0.1 in a browser is still staging', async () => {
    const e = await envFor({ hostname:'127.0.0.1' });
    assert.equal(e.ENV, 'staging');
  }],
  ['an unlisted host is production, as it was before', async () => {
    const e = await envFor({ hostname:'someones-fork.example' });
    assert.equal(e.ENV, 'production');
  }],
  ['Capacitor\'s web target is a browser, not a shell', async () => {
    /* The PWA loaded in a page that happens to have Capacitor present.
       isNativePlatform() is false, so the hostname rules apply. */
    const e = await envFor({ hostname:'localhost', capacitor: webTarget });
    assert.equal(e.ENV, 'staging');
  }],
];

let p = 0, f = 0;
for(const [name, fn] of cases){
  try{ await fn(); console.log(`  ok   ${name}`); p++; }
  catch(e){ console.log(`  FAIL ${name}\n       ${e.message}`); f++; }
}
console.log(`\n${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
