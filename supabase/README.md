# Supabase setup

Everything in this folder is run by hand, once, in the order below. The app works without
any of it — signed out it stays in demo mode — so nothing here is urgent, and nothing here
can break the running app.

## 1. Run the schema

Supabase dashboard → **SQL Editor** → paste and run:

1. [`schema.sql`](schema.sql) — tables, indexes, RLS policies, count views.
2. [`seed.sql`](seed.sql) — cafés, beans and challenges, generated from `src/data/`.
3. [`step-1.7.sql`](step-1.7.sql) — reports, blocks, comment rate limit.
4. [`step-1.8.sql`](step-1.8.sql) — challenge entries/votes, leaderboard job, notification triggers.

All four are idempotent, so re-running them is safe. Run them in order —
each builds on the tables before it.

`step-1.8.sql` ends with a commented-out `pg_cron` block. Enable pg_cron under
**Database → Extensions** first, then run those two lines to schedule the
leaderboard refresh. Without it everything still works; the board just only
updates when `refresh_leaderboard_weekly()` is called.

> Because **automatic RLS** is enabled on this project, every new table starts with RLS on and
> denies everything until a policy exists. `schema.sql` creates each table's policies right
> after the table, so this only matters if you add tables by hand later.

After running, `src/data/remote.js` starts serving cafés/beans/challenges from Postgres —
edit a café row in the dashboard and it changes in the app within 15 minutes (the cache TTL
in `src/config.js`), or immediately on a hard reload.

## 2. Enable auth providers

Dashboard → **Authentication → Providers**:

- **Email** — on by default. Turn *Confirm email* off while testing, or you'll need to click
  a link for every throwaway account.
- **Google** and **Apple** — the app already has the buttons and does the PKCE dance. Set the
  redirect URL to wherever the app is served (`http://localhost:4599` for local dev, plus the
  GitHub Pages URL).

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

## What is NOT set up yet

- **Media** still travels as base64 data URLs. R2 upload + CDN delivery is roadmap step 1.6 —
  the only remaining Phase 1 step, and the only one needing infrastructure beyond Supabase.

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
