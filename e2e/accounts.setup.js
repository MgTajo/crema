/* ============================================================
   The two accounts the flows need, and the pour one of them leaves
   behind for the other to like.

   Two, because "like someone else's pour" is not a flow you can test
   with one. B exists to have poured; every spec afterwards runs as A.

   By default the accounts are MINTED — signed up through the app's own
   three-step sign-up, which is the flow D-2026-08-27-03 shipped and the
   one worth exercising anyway. That needs staging to auto-confirm
   email, the way production does. If it does not, set
   CREMA_E2E_EMAIL/PASSWORD and CREMA_E2E_EMAIL_2/PASSWORD_2 to two
   accounts somebody made by hand and this signs in with those instead.

   ⚠️ Nothing here can clean up after itself: deleting an auth user
   needs the service-role key, and account deletion does not exist in
   the app yet (Phase 3.3). So a minted run leaves two accounts on
   staging, for ever. They are named for the run that made them so the
   pile stays readable, and staging is the only place this is allowed to
   happen — see support/env.js.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { test as setup, expect } from '@playwright/test';
import { RUN_ID, EMAIL_DOMAIN, assertAutoConfirm } from './support/env.js';
import { openApp, signUpThroughUI, signInThroughUI, postPour } from './support/app.js';
import { pourByCaption, until } from './support/db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const AUTH_DIR = path.join(HERE, '.auth');
export const ACCOUNTS = path.join(AUTH_DIR, 'accounts.json');
export const STATE_A  = path.join(AUTH_DIR, 'a.json');

const mint = (slot, envEmail, envPassword) => ({
  slot,
  minted: !envEmail,
  name: `E2E ${slot.toUpperCase()} ${RUN_ID}`,
  handle: `e2e${RUN_ID}${slot}`,
  city: 'Berlin',
  email: envEmail || `crema-e2e-${RUN_ID}-${slot}@${EMAIL_DOMAIN}`,
  /* Long enough for the gate's own eight-character rule, and not a
     secret: it belongs to a throwaway account on a throwaway database.
     It is written to .auth/, which is gitignored. */
  password: envPassword || `e2e-${RUN_ID}-${slot}-pour`,
});

setup('two accounts and a pour to like', async ({ page, context }) => {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const a = mint('a', process.env.CREMA_E2E_EMAIL,   process.env.CREMA_E2E_PASSWORD);
  const b = mint('b', process.env.CREMA_E2E_EMAIL_2, process.env.CREMA_E2E_PASSWORD_2);

  /* Ask before typing: minting an account needs the project to confirm
     addresses by itself. Nothing below can work around it. */
  if (a.minted || b.minted) await assertAutoConfirm();

  /* ---- B first: it signs in, pours, and is never needed again ---- */
  await (b.minted ? signUpThroughUI(page, b) : signInThroughUI(page, b));
  b.uid = await uidOf(page);
  const caption = `e2e ${RUN_ID} — a pour for A to like`;
  await postPour(page, caption);
  /* Assert the seed reached the database before anything is built on
     it. A like test that fails because the pour was never really there
     is a test that blames the wrong flow. */
  const seeded = await until(() => pourByCaption(caption), { what: `B's seed pour` });
  expect(seeded.user_id).toBe(b.uid);

  /* ---- A, in a context of its own, so B's session cannot leak in ---- */
  const pageA = await (await context.browser().newContext()).newPage();
  await (a.minted ? signUpThroughUI(pageA, a) : signInThroughUI(pageA, a));
  a.uid = await uidOf(pageA);
  await pageA.context().storageState({ path: STATE_A });

  fs.writeFileSync(ACCOUNTS, JSON.stringify({ runId: RUN_ID, a, b, seedCaption: caption }, null, 2));
  await pageA.context().close();
});

/* The app's own answer to "who is signed in". Dynamic import hits the
   module instance app.js already loaded — same URL, same ES module
   registry — so this reads the live session rather than a second copy
   of the library. */
async function uidOf(page) {
  const id = await page.evaluate(() =>
    import('/src/data/supabase.js').then(m => (m.currentUser() || {}).id || null));
  expect(id, 'the app should have a signed-in user by now').toBeTruthy();
  return id;
}
