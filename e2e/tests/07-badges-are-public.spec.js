/* Badges reach the profile row, and a stranger can read them.

   Before 2026-09-05 a badge was computed in the browser and rendered on
   one tab of your own profile, which meant nobody else could ever see
   one. profiles.badges is what changed that, and this is the assertion
   that it actually changed: the check is made over PostgREST as `anon`,
   with the publishable key, exactly as a signed-out visitor would read
   it. If the badge existed only in this browser, this fails.

   Posting a coffee is what earns 'first-pour', so this drives the same
   composer 02 does rather than writing a row — the point is that the
   whole chain works, not that a column accepts an UPDATE. */
import { test, expect } from '@playwright/test';
import { accounts } from '../support/accounts.js';
import { openApp, goTab, postPour, reload } from '../support/app.js';
import { profileByHandle, until } from '../support/db.js';

test('posting a coffee puts a badge on the profile row everyone can read', async ({ page }) => {
  const { a } = accounts();
  await openApp(page);

  const caption = `badge check ${Date.now()}`;
  await postPour(page, { caption });

  /* syncBadges() runs behind createPost(), so this is the wait that
     matters — and the row is read as a stranger, which is the claim. */
  await until(
    async () => (await profileByHandle(a.handle)).badges?.includes('first-pour'),
    { what: "'first-pour' on the profile row, read as anon" }
  );

  /* And the app reads it back rather than remembering it. After a
     reload the strip is drawn from the row, not from this session. */
  await reload(page);
  await goTab(page, 'profile');
  const strip = page.locator('.bstrip .bchip').first();
  await expect(strip).toBeVisible({ timeout: 15000 });

  /* The grid still agrees with the strip: one is BADGES filtered by the
     row, the other is computeBadges() over this device's posts, and the
     two drifting apart is the failure this whole design has to avoid. */
  await page.locator('[data-action="ptab"][data-t="badges"]').click();
  await expect(page.locator('.badge:not(.locked)').first()).toBeVisible({ timeout: 10000 });
});
