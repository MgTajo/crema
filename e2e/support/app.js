/* ============================================================
   The app, as the tests speak to it.

   Every selector Crema is driven by lives here, so a rename in
   src/ui/ breaks one file rather than four. They are the app's own
   hooks — `data-action`, the field ids, and `#view[data-route]` — not
   text, because the app ships in two languages and a test that reads
   English is a test that fails the day somebody runs it in German.

   ⚠️ Crema is optimistic about writes. submitPost() puts the pour on
   screen and calls createPost() afterwards; toggling a like paints
   first too. So "it appeared" proves nothing about the database, and
   nothing in this file does. The assertions with teeth are in
   support/db.js, which reads the row back over PostgREST; the reload()
   below is the other half of the same question — that the app can read
   its own write back and draw it.
   ============================================================ */
import { expect } from '@playwright/test';
import { BASE_URL, assertNotProductionUrl } from './env.js';

/* ---------- opening the app ---------- */

/* Two flags are seeded before any script runs:
     · crema.lang=en — so the app and any text this suite ever reads
       agree on a language, whatever locale the runner has
     · crema.seen.daily-champion — app.js raises the "what's new" sheet
       1.4 s after a signed-in boot, which is exactly long enough to
       land on top of a button a test is about to press. */
export async function openApp(page, { path = '', wait = true } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('crema.lang', 'en');
      localStorage.setItem('crema.seen.daily-champion', '1');
    } catch (e) { /* nothing to do; the run just gets noisier */ }
  });
  await page.goto(BASE_URL + path);
  await expect(page.locator('#view')).toHaveAttribute('data-route', /guest|gate|home/, { timeout: 20000 });
  await assertNotProduction(page);
  /* `wait: false` is for 05-typing-survives-a-repaint.spec.js, which
     exists to be typing exactly while the boot repaints. */
  if (wait) await settle(page);
}

/* Wait until the app has stopped repainting itself.

   Not politeness — a precondition. Crema paints from localStorage first
   and goes to the network behind it (D-2026-08-20-01), and when that
   lands app.js calls render(), which replaces #view wholesale. Anything
   typed into a field before that moment is gone: the gate keeps the
   email in ui.auth only when syncAuth() has run and never keeps the
   password at all, and the same is true of the composer's caption and
   the Premium code field.

   `[FIXED 2026-08-30]` That used to be a real defect — Q17, found by
   this suite on its first run — and ui/keepinput.js now carries values,
   focus and the caret across a repaint. The wait stays anyway: these
   specs are about sign-in, posting, liking and redeeming, and none of
   them should be racing a boot to find out. **05-typing-survives-a-repaint.spec.js
   is the one that deliberately does not wait**, and it is what would
   notice if the fix were undone. */
export async function settle(page, { quiet = 700, timeout = 20000 } = {}) {
  await page.evaluate(({ quiet, timeout }) => new Promise(resolve => {
    const view = document.getElementById('view');
    if (!view) return resolve();
    let idle, hard;
    const done = () => { mo.disconnect(); clearTimeout(idle); clearTimeout(hard); resolve(); };
    const mo = new MutationObserver(() => { clearTimeout(idle); idle = setTimeout(done, quiet); });
    mo.observe(view, { childList: true, subtree: true, characterData: true });
    idle = setTimeout(done, quiet);
    hard = setTimeout(done, timeout);
  }), { quiet, timeout });
}

/* The page resolves its own backend from location.hostname, so this is
   the only check that reflects what the app under test will actually
   write to. It runs on every open, not once per suite. */
export async function assertNotProduction(page) {
  const cfg = await page.evaluate(() => import('/src/config.js').then(m => ({ env: m.ENV, url: m.SUPABASE_URL })));
  assertNotProductionUrl(cfg.url, 'the page');
  expect(cfg.env, 'the page must resolve a non-production backend').not.toBe('production');
  return cfg;
}

/* ---------- the gate ---------- */

export async function openGate(page, mode /* 'in' | 'up' */) {
  await page.locator(`[data-action="guest-signin"][data-m="${mode}"]`).first().click();
  await expect(page.locator('#view')).toHaveAttribute('data-route', 'gate');
}

/* The sign-up is three steps and the account is the LAST one — name,
   username and city, then the machine and the two go-to answers, then
   email and password (D-2026-08-27-03). All three are answered as a
   guest; only the username is checked against the server. */
export async function signUpThroughUI(page, acct) {
  await openApp(page);
  await openGate(page, 'up');

  await page.fill('#ob-name', acct.name);
  await page.fill('#ob-handle', acct.handle);
  await page.fill('#ob-city', acct.city);
  await page.locator('[data-action="signup-next"]').click();

  /* Step 2 is all defaults — the machine picker and the two go-to
     selects already carry the guest store's values. Nothing to fill in;
     the step exists to be passed through, and that is worth asserting. */
  await expect(page.locator('#ob-drink')).toBeVisible();
  await page.locator('[data-action="signup-next"]').click();

  await page.fill('#au-email', acct.email);
  await page.fill('#au-pw', acct.password);
  await page.locator('[data-action="auth-submit"]').click();

  await expectSignedIn(page, acct);
}

export async function signInThroughUI(page, acct) {
  await openApp(page);
  await openGate(page, 'in');
  await page.fill('#au-email', acct.email);
  await page.fill('#au-pw', acct.password);
  await page.locator('[data-action="auth-submit"]').click();
  await expectSignedIn(page, acct);
}

/* Signed in means the router left the gate and the tab bar is back.
   If it did not, say why in the terms the screen is using: the gate
   puts its own diagnosis in a banner, and the one that costs an hour if
   it is not read out loud is "confirm your email" — staging still has
   Confirm email switched ON, which production does not. */
async function expectSignedIn(page, acct) {
  const view = page.locator('#view');
  try {
    await expect(view).toHaveAttribute('data-route', /home|explore|cafes|profile/, { timeout: 25000 });
  } catch (err) {
    const banner = (await page.locator('#view div[style*="border-radius:12px"]').allInnerTexts()).join(' | ').trim();
    throw new Error(
      `${acct.email} did not get into the app.\n` +
      `The gate says: ${banner || '(nothing)'}\n\n` +
      'If that mentions confirming an email, the staging project still has\n' +
      'Authentication → Sign In / Providers → Email → "Confirm email" ON.\n' +
      'Production has it off. Turn it off on staging and this passes.');
  }
  await expect(page.locator('#tabbar .tab')).toHaveCount(5);
}

export async function signOut(page) {
  await openSettings(page);
  await page.locator('[data-action="sign-out"]').click();
  await expect(page.locator('#view')).toHaveAttribute('data-route', /guest|gate/, { timeout: 15000 });
}

/* ---------- getting around ---------- */

export async function goTab(page, route) {
  await page.locator(`#tabbar [data-action="nav"][data-r="${route}"]`).click();
  await expect(page.locator('#view')).toHaveAttribute('data-route', route);
}

export async function openSettings(page) {
  await goTab(page, 'profile');
  await page.locator('[data-action="open-settings"]').first().click();
  await expect(page.locator('#overlay [data-action="sign-out"]')).toBeVisible();
}

/* The X in the sheet's own bar, not the backdrop.
   `.ov-back` comes first in the DOM and is what `.first()` used to
   find — but a bottom sheet covers it, so the click lands on whatever
   row of the sheet happens to be underneath and the overlay never
   closes. It went unnoticed because the sheets this was used on were
   small enough to leave backdrop showing. */
export async function closeOverlays(page) {
  const close = () => {
    const bar = page.locator('#overlay .ov-bar [data-action="close-ov"]');
    return bar;
  };
  for (let i = 0; i < 6; i++) {
    const bar = close();
    if (await bar.count()) await bar.first().click();
    else if (await page.locator('#overlay [data-action="close-ov"]').count())
      await page.locator('#overlay [data-action="close-ov"]').first().click();
    else break;
    await page.waitForTimeout(150);
  }
}

/* ---------- posting a pour ---------- */

/* The composer with everything left at its defaults except the caption:
   freshCreate() already carries a drink, and a pour needs nothing else.
   No photo — an upload would drag R2 and the upload rate limiter into a
   test about posting. */
export async function postPour(page, caption) {
  await page.locator('#tabbar [data-action="open-create"]').click();
  await expect(page.locator('#c-caption')).toBeVisible();
  await page.fill('#c-caption', caption);
  await page.locator('[data-action="submit-post"]').click();
  await expect(page.locator('#view')).toHaveAttribute('data-route', 'home', { timeout: 15000 });
  await expect(postCard(page, caption)).toBeVisible({ timeout: 15000 });
}

/* A pour, found by the caption the run stamped into it. The card
   carries the post id in `data-post`, which is what every assertion
   against the database then asks about. */
export function postCard(page, caption) {
  return page.locator('.card', { hasText: caption }).first();
}

export async function postIdOf(card) {
  const id = await card.getAttribute('data-post');
  if (!id) throw new Error('that card carries no data-post id');
  return id;
}

/* ---------- reload ----------

   Worth doing even though support/db.js is what actually proves a write
   landed: it is the second half of the same question. db.js says the row
   is in Postgres; a reload says the app reads it back and draws it. A
   pour that exists but never reappears is still a broken flow. */
export async function reload(page) {
  await page.reload();
  await expect(page.locator('#view')).toHaveAttribute('data-route', /home|explore|cafes|profile/, { timeout: 20000 });
  await settle(page);
}
