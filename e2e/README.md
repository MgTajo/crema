# e2e — the four flows that must never break

Playwright against **staging**, never against production. Phase 2.5 of
`brain/13-infrastructure-plan.md`.

| Spec | What breaks if it goes red |
|---|---|
| `01-sign-in.spec.js` | Nobody can get back into their account |
| `02-post-a-pour.spec.js` | The app does not do the one thing it is for |
| `03-like-someone-elses-pour.spec.js` | The social half is decoration |
| `04-redeem-premium.spec.js` | The only thing Crema asks anyone for stops working |

## Run it

```bash
cd e2e
npm install
npx playwright install chromium   # once
npx playwright test
```

Playwright starts `devserver.py` on port 4599 itself, so the app under test is
the working tree — no build, no deploy, no bundler. `src/config.js` maps
`localhost` to the staging backend on its own (step 1.2), which is the whole
reason this needs no environment plumbing.

`npx playwright test --ui` to watch it, `npx playwright show-report` afterwards.

## What it needs from the staging project

1. **Email auto-confirmation ON** — Authentication → Sign In / Providers →
   Email → *Confirm email* **off**. Production already has it off. Without it
   the suite cannot create the accounts it runs as, and the built-in mailer is
   capped at a couple of messages an hour anyway (plan step 1b.4). The suite
   checks this before it types anything and tells you exactly this.
2. **The schema up to date** — `supabase db push` against staging, from
   `platform/`. The flows themselves predate the last four migrations, but a
   staging database that is behind is not staging.

If auto-confirmation cannot be turned on, make two accounts by hand and point
the suite at them instead:

```bash
CREMA_E2E_EMAIL=… CREMA_E2E_PASSWORD=… \
CREMA_E2E_EMAIL_2=… CREMA_E2E_PASSWORD_2=… npx playwright test
```

## The two rules

**It refuses to run against production.** The production project ref is named
in `support/env.js` as something to reject, and the check runs twice: once on
the endpoint Node resolved, and again on whatever the *page* resolved from its
own hostname, on every open. Verifying the new sign-up flow by hand once left a
real `test@test` account in production (Q14); this suite signs up, posts and
redeems on every release tag, and that mistake automated is not a mistake worth
having.

**A green UI proves nothing.** Crema paints optimistically — `submitPost()` puts
the pour on screen and calls `createPost()` afterwards, and a like flips the
heart before the row exists. So every flow ends by reading the row back over
PostgREST as `anon` (`support/db.js`), which is also a quiet check that the
public feed is still public.

## What it leaves behind

Two accounts and one pour on staging, per run, named for the run. Nothing here
can delete them: removing an auth user needs the service-role key, and account
deletion does not exist in the app yet (Phase 3.3). Premium is turned back off
and the like is taken back, so an account passed in by env stays reusable.
