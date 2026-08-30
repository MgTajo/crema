/* Q17 — a background repaint must not throw away what somebody is typing.

   Two tests, because the fix is two rules and only one of them is
   obvious. Typing has to survive a repaint of the same screen; and the
   renderer still has to be able to change a field on purpose, or
   `clear-search` could no longer clear the search box.

   See src/ui/keepinput.js. */
import { test, expect } from '@playwright/test';
import { openApp, settle, goTab } from '../support/app.js';

/* ---------------------------------------------------------------- */
test.describe('typing survives the boot repaint', () => {
  /* Signed out, and — unlike every other spec — NOT waiting for the app
     to settle. The whole point is to be typing while app.js's render()
     lands, which is the sequence that emptied the field. */
  test.use({ storageState: { cookies: [], origins: [] } });

  const EMAIL = 'q17-survives@crema-app.com';
  const PW    = 'never-submitted-anywhere';

  test('the gate keeps the email and the password', async ({ page }) => {
    /* Count wholesale replacements of #view from before the FIRST byte
       of app.js runs, not from after openApp() returns. Attaching the
       observer later left a window — clicking "Sign in" and waiting for
       #au-email both cost time — in which the boot repaint could land
       unobserved on a fast connection. It did, once, in CI: the run
       reported zero repaints and the guard correctly refused to certify
       it, but that made the whole spec flaky rather than meaningful.

       #view is static markup in index.html, already parsed by the time
       Playwright's init script runs (it fires after the document exists
       and before the page's own scripts execute) — so this attaches
       before app.js's first render() can fire, and the race is gone
       rather than merely narrowed. */
    await page.addInitScript(() => {
      window.__repaints = 0;
      const attach = () => {
        const v = document.getElementById('view');
        if (!v) { requestAnimationFrame(attach); return; } // belt and braces
        new MutationObserver(rs => rs.forEach(r => { if (r.addedNodes.length) window.__repaints++; }))
          .observe(v, { childList: true });
      };
      attach();
    });

    await openApp(page, { wait: false });
    await page.locator('[data-action="guest-signin"][data-m="in"]').first().click();
    await expect(page.locator('#au-email')).toBeVisible();

    await page.fill('#au-email', EMAIL);
    await page.fill('#au-pw', PW);
    await settle(page);

    expect(await page.evaluate(() => window.__repaints),
      'no repaint happened, so this test proved nothing').toBeGreaterThan(0);
    await expect(page.locator('#au-email')).toHaveValue(EMAIL);
    await expect(page.locator('#au-pw')).toHaveValue(PW);
  });
});

/* ---------------------------------------------------------------- */
test.describe('the renderer still wins when it means to', () => {
  /* Signed in — Explore, and therefore the search box, is not a screen a
     guest ever reaches: renderView() paints the guest feed whatever
     ui.route says. */
  test('clearing the search box still clears it', async ({ page }) => {
    await openApp(page);
    await goTab(page, 'explore');

    await page.fill('#search-input', 'cappuccino');
    await expect(page.locator('#search-input')).toHaveValue('cappuccino');

    await page.locator('[data-action="clear-search"]').first().click();
    await expect(page.locator('#search-input')).toHaveValue('');
  });
});
