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
[{"AllowedOrigins":["http://localhost:4599","https://<your-github-pages-url>"],"AllowedMethods":["PUT","GET"],"AllowedHeaders":["content-type"],"MaxAgeSeconds":3600}]
```

### What's still open in 1.6

- **Account deletion doesn't purge R2 yet.** There's no delete-account flow in the app at
  all currently — that's a bigger addition (needs a third Edge Function running with the
  service-role key to actually remove the auth user). `data/media.js` has `deleteImage()`
  ready to call once that flow exists; post deletion already calls it.
- The `403` Cloudflare Images returns for a transform request on a **nonexistent** key hasn't
  been checked against a **real** uploaded object yet — do that after the first live upload.

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
