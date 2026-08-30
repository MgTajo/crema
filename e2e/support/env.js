/* ============================================================
   Which backend the suite is allowed to touch, and the guard that
   stops it being the wrong one.

   ⚠️ This is the most important file in e2e/. Verifying the new
   sign-up flow by hand once created a real `test@test` account in
   PRODUCTION (brain/11-open-questions.md, Q14) — one careless session,
   one row in the real users table that nobody can delete from inside
   the app because account deletion does not exist yet (Phase 3.3).

   A test suite that signs up, posts and redeems on every release tag is
   that mistake automated. So the production project ref is named here
   as something to REFUSE, in Node and again inside the browser
   (assertNotProduction in support/app.js) — the page resolves its own
   endpoint from location.hostname (src/config.js), so the only honest
   check is to ask the page what it resolved.
   ============================================================ */

/* The staging project. The publishable key is designed to ship in
   client code — it grants the `anon` role and RLS is what protects the
   data — so it is committed here for the same reason it is committed in
   src/config.js. The service_role key must never appear in this repo. */
export const SUPABASE_URL = process.env.CREMA_E2E_SUPABASE_URL
  || 'https://qqyurcqrikqvqgbjcjhg.supabase.co';
export const SUPABASE_KEY = process.env.CREMA_E2E_SUPABASE_KEY
  || 'sb_publishable_oucpi3Bkw-bxQS_gUnp8Xg_lctghGb2';

const PRODUCTION_REF = 'diabtvahplwoipvrprvb';

export function assertNotProductionUrl(url, where) {
  if (String(url).includes(PRODUCTION_REF)) {
    throw new Error(
      `e2e refuses to run against production (${where} → ${url}).\n` +
      'These tests sign up, post and redeem. See brain/11-open-questions.md Q14.');
  }
}
assertNotProductionUrl(SUPABASE_URL, 'CREMA_E2E_SUPABASE_URL');

/* Where the app under test is served from. devserver.py serves the repo
   root, which IS the web root, so what the browser loads is exactly the
   working tree — and src/config.js maps localhost to staging on its
   own. Nothing is injected and nothing is built. */
export const BASE_URL = process.env.CREMA_E2E_BASE_URL || 'http://localhost:4599';

/* One id per run, stamped into every caption, username and email the
   suite creates. Staging keeps them — nothing here can delete an auth
   user — so they have to be recognisable as ours and as one run's. */
export const RUN_ID = process.env.CREMA_E2E_RUN_ID
  || new Date().toISOString().replace(/\D/g, '').slice(2, 14);

/* The domain minted accounts are created under.

   Not example.com, and not a made-up subdomain: Supabase validates the
   address and rejects both — `email_address_invalid`, which arrives at
   the gate looking exactly like a bug in the sign-up. It wants a domain
   that resolves for mail, so this uses the one Crema already owns.

   No mail is ever sent to it, because staging must have email
   auto-confirmation ON for this suite to run at all (see
   accounts.setup.js). If somebody turns confirmation back on, the suite
   stops with that as its reason rather than quietly posting to an
   inbox nobody reads. */
export const EMAIL_DOMAIN = process.env.CREMA_E2E_EMAIL_DOMAIN || 'crema-app.com';

/* Whether the staging project confirms email addresses by itself, the
   way production does. Asked before anything is typed: without it the
   sign-up cannot complete, the built-in mailer is capped at a couple of
   messages an hour (1b.4), and the failure otherwise shows up 25
   seconds later as a timeout on a button. */
export async function assertAutoConfirm() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_KEY } });
  if (!res.ok) throw new Error(`could not read ${SUPABASE_URL}/auth/v1/settings — ${res.status}`);
  const s = await res.json();
  if (s.mailer_autoconfirm) return;
  throw new Error(
    'This project still confirms email addresses by mail, so the suite cannot create its accounts.\n\n' +
    `  Supabase dashboard → ${SUPABASE_URL.replace('https://', '').split('.')[0]}\n` +
    '  → Authentication → Sign In / Providers → Email → turn OFF "Confirm email".\n\n' +
    'Production already has it off; this only makes staging match it. The alternative is to\n' +
    'set CREMA_E2E_EMAIL / CREMA_E2E_PASSWORD and CREMA_E2E_EMAIL_2 / CREMA_E2E_PASSWORD_2\n' +
    'to two accounts confirmed by hand, which this suite will sign in with instead.');
}
