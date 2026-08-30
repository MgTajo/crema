/* Like someone else's pour.

   B poured during setup; A likes it here. Both directions are covered,
   partly because unliking is the half nobody tests and partly because
   it leaves the account usable for the next run — which matters when
   CREMA_E2E_EMAIL points at an account somebody made by hand. */
import { test, expect } from '@playwright/test';
import { accounts } from '../support/accounts.js';
import { openApp, postCard, postIdOf, reload } from '../support/app.js';
import { likeExists, until } from '../support/db.js';


test("A likes B's pour, and the like survives a reload", async ({ page }) => {
  const { a, seedCaption } = accounts();   // read inside the test — see 02
  await openApp(page);

  const card = postCard(page, seedCaption);
  await expect(card, "B's seed pour should be in today's feed").toBeVisible({ timeout: 20000 });
  const postId = await postIdOf(card);

  const like = card.locator('[data-action="like"]');
  await expect(like).not.toHaveClass(/liked/);
  await like.click();
  await expect(like).toHaveClass(/liked/);

  await until(() => likeExists(postId, a.uid), { what: 'the like row' });

  await reload(page);
  const again = postCard(page, seedCaption);
  await expect(again.locator('[data-action="like"]')).toHaveClass(/liked/, { timeout: 20000 });

  /* Unlike, and leave nothing behind. */
  await again.locator('[data-action="like"]').click();
  await expect(again.locator('[data-action="like"]')).not.toHaveClass(/liked/);
  await until(async () => !(await likeExists(postId, a.uid)), { what: 'the like row to go away' });
});
