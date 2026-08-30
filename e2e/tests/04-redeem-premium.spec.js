/* Redeem Premium.

   The client checks the code first only so a wrong one can be answered
   instantly and offline; redeem_premium() in Postgres is the only thing
   that can raise the flag (step-1.21). So the assertion is the column,
   read back as a stranger would read it — if `premium` were true only
   in this browser, this would fail.

   Turned off again at the end. Premium is a switch, not a purchase,
   and leaving it on would make the second run of this file a different
   test from the first. */
import { test, expect } from '@playwright/test';
import { accounts } from '../support/accounts.js';
import { openApp, openSettings, goTab, reload } from '../support/app.js';
import { profileByHandle, until } from '../support/db.js';

const CODE = 'FIRSTPOUR';   // src/domain/premium.js — change one, change both

test('a code raises the flag on the account, not just in the browser', async ({ page }) => {
  const { a } = accounts();   // read inside the test — see 02
  await openApp(page);

  const before = await profileByHandle(a.handle);
  expect(before, `no profile row for @${a.handle}`).toBeTruthy();
  if (before.premium) {
    await openSettings(page);
    await page.locator('[data-action="premium-off"]').click();
    await until(async () => !(await profileByHandle(a.handle)).premium, { what: 'premium to go off first' });
    await page.reload();
    await openApp(page);
  }

  await openSettings(page);
  await page.fill('#sp-code', CODE);
  await page.locator('[data-action="redeem-premium"][data-i="sp-code"]').click();

  await until(async () => (await profileByHandle(a.handle)).premium, { what: 'premium on the profile row' });

  /* And the app reads it back. The gold ring on the profile avatar is
     drawn from state.me.premium, which after a reload came from the
     row rather than from this session's optimism. */
  await reload(page);
  await goTab(page, 'profile');
  await expect(page.locator('.prof-av.prem')).toBeVisible({ timeout: 15000 });

  await openSettings(page);
  await page.locator('[data-action="premium-off"]').click();
  await until(async () => !(await profileByHandle(a.handle)).premium, { what: 'premium to go off again' });
});
