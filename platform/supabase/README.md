# Supabase setup

Everything in this folder is run by hand, once, in the order below. The app **requires** it:
there is no bundled sample data, so the feed, the accounts and the café/bean/challenge
directory all come from these tables. That includes what a signed-out visitor sees — the
guest feed is the `anon` role reading the same rows through the same RLS policies.

> **Run every command on this page from `platform/`, not from the repo root.** The Supabase
> CLI locates a project by looking for a `supabase/` directory next to the working directory,
> and this one lives at `platform/supabase/`. So: `cd platform` first, and every `supabase …`
> command and every `supabase/…` path below then resolves as written.

## 1. Run the schema

Supabase dashboard → **SQL Editor** → paste and run:

1. [`schema.sql`](schema.sql) — tables, indexes, RLS policies, count views.
2. [`seed.sql`](seed.sql) — cafés, beans and challenges, generated from `src/data/`.
3. [`step-1.7.sql`](step-1.7.sql) — reports, blocks, comment rate limit.
4. [`step-1.8.sql`](step-1.8.sql) — challenge entries/votes, notification triggers.
5. [`step-1.9.sql`](step-1.9.sql) — points, levels, and the board of pours.
6. [`step-1.10.sql`](step-1.10.sql) — no self-likes; real cafés only.
7. [`step-1.11.sql`](step-1.11.sql) — `image_key` holds a key, `avatar_color` holds a colour.
8. [`step-1.12.sql`](step-1.12.sql) — editing your own pour, on the day you poured it.
9. [`step-1.13.sql`](step-1.13.sql) — optional profile photos (`profiles.avatar_key`).
10. [`step-1.14.sql`](step-1.14.sql) — points for coffee: pours, likes, comments, exact recipes, new beans.
11. [`step-1.15.sql`](step-1.15.sql) — public/followers-only pours, and follows you have to accept.
12. [`step-1.16.sql`](step-1.16.sql) — push subscriptions, notification switches, streak reminder and weekly digest.
    Run it **as part of [section 5](#5-deploy-the-push-function-step-116)** — the Edge Function must be
    deployed before it, and the Vault settings go in after it.
13. [`step-1.17.sql`](step-1.17.sql) — challenges that generate, score and pay out on their own.
    Nothing to configure: it schedules its own weekly job and fills the current week as it runs.
14. [`step-1.18.sql`](step-1.18.sql) — today's podium, its notifications and its points.
15. [`step-1.19.sql`](step-1.19.sql) — reactions, mutual follows, @mentions, reminders on by default.
16. [`step-1.20.sql`](step-1.20.sql) — the morning nudge: a second, earlier push reminder for
    anyone who hasn't poured yet today, streak or no streak. Needs the same push function and
    Vault settings as step-1.16 — nothing new to deploy, it reuses `push_send()`.
17. [`step-1.21.sql`](step-1.21.sql) — Premium becomes a code. **This one resets
    `profiles.premium` to false for everyone**, on purpose: see the note below before running it.

All of them are idempotent, so re-running them is safe. Run them in order —
each builds on the tables before it.

**Re-run `seed.sql` to pick up new cafés/beans/challenges added to `src/data/`** — it's an
upsert keyed on `name`/`id`, so existing rows are updated in place and nothing is duplicated.

**`step-1.12.sql` is what makes the Edit option honest.** It adds
`posts.edited_at` and a trigger that stamps it, refuses to let an update
touch the photo, the author or the timestamp, and refuses edits to posts
older than the window. Until it runs, the app still works — the client
already hides Edit on anyone else's post and on yesterday's, and the feed
degrades to not selecting `edited_at` — but the rules are then only the
client's, and the client is a browser console away from anyone.

**`step-1.13.sql` is what switches profile photos on.** Until it runs the
app is fine — every query that names `avatar_key` gives the column up on
the first error and retries without it (`optionalColumns()` in
`src/data/supabase.js`), so avatars stay as initials — but picking a photo
in Settings says it isn't switched on yet, because there is nowhere to
store the key.

**`step-1.21.sql` takes Premium away from everyone who had it.** That is
the point of the step rather than a side effect: Premium used to be a
boolean the settings sheet flipped and PATCHed, which anyone reading the
network tab had for free, and it now means enough to be worth locking.
After it runs:

- Every account starts again at `premium = false`, including yours.
- `premium` can no longer be raised by its owner. A `BEFORE UPDATE`
  trigger reverts a false→true from an ordinary PATCH — silently, not
  with an error, because the settings form sends every profile column and
  an exception would fail a name change over a field nobody touched.
  Turning Premium **off** stays theirs: nobody should need permission to
  give something up.
- The only way in is `redeem_premium(code)`, a `security definer`
  function that checks the code and is granted to `authenticated`. The
  code lives twice — here and in `PREMIUM_CODE` in
  `src/domain/premium.js` — and rotating it means changing both.
- Until this runs the app still works: `redeemPremium()` in
  `src/data/profiles.js` catches the missing function and falls back to a
  plain write, which succeeds because the guard is not there either.

**`step-1.19.sql` is required by the current app.** Until it runs, the
three reaction buttons on every post render but every tap fails with a
404 — `reactions` does not exist yet, and unlike a missing *column* a
missing *table* is not something `optionalColumns()` can shrug off. It
also carries three things that are invisible in the schema and worth
knowing before you run it:

- **Every existing follow becomes mutual.** `follows_backfill_mutual()`
  writes the reverse row for every accepted follow and promotes any
  request that was pending the other way. Triggers are off while it runs,
  so nobody is notified about a relationship they already had. From then
  on the trigger `follows_reciprocate` does the same for each new accept.
- **Everyone's reminder switches are turned on**, existing rows included,
  not just the column defaults. It sends nothing on its own: Web Push
  still needs the browser's permission, and the only prompt in Crema is
  still the one behind "Remind me".
- **Reactions deliberately pay nothing** — no points, no podium, no
  level. `local-test/step-1.19-test.sql` asserts that, along with the
  mutual-follow handshake, the mention parser and the two things a client
  must not be able to do (react to its own pour, grant itself an accepted
  follow).

**`step-1.18.sql` is required by the current app** — without it Explore's
podium section stays empty and logs a 404, because `podium_today` does not
exist yet. It replaces the all-time board with **today's podium**: the
three most-engaged pours of the current day (a like and a comment are
worth one point each for this ranking — its own rule, not a reuse of the
2-and-3 weight below), and it drops the now-unused `top_posts` view.

A day finished on the podium now pays real points too, via a new
`podium_wins` ledger and `podium_award_day()`/`podium_award_recent()`:
15 for 1st, 10 for 2nd, 5 for 3rd, added to `user_points()` the same way a
finished challenge is. A day is only ever settled once — `podium_award_day()`
refuses to touch a day that already has any winners recorded, specifically
so a late like on an old, previously-unplaced pour can't hand out a fourth
paid winner for a day that was already final. `podium_award_recent()`
re-checks the last 7 days on the same hourly cron as `podium_check()`
(not on every like — settling a day is a batch job, not a per-like
reaction), so an outage of up to a week still catches up once it's back.

Four things to know before running it:

1. **It notifies people on the first run.** The seed calls at the bottom
   are `select podium_check();` then `select podium_award_recent();`,
   and because step-1.16 put push on the `notifications` table itself,
   the podium-placement notification goes to phones. That is the intended
   introduction to the feature, but it does mean up to three people get a
   push the moment you run it. Comment out `podium_check()`'s call if
   you'd rather it start quiet — `podium_award_recent()` only pays past,
   already-decided days and sends no notification of its own.
2. **The day boundary is `Europe/Berlin`, not per-user and not UTC.** The
   podium is one global board showing the same three pours to everybody,
   so "today" has to mean one thing for everybody. Per-user local days
   (`user_tz()`, step-1.17) are still right for streaks and challenges,
   which are private to one person.
3. **The podium's ranking weight (1 point per like or comment) and the
   ordinary profile score's weight (2 per like, 3 per comment, in
   `user_points()`) are deliberately different numbers for two different
   questions** — "who won today" versus "how much is a single like worth
   on your permanent score." Keep them that way rather than "simplifying"
   them to match; they were never meant to agree.
4. **Podium points are additive and start at zero for everyone** — no
   backfill needed. `podium_wins` is empty until a day is actually
   settled, so nobody's score moves on the migration itself.

It was tested against a local Postgres 17 before it ran anywhere — see
"Testing a migration locally" below — which is how the `revoke` on
`podium_top()` was caught (`podium_today` is `security_invoker`, so the
caller's rights are checked when the view calls the function, and revoking
EXECUTE made the board unreadable for every signed-in client), and how a
second, subtler bug in the first draft of `podium_award_day()` was caught:
keying "already paid" off `(day, post_id)` looked like it made a day
final, but a late like promoting a fourth pour into the top three would
have slipped past that check and paid a fourth winner. The fix checks
whether the *day* has any winners at all before computing anything.

**`step-1.14.sql` restates every score**, so run it when you're happy for
scores to move — they will, both ways. Challenge entries and votes stop
paying (step-1.17 later retires entries and votes altogether), and
exact recipes and new beans start paying. It rewrites `user_points()` and
repoints the triggers; the level curve is untouched. Until it runs, the
Levels screen shows the new rules while the database still scores by the
old ones — which is the one combination worth not leaving for long.

**`step-1.9.sql` is required by the current app.** It adds `profiles.points`,
makes `profiles.level` a function of that score (triggers recompute both from
the rows, so they cannot drift), and creates the `top_posts` view the board
reads. It also retires the old weekly user leaderboard: it unschedules the
`crema-leaderboard` cron job and drops `leaderboard_weekly` and
`refresh_leaderboard_weekly()`, which ranked people using a `quality * 20`
term the client always sent as the same constant.

Until it runs, the app still works — the board is empty and everyone shows
0 points at Level 1 — but nothing progresses.

> Because **automatic RLS** is enabled on this project, every new table starts with RLS on and
> denies everything until a policy exists. `schema.sql` creates each table's policies right
> after the table, so this only matters if you add tables by hand later.

After running, `src/data/remote.js` serves cafés and beans from Postgres (the app
bundles no copy of its own; challenges come from the `my_challenges()` RPC instead, since
they carry your own progress) —
edit a café row in the dashboard and it changes in the app within 15 minutes (the cache TTL
in `src/config.js`), or immediately on a hard reload.

## 2. Enable auth providers

Dashboard → **Authentication → Providers**:

- **Email** — on by default. Turn *Confirm email* off while testing, or you'll need to click
  a link for every throwaway account.
- **Google** and **Apple** — the app already has the buttons and does the PKCE dance.

**Two different redirect settings have to agree, and only one of them is in Supabase:**

1. **Google Cloud console** → your OAuth client → *Authorized redirect URIs* must contain
   Supabase's callback, shown on the provider page:
   `https://diabtvahplwoipvrprvb.supabase.co/auth/v1/callback`.
   Get this wrong and Google refuses before any login, with `redirect_uri_mismatch`.

2. **Supabase → Authentication → URL Configuration → Redirect URLs** must contain the URL the
   *app* is served from, because that is what the app sends as `redirect_to`:

   ```
   https://mgtajo.github.io/crema/**
   http://localhost:4599/**
   ```

   and **Site URL** should be `https://mgtajo.github.io/crema/`. This is the one that fails
   quietly: if the app's URL is not listed, Google and Supabase both succeed, then Supabase
   redirects to the Site URL instead of back to the app — so the user lands on a page with no
   `?code=` and nothing happens. Since the app cannot see this config, it now says so: coming
   back from a provider with a pending sign-in and no code shows an error on the sign-in screen
   naming this setting.

> If you ship Google sign-in, Apple requires Sign in with Apple too. Both or neither.

## 3. Test the RLS policies

The step that's easy to skip and expensive to get wrong. The app runs as one user, so it will
look fine even if the policies are broken.

Create two throwaway accounts, then:

```bash
CREMA_EMAIL_A=a@example.com CREMA_PW_A=… CREMA_EMAIL_B=b@example.com CREMA_PW_B=… node supabase/rls-test.mjs
```

It asserts, as two different signed-in users, that: posts are publicly readable but only
editable by their author, profiles can't be edited or spoofed across users, saves and
notifications don't leak, notifications can't be forged, and reference tables reject client
writes. Exits non-zero on any failure.

## 4. Deploy the media functions (step 1.6)

Two Edge Functions mint presigned R2 URLs so the browser can upload/delete without ever
holding an R2 credential. Deploy both:

```bash
supabase login
supabase link --project-ref diabtvahplwoipvrprvb
supabase functions deploy upload-url
supabase functions deploy delete-image
```

Then set the R2 secret — **run this yourself**, with your own Access Key ID and Secret from
the R2 API token (Account API token, Object Read & Write, scoped to `coffee`):

```bash
supabase secrets set \
  R2_ACCOUNT_ID=175e2adca35811269da6096ec2763304 \
  R2_ACCESS_KEY_ID=<your access key id> \
  R2_SECRET_ACCESS_KEY=<your secret access key> \
  R2_BUCKET=coffee
```

`SUPABASE_URL` and `SUPABASE_ANON_KEY` are injected automatically — don't set those.

**Never paste the Access Key ID or Secret into chat.** They bypass RLS entirely; unlike the
publishable key, there is nothing protecting data if this one leaks.

### Verify the deploy

```bash
supabase functions logs upload-url
```

Then in the app, sign in and post a coffee with a photo. If the upload fails, the post still
goes out with the local photo (unchanged from before 1.6) and a toast says so — check the
function logs for the actual error.

### R2 bucket CORS

Needed so the browser's direct `PUT` to R2 doesn't die at preflight. **R2 → `coffee` →
Settings → CORS Policy:**

```json
[{"AllowedOrigins":["https://crema-app.com","https://www.crema-app.com","https://mgtajo.github.io","http://localhost:4599"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]
```

Every origin is **scheme + host only** — a browser never sends a path in `Origin`, so
`https://mgtajo.github.io/crema` matches nothing. Any new domain the app is served from needs
its own entry here, or photos silently fall back to inline: the presign call still succeeds
(the Edge Function answers `*`), and only the direct PUT is blocked.

### What's still open in 1.6

- **Account deletion doesn't purge R2 yet.** There's no delete-account flow in the app at
  all currently — that's a bigger addition (needs a third Edge Function running with the
  service-role key to actually remove the auth user). `data/media.js` has `deleteImage()`
  ready to call once that flow exists; post deletion already calls it.
- The `403` Cloudflare Images returns for a transform request on a **nonexistent** key hasn't
  been checked against a **real** uploaded object yet — do that after the first live upload.

## 5. Deploy the push function (step 1.16)

Reminders and the weekly digest go out as Web Push. Postgres builds the batch and hands it
to one Edge Function, which does the RFC 8291 encryption and the RFC 8292 VAPID signing.

`step-1.16.sql` is run in the middle of this section: deploy the function first, then the SQL,
then the Vault settings. The cron jobs the SQL schedules no-op with a notice until those
settings exist, so nothing breaks in between.

### Generate the VAPID keypair

The keypair identifies Crema to every browser push service. The **public** half is already in
[`src/config.js`](../../src/config.js) and is meant to ship in client code; the **private** half
must never enter the repo:

```bash
node -e "(async()=>{const k=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign']);const r=new Uint8Array(await crypto.subtle.exportKey('raw',k.publicKey));const j=await crypto.subtle.exportKey('jwk',k.privateKey);const b=b=>Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');console.log('public :',b(r));console.log('private:',j.d)})()"
```

Only generate a new pair if you are replacing the one in `src/config.js`. **Rotating the
public key invalidates every existing subscription** — a subscription is bound to the key
that created it, so everyone silently stops receiving notifications until their next visit
re-subscribes them. If you do rotate, `truncate push_subscriptions` at the same time.

### Deploy and set the secrets

`--no-verify-jwt` is required: the caller is Postgres, which has no user JWT. `PUSH_HOOK_SECRET`
is therefore the only thing standing between this function and the open internet — make it long
and random (`openssl rand -hex 32`).

```bash
supabase functions deploy send-push --no-verify-jwt
supabase secrets set \
  VAPID_PUBLIC_KEY=<the public key from src/config.js> \
  VAPID_PRIVATE_KEY=<the private key — never paste this into chat> \
  VAPID_SUBJECT=mailto:hello@crema-app.com \
  PUSH_HOOK_SECRET=<a long random string>
```

### Then run `step-1.16.sql`, and tell Postgres where the function is

Run [`step-1.16.sql`](step-1.16.sql) first — it defines the helper used below. The cron jobs it
schedules no-op with a notice until the two settings exist, so this order is safe.

Then, in the SQL editor as the `postgres` role:

```sql
select push_set_config('push_endpoint', 'https://diabtvahplwoipvrprvb.supabase.co/functions/v1/send-push');
select push_set_config('push_secret',   '<the same PUSH_HOOK_SECRET>');
```

These go into **Supabase Vault**, which encrypts them at rest. Not `alter database postgres set
app.…` — the hosted `postgres` role is not a superuser, and that statement fails with
`42501: permission denied to set parameter`. `push_config()` still falls back to
`current_setting()` so the same file works on a local or self-hosted Postgres.

Check they took:

```sql
select name, left(decrypted_secret, 24) || '…' from vault.decrypted_secrets
 where name in ('push_endpoint','push_secret');
```

### Verify

The crypto is covered offline against the published RFC 8291 test vector — that catches the
mistakes a self-consistent implementation gets away with:

```bash
node --experimental-strip-types supabase/functions/send-push/webpush.test.mjs
```

The streak rule exists twice (plpgsql here, `src/domain/streak.js` in the app) and a
disagreement would mean a notification the app then contradicts, so they are fuzzed against
each other:

```bash
node supabase/streak-parity-test.mjs
```

End to end: sign in, Settings → Reminders → **Remind me**, accept the browser prompt, then
force one from the SQL editor:

```sql
select push_send(jsonb_build_object('rows', (
  select jsonb_agg(jsonb_build_object(
    'endpoint', endpoint, 'p256dh', p256dh, 'auth', auth,
    'title', 'Crema', 'body', 'Test push', 'url', './', 'tag', 'test'))
  from push_subscriptions where user_id = auth.uid())));
```

`supabase functions logs send-push` reports `{sent, gone, failed}` per batch. Subscriptions the
push service answers 404/410 for are deleted automatically — that is normal churn, not an error.

### Where push does and doesn't arrive

| | |
| --- | --- |
| Chrome, Edge, Firefox — desktop & Android | Works in an ordinary tab. No install. |
| Safari 16.4+ on macOS | Works in an ordinary tab. |
| **Safari on iOS / iPadOS** | **Only after Add to Home Screen.** Apple ships no Web Push in a Safari tab, and there is no flag or workaround. |
| Anything older, or notifications denied | Nothing. |

This is why every nudge push carries is also visible inside the app (the streak block on Home,
the notification inbox): a large share of the audience is on an iPhone in a Safari tab and will
never receive one. `iosNeedsInstall()` in [`src/data/push.js`](../../src/data/push.js) detects that
case and the reminders sheet asks for the Home Screen instead of showing a toggle that cannot work.

## A trap worth knowing about

PostgREST resolves embedded relationships by name, and `posts`, `comments` and
`challenge_entries` can all reach `profiles` by more than one path — directly via their
`user_id`, and again many-to-many through the join tables. A bare `profiles(...)` embed
returns **300 Multiple Choices**, not rows.

Every embed in `src/data/` therefore names its foreign key explicitly, e.g.
`profiles!posts_user_id_fkey(...)`. If you add a query and get a 300, this is why.

## Testing a migration locally

Everything in this directory is applied to production by hand, so without
this a migration's first execution anywhere is the real one. It doesn't
have to be:

```bash
./supabase/local-test/run.sh podium-test.sql
```

That builds a throwaway Postgres 17 cluster (Homebrew, no Docker), loads
`local-test/stub.sql` for the Supabase-only pieces — `auth.users` +
`auth.uid()`, the `anon`/`authenticated`/`service_role` roles, and
table-backed fakes for `cron.schedule`, `net.http_post` and `vault` — then
runs `schema.sql` and every `step-*.sql` in order, then the test files you
name.

Things it is deliberately picky about, each of which cost an afternoon
once:

- **The session timezone is `Europe/Berlin`, not UTC.** Supabase runs UTC,
  which hides every bug where a `timestamptz` is cast in the session's zone
  rather than the one the query meant. This is what exposed the
  double-applied offset in step-1.17.
- **Supabase's default grants are applied before the tests run.** Without
  `grant all on all tables ... to authenticated`, a `security_invoker` view
  fails on table permissions and RLS never gets to be the thing that
  denies — so a policy bug reads as a pass.
- `pg_cron` and `pg_net` cannot be installed here, so the `create extension`
  lines are commented out on the way in and the stub stands in. A guard
  like `if exists (select 1 from pg_extension where extname = 'pg_cron')`
  will therefore take its "not installed" branch locally; that is the stub,
  not your migration.

`local-test/podium-test.sql` is worth reading as a model: ten assertions
covering places and ordinals, idempotency, overtaking, falling off and
climbing back, deletes, a pour turning private, and the two things that
must stay unreachable from a client.

`local-test/reaction-push-test.sql` covers the other kind of question —
not "is the row right" but "does it reach a phone". It follows a reaction
from the `reactions` insert through `notify_on_reaction()` (step-1.19) to
the payload handed to `net.http_post` (step-1.16): the wording per kind,
the actor's name in front of it, the `#p/<id>` deep link, the tag that
collapses three reactions from one person into one banner, the reminder
switch that suppresses the phone but not the inbox, and the fact that
reacting to your own pour is refused twice over and notifies nobody.
Because `net.http_post` is a table-backed fake, that last hop is the
honest place to stop: it proves Postgres built and addressed the right
push, and claims nothing about Apple's push service.

## Local development

```bash
python3 devserver.py
```

Use this rather than `python3 -m http.server`: the latter sends no `Cache-Control`, so the
browser serves stale ES modules and you end up debugging the previous version of a file.

**`step-1.15.sql` was the one that had to run before people could trust
it, and it has (2026-07-28).** It adds `posts.visibility` and
`follows.status`, and — the part that matters — rewrites the select policy
on `posts` so a followers-only pour is unreadable by a stranger *in the
database*. Until it ran, the app was fully working but everything was
public: the composer's Everyone/Followers switch had nowhere to store its
answer, and follows were immediate rather than requested. Both columns are
given up on the first error and retried without, which is why nothing
broke in the meantime — and also why the symptom was silent. If you ever
see a follow accept itself again, that fallback is the first thing to
check: the console says `column status is missing`.

Existing rows are grandfathered on purpose: every pour becomes `public`
(they were posted under rules where everything was), and every existing
follow becomes `accepted` (nobody wakes up to a queue of people they
thought already followed them). Only new follows start as `pending`.
