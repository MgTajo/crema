/* Post a pour — the one thing Crema is for.

   The UI assertion is nearly free, because submitPost() puts the card
   on screen before it has asked the server anything. The one that
   matters is the row. */
import { test, expect } from '@playwright/test';
import { accounts } from '../support/accounts.js';
import { openApp, postPour, postCard, postIdOf, reload } from '../support/app.js';
import { pourByCaption, until } from '../support/db.js';


test('a pour reaches the database and comes back on a reload', async ({ page }) => {
  /* Read inside the test, not at import time: Playwright collects
     every spec file before the setup project has run. */
  const { a, runId } = accounts();
  const caption = `e2e ${runId} — A pours one`;
  await openApp(page);
  await postPour(page, caption);

  const row = await until(() => pourByCaption(caption), { what: 'the new pour' });
  expect(row.user_id).toBe(a.uid);
  expect(row.visibility).toBe('public');
  /* freshCreate() carries the account's go-to drink, so a pour posted
     with nothing but a caption still has one. A null here would mean
     the composer's defaults stopped arriving. */
  expect(row.drink, 'a pour posted at defaults still names a drink').toBeTruthy();

  await reload(page);
  const card = postCard(page, caption);
  await expect(card).toBeVisible({ timeout: 20000 });
  expect(await postIdOf(card)).toBe(row.id);
});
