/* Export your data, then delete your account.

   Step 3.3, and the flow with the least room for a second chance: a
   pour can be re-posted and a like re-given, but there is nothing to
   press afterwards if this one is wrong. It is also the only flow that
   spans all three halves of the backend at once — a Postgres function
   assembles the export, an Edge Function empties R2 and calls the auth
   Admin API, and the foreign keys do the rest — so it is the one where
   "green in CI" and "works" have the most ways to come apart.

   It runs as an account of its own, minted here and gone by the end.
   Every other spec shares account A, and a spec that deleted A would
   take the suite with it.

   ⚠️ This is also the first thing in e2e/ that cleans up after itself.
   accounts.setup.js says a minted run leaves two accounts on staging
   for ever, because nothing could delete an auth user. That is now only
   true of A and B.
*/
import { test, expect } from '@playwright/test';
import { RUN_ID, EMAIL_DOMAIN, assertAutoConfirm } from '../support/env.js';
import { signUpThroughUI, openSettings, closeOverlays, postPour } from '../support/app.js';
import { profileByHandle, pourByCaption, until } from '../support/db.js';

test.use({ storageState: { cookies: [], origins: [] } });

const acct = {
  name:   `E2E Z ${RUN_ID}`,
  handle: `e2e${RUN_ID}z`,
  city:   'Berlin',
  email:  `crema-e2e-${RUN_ID}-z@${EMAIL_DOMAIN}`,
  password: `e2e-${RUN_ID}-z-pour`,
};

test('a person takes a copy of everything, then leaves, and nothing of theirs is left', async ({ page }) => {
  /* Supplied accounts are somebody's real ones. This test ends by
     deleting the account it runs as, so it mints or it does not run. */
  if (process.env.CREMA_E2E_EMAIL) test.skip(true, 'accounts are supplied by secret — refusing to delete one');
  await assertAutoConfirm();

  await signUpThroughUI(page, acct);
  const caption = `e2e ${RUN_ID} — the pour that leaves with them`;
  await postPour(page, caption);
  const pour = await until(() => pourByCaption(caption), { what: 'the pour to reach Postgres' });

  /* ---- the export ---- */
  await openSettings(page);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.ov-body [data-action="export-data"]').first().click(),
  ]);
  const stream = await download.createReadStream();
  let raw = '';
  for await (const chunk of stream) raw += chunk;
  const doc = JSON.parse(raw);

  expect(doc.format).toBe('crema-export-1');
  expect(doc.profile.handle).toBe(acct.handle);
  expect(doc.account.email).toBe(acct.email);
  /* The point of the export is that it is the person's own rows, all of
     them — so the pour that exists in Postgres has to be in the file. */
  expect(doc.posts.map(p => p.caption)).toContain(caption);
  expect(doc.posts.find(p => p.caption === caption).id).toBe(pour.id);

  /* Settings is still open from the export, and openSettings() goes via
     the tab bar — which a sheet covers. */
  await closeOverlays(page);

  /* ---- and then the account ----
     Asked first, because deleting an account is not something to start
     and then discover cannot finish: a staging project with no R2
     credentials answers `no_storage` and nothing has been touched. */
  const ready = await page.evaluate(async () => {
    const m = await import('/src/data/account.js');
    try { await m.deleteMyAccount(''); return 'yes'; }
    catch (e) { return /not configured/.test(e.message) ? 'no_storage' : 'yes'; }
  });
  test.skip(ready === 'no_storage',
    'staging has no R2 credentials — set them there to test deletion end to end');

  await openSettings(page);
  await page.locator('[data-action="open-delete-account"]').click();

  /* The wrong word must not delete anything. Asserted before the right
     one, because a confirmation that does not actually gate is exactly
     the kind of thing that passes a happy-path test. */
  await page.fill('#del-confirm', 'delete');
  await page.locator('[data-action="delete-account"]').click();
  await expect(page.locator('.ov-body')).toContainText(acct.handle);
  expect(await profileByHandle(acct.handle), 'the wrong word deleted the account').toBeTruthy();

  await page.fill('#del-confirm', acct.handle);
  await page.locator('[data-action="delete-account"]').click();

  /* Read as a stranger would read it. The browser signing itself out is
     not evidence of anything; the absent row is. */
  await until(async () => (await profileByHandle(acct.handle)) === null,
    { what: 'the profile row to be gone', timeout: 30000 });
  await until(async () => (await pourByCaption(caption)) === null,
    { what: 'the pour to go with it' });

  /* And the session is over on this device — the gate, not a feed with
     a dead account behind it. */
  await expect(page.locator('#view')).toHaveAttribute('data-route', 'guest', { timeout: 15000 });
});
