# Supabase setup

Everything in this folder is run by hand, once, in the order below. The app **requires** it:
there is no demo mode, so an account, a feed and the café/bean/challenge directory all come
from these tables.

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
    **Needs [section 5](#5-deploy-the-push-function-step-116) done first**, or the cron jobs fire into nothing.

All of them are idempotent, so re-running them is safe. Run them in order —
each builds on the tables before it.

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

**`step-1.14.sql` restates every score**, so run it when you're happy for
scores to move — they will, both ways. Challenge entries and votes stop
paying (challenges are behind "Coming soon" and being reworked), and
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

After running, `src/data/remote.js` serves cafés/beans/challenges from Postgres (the app
bundles no copy of its own) —
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

**Do this before running `step-1.16.sql`** — that file schedules the cron jobs, and a job
whose endpoint is missing fails quietly.

### Generate the VAPID keypair

The keypair identifies Crema to every browser push service. The **public** half is already in
[`src/config.js`](../src/config.js) and is meant to ship in client code; the **private** half
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

Then tell Postgres where to find it, as the `postgres` role in the SQL editor. These two
settings are read by `push_send()` and cannot be inferred from the environment:

```sql
alter database postgres set app.push_endpoint =
  'https://diabtvahplwoipvrprvb.supabase.co/functions/v1/send-push';
alter database postgres set app.push_secret = '<the same PUSH_HOOK_SECRET>';
```

New connections pick these up, so reconnect (or wait) before testing.

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
never receive one. `iosNeedsInstall()` in [`src/data/push.js`](../src/data/push.js) detects that
case and the reminders sheet asks for the Home Screen instead of showing a toggle that cannot work.

## A trap worth knowing about

PostgREST resolves embedded relationships by name, and `posts`, `comments` and
`challenge_entries` can all reach `profiles` by more than one path — directly via their
`user_id`, and again many-to-many through the join tables. A bare `profiles(...)` embed
returns **300 Multiple Choices**, not rows.

Every embed in `src/data/` therefore names its foreign key explicitly, e.g.
`profiles!posts_user_id_fkey(...)`. If you add a query and get a 300, this is why.

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
