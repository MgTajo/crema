/* Sign in — the flow every other one is standing on.

   Deliberately without the stored session: this is the only spec that
   starts from a browser that has never seen Crema, which is what a
   returning visitor on a new phone actually is. */
import { test, expect } from '@playwright/test';
import { accounts } from '../support/accounts.js';
import { openApp, signInThroughUI, reload } from '../support/app.js';

test.use({ storageState: { cookies: [], origins: [] } });


test('a guest reads the feed, signs in, and stays signed in', async ({ page }) => {
  const { a } = accounts();   // read inside the test — see 02
  /* A visitor with no session lands on the public feed, not on a wall.
     That is the product decision the gate's comment describes, and it
     is worth one assertion of its own. */
  await openApp(page);
  await expect(page.locator('#view')).toHaveAttribute('data-route', 'guest');

  await signInThroughUI(page, a);

  const uid = await page.evaluate(() =>
    import('/src/data/supabase.js').then(m => (m.currentUser() || {}).id || null));
  expect(uid).toBe(a.uid);

  /* The session is kept in localStorage and only discarded when the
     server rejects it, so a reload must not send anybody back to the
     gate. This is the assertion that would have caught a broken
     adoptSession(). */
  await reload(page);
  await expect(page.locator('#tabbar .tab')).toHaveCount(5);
  await expect(page.locator('#view')).not.toHaveAttribute('data-route', 'gate');
});
