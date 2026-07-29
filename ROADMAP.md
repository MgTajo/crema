# Roadmap — from prototype to iOS & Android

How Crema goes from a static demo to two live store apps, in steps that **never leave you
without a working product**.

- **Phase 1 — Backend.** Supabase (Postgres + Auth) · Cloudflare R2 (media) · Cloudflare
  Image Transformations (delivery). The web app stays live the whole time.
- **Phase 2 — Native.** Expo / React Native, reusing `core/`, `data/`, `domain/`, `store/`
  and rebuilding only `ui/`.

Related: [ARCHITECTURE.md](ARCHITECTURE.md) explains the layer boundaries this plan exploits.

---

## Guiding principles

**1. ~~Demo mode never goes away.~~ Retired 2026-07-25 — Crema now requires an account.**
This was the guiding rule through Phase 1, and it did its job: every step could ship because
the signed-out app always worked. Once the backend carried everything, it started costing more
than it earned — two code paths, invented counts, a seeded world that no longer matched what a
real account saw. So the seeded world is gone: `src/data/world.js` ships empty arrays,
`ui/gate.js` is the app until someone signs in, and every number on screen is counted in
Postgres. Sessions persist in `localStorage` and are only dropped when the auth server rejects
the refresh token, so "sign in again" is rare rather than daily.

The principle that replaced it: **nothing on screen is invented.** An empty table renders an
empty state that says so.

**2. Migrate one domain at a time, behind the store.**
Reference data (catalog, cafés) → posts → media → social graph → challenges → notifications.
Each domain flips independently. Nothing else in the app knows.

**3. Every step ends at a checkpoint.**
Each step below has a **✅ Working product** line describing what you can demo when it's done.
If a step can't end in something demo-able, it's too big — split it.

**4. Reference data keeps a bundled fallback.**
`data/catalog.js` and the café list stay in the repo as the offline/fallback dataset even after
the DB is authoritative. Cheap insurance, and it keeps the PWA working offline.

---

## Stack decisions

| Concern | Choice | Why |
| --- | --- | --- |
| Database + Auth | **Supabase** (EU / Frankfurt region) | Postgres, RLS, Apple/Google sign-in, EU data residency for GDPR |
| Media storage | **Cloudflare R2** | Zero egress fees, S3-compatible (migration optionality) |
| Media delivery | **Cloudflare Image Transformations** in front of R2 | One vendor with storage; on-the-fly resize/WebP/AVIF via URL |
| Push | **Expo Notifications** (wraps FCM + APNs) | Least setup on Expo; still FCM/APNs underneath |
| Payments | **RevenueCat** over StoreKit / Play Billing | Digital goods must use store billing; RevenueCat handles receipts |
| Native runtime | **Expo / React Native** | Reuses the four non-UI layers as-is |

> Verify current pricing and plan requirements before committing — Cloudflare Image
> Transformations in particular has plan/zone prerequisites that change.

---

# Phase 0 — Accounts & foundations

**No code changes. The app keeps running exactly as today.**

1. ✅ **DONE** — Supabase project, EU region (`diabtvahplwoipvrprvb.supabase.co`).
2. ✅ **DONE** — Cloudflare R2 bucket (named `coffee`, not `crema-media` as originally planned),
   EU jurisdiction.
3. ✅ **DONE** — Custom domain `media.crema-app.com` bound to the bucket, Image Transformations
   enabled on the `crema-app.com` zone.
4. ⬜ Apple Developer Program / Google Play Console — not started. Blocks Phase 2 testing.
5. ⬜ Bundle identifier — not decided. Only needed once Phase 2 starts.

✅ **Working product:** unchanged web app, plus infrastructure ready to point at.
*Status: infra done except the store enrolments, which only matter for Phase 2.*

---

# Phase 1 — Backend

**Status: complete. All of 1.1–1.8 are built, deployed, and verified against the live
Supabase project — not just committed. See [`supabase/README.md`](supabase/README.md) for
the operational setup notes and known gaps (Cloudflare cache purge on delete, no
account-deletion flow yet).**

## Step 1.1 — Make the store async (no backend yet) ✅ DONE

Pure plumbing that de-risks everything after it. Still 100% `localStorage`.

In [`src/store/store.js`](src/store/store.js):

```js
export async function load(){
  try{
    const s = await persistence.read();
    state = s && s.posts ? s : freshState();
    …
  }catch(e){ state = freshState(); }
}
export function save(){                    // fire-and-forget, optimistic
  persistence.write(state).catch(err => console.warn('save failed', err));
}
```

In [`src/app.js`](src/app.js), `await load()` before the first `render()` (top-level `await`
works in ES modules). `LocalStoragePersistence` methods become `async` — they just return
resolved values.

✅ **Working product:** the app, behaving identically. Nothing user-visible changed.
*Done. `store.js`/`persistence.js` async throughout; `makePersistence(session)` is the actual
sign-in/out seam, ahead of what this step originally sketched.*

---

## Step 1.2 — Schema + RLS (database only) ✅ DONE

Write the schema in the Supabase SQL editor. **The app doesn't touch it yet.**

### Core tables

```sql
-- profiles: one row per auth user
create table profiles (
  id            uuid primary key references auth.users on delete cascade,
  handle        text unique not null,
  name          text not null,
  city          text,
  bio           text,
  avatar_color  text default '#8a5a30',
  level         int  default 1,
  machine_brand text, machine_model text,
  fav_drink     text, fav_milk text,
  premium       bool default false,
  created_at    timestamptz default now()
);

create table posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  drink      text not null,
  art        bool default false,
  pattern    text,
  quality    numeric,
  image_key  text,                    -- R2 object key, null = generated SVG cup
  caption    text,
  cafe_id    text references cafes,
  recipe     jsonb,                   -- sparse, mirrors today's shape
  created_at timestamptz default now()
);

create table follows (
  follower_id uuid references profiles on delete cascade,
  followee_id uuid references profiles on delete cascade,
  primary key (follower_id, followee_id)
);

-- likes, saves, cafe_follows follow the same (user_id, target_id) shape
create table comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references posts on delete cascade,
  user_id    uuid not null references profiles on delete cascade,
  body       text not null,
  created_at timestamptz default now()
);
```

**Keep `recipe` as `jsonb`.** It's genuinely sparse (the app deliberately stores only fields the
author filled in — see `recipeRows()` in [`src/ui/components.js`](src/ui/components.js)), and
flattening it into 8 nullable columns buys nothing.

### RLS — the part that actually matters

Enable RLS on **every** table, then:

```sql
alter table posts enable row level security;

-- public read (the feed is public)
create policy "posts are readable by everyone"
  on posts for select using (true);

-- write only your own
create policy "users insert their own posts"
  on posts for insert with check (auth.uid() = user_id);
create policy "users update their own posts"
  on posts for update using (auth.uid() = user_id);
create policy "users delete their own posts"
  on posts for delete using (auth.uid() = user_id);
```

The one people get wrong — **notifications must be owner-read-only**:

```sql
create policy "notifications are private"
  on notifications for select using (auth.uid() = user_id);
```

Test policies by querying with the anon key from a REST client, signed in as two different users.
Don't trust that they work because the app looks fine — the app runs as one user.

### Counts

Start with views (`select count(*)`) for likes/comments/followers. Denormalize into counter
columns with triggers only when it measurably hurts. Premature counters cause drift bugs.

✅ **Working product:** unchanged app, plus a database you can seed and query by hand.
*Done. Live in [`supabase/schema.sql`](supabase/schema.sql). Counts are aggregate embeds
(`likes(count)`, `comments(count)`), not the views this step sketched — PostgREST couldn't
embed the view via a foreign key, so aggregates ended up simpler and equally free of drift.
RLS re-verified with two real signed-in users via [`supabase/rls-test.mjs`](supabase/rls-test.mjs)
— 17/17 passing, not just eyeballed.*

---

## Step 1.3 — Auth, additive ✅ DONE

Add sign-in without taking anything away.

1. ✅ Email enabled. ⬜ Apple / Google providers — not enabled yet (buttons exist in the UI
   and do the PKCE dance, but there's nothing configured on the Supabase side to receive it).
2. ✅ Settings has *Sign in / Create account* / *Signed in as … / Sign out*.
3. ✅ `ensureProfile()` creates the `profiles` row from local `state.me` on first sign-in.
4. ✅ `makePersistence(session)` wired; `useSession()` reloads on auth change.

✅ **Working product (as of step 1.5):** app worked signed out **and** signed in (same
experience, now with a real account). Two modes, both functional.
*Done, beyond the "stub that throws" this step allowed for — `RemotePersistence` never
existed; posts went straight to granular per-domain modules (`data/posts.js`, `data/social.js`
etc.) in the shape step 1.5 describes. Apple/Google sign-in is the one open item — low
priority until Phase 2 needs App Store sign-in requirements.*

---

## Step 1.4 — Reference data from the DB ✅ DONE

Lowest-risk real migration: read-only data with no writes and no auth complexity.

1. ✅ `cafes`, `beans`, `challenges` seeded from `src/data/seed.js` / `catalog.js` into
   [`supabase/seed.sql`](supabase/seed.sql) (generated, not hand-transcribed).
2. ✅ `data/remote.js` fetches them; bundled arrays stay the fallback on any error.
3. ✅ Cached in `localStorage` with a 15-minute TTL (`REFERENCE_TTL_MS` in `config.js`).

⚠️ Café **lat/lng** are in, but they're **approximate** — derived from each café's street/area
name, not real geocoded addresses. Fine for the current decorative-ish map pins (now projected
from real coordinates instead of hand-placed `x`/`y`); **verify against actual addresses before
Phase 2's native map uses them for real navigation.**

✅ **Working product:** app looks identical, but editing a café row in Supabase changes what
users see. First proof the backend is live.
*Done and confirmed live — editing a café's rating in the dashboard was used as the literal
proof-of-life test.*

---

## Step 1.5 — Posts (the first genuinely social step) ✅ DONE

The big one. Signed-in users' posts live server-side and are visible to everyone.

1. ✅ `data/posts.js` — granular calls, not one blob:

   | Store today | Becomes |
   | --- | --- |
   | `feedPosts()` | `fetchFeed()` → `GET /posts?…` (paginated, newest first) |
   | `myPosts()` | `fetchMine()` → `GET /posts?user_id=eq…` |
   | `submitPost()` in `ui/actions.js` | `createPost()` → `POST /posts` |
   | `findPost(id)` | `fetchPost(id)` |

2. ✅ Optimistic: mutate → repaint → network call → revert on failure, throughout.
3. ✅ Keyset pagination on `created_at`, infinite scroll wired to `#view`'s scroll event.
4. ~~Signed-out keeps the bundled seed feed.~~ Superseded 2026-07-25: there is no signed-out feed.

✅ **Working product:** two accounts on two devices see each other's posts. It's a social
network now.
*Done, and confirmed live with real accounts across the whole session — not just posts, but
likes/comments appearing across accounts too (1.7).*

**One trap worth keeping in the roadmap:** PostgREST can't disambiguate a `profiles` embed
when a table reaches it two ways (direct FK + through a join table like `likes`). A bare
`profiles(...)` embed returns `300 Multiple Choices`, not rows — every embed in `data/`
names its foreign key explicitly (`profiles!posts_user_id_fkey(...)`) to avoid this. Hit
this on `posts`, `comments`, and `challenge_entries`; will hit it again on any future table
reachable from `profiles` two ways.

---

## Step 1.6 — Media to R2

Until now posts carried base64 data URLs (works, but heavy). Now they carry R2 keys.

### Upload path ✅ DONE

1. ✅ Client-side resize kept — `handleUpload()` still downscales to 1080px on canvas before
   anything else happens.
2. ✅ Two Edge Functions, not one: `upload-url` (verifies the JWT, generates
   `posts/{user_id}/{uuid}.jpg`, returns a presigned PUT) and `delete-image` (same JWT check,
   verifies the key belongs to the caller before issuing the R2 delete). Both in
   [`supabase/functions/`](supabase/functions/).
3. ✅ Client PUTs straight to R2 with the presigned URL — bytes never transit Supabase.
4. ✅ The returned key is what gets stored on the post (`image_key`).

### Delivery ✅ DONE

```
https://media.crema-app.com/cdn-cgi/image/width=800,format=auto/posts/<key>
```

(`media.crema-app.com`, not the `media.crema.app` placeholder above — real domain, registered
during this build.) `data/media.js` exports exactly the `imageUrl(key, 'feed'|'thumb'|'hero')`
helper this step asked for; every render site (feed cards, 3-up grid, post hero, profile
activity, create-sheet preview) goes through it. Café images were left untouched — still
bundled assets, not part of this migration; `imageUrl()` passes them through unchanged since
they don't match the R2-key shape.

### Migration + cleanup

- ✅ Existing base64 images left as-is, per the plan.
- ⬜ **Account deletion still does not purge R2** — because there is **no account-deletion
  feature in the app at all yet**, not even a DB-only one. `deleteImage()` exists and post
  deletion already calls it, so the R2 side is ready the moment a delete-account flow exists.
  This is the one real gap left against this step's own instruction to "write this now" —
  flagging it rather than treating it as done.
- ⬜ **New gap this step surfaced, not in the original plan:** deleting an R2 object doesn't
  purge Cloudflare's edge cache. A deleted photo can stay reachable at its old URL for up to
  the cache's `max-age` (currently 4h). Matters more once account deletion is real — GDPR
  wants "gone," and a cached copy technically isn't.

✅ **Working product:** photos load fast from CDN, in the right size per surface.
*Done and proven against the live project end-to-end — sign-in, presign, PUT, direct GET, and
a real CDN resize all returned 200, verified with disposable test accounts rather than trusted
on faith. Three real deploy bugs were found and fixed in the process, all specific to this
project's setup rather than the code: (1) a stale R2 secret — only the access key ID had been
rotated into Supabase, not its matching secret, caught by comparing `supabase secrets list`
timestamps; (2) the bucket's **EU jurisdiction** requires its own S3 endpoint
(`<account>.eu.r2.cloudflarestorage.com`, not the default host) — new `R2_JURISDICTION`
secret added to both functions to handle it; (3) Cloudflare Image Transformations' allowed-origins
list didn't include the `media.` subdomain by default, rejecting every transform with error
9401 until added explicitly in the dashboard.*

---

## Step 1.7 — Social graph ✅ DONE

`follows`, `likes`, `saves`, `comments`, `comment_likes`, `cafe_follows` as real tables.

These are the highest-traffic writes in the app, and all of them are already optimistic in
`ui/actions.js` (`toggleLike`, `toggleFollow`, `toggleSave`, `addComment` all mutate → repaint →
`save()`). Keep that: mutate local, repaint, POST, revert on failure.

Add here:
- ✅ **Rate limiting** on comments — enforced in Postgres (a trigger, 10/minute), not just the
  client, since a client-side limit is decoration.
- ✅ **Report handling** — writes a real `reports` row with a reason picker, not a toast.
- ✅ **Block/mute** — blocking filters the Following-tab feed server-side and is invisible to
  the blocked user; deleting your own post is in the same menu.

✅ **Working product:** the full social loop — follow, like, comment, save — across accounts.
*Done. `data/social.js` + [`supabase/step-1.7.sql`](supabase/step-1.7.sql). The two transitional
hacks that existed before this step landed (`state.localLikes`/`localSaves`, bridging local
interactions onto remote posts) are gone — likes/saves/follows are real rows now, and the
Following tab is a server-side filtered query, not a client-side filter over one page.*

---

## Step 1.8 — Challenges, leaderboard, notifications ✅ DONE

1. ✅ **Challenges**: `challenge_joins` + `challenge_entries` + `entry_votes` are real rows.
   The old `seedOf(id)*7 % 480` fake vote hash is gone; entries are tappable to vote, with
   RLS enforcing you can only enter a post you actually own.
2. ~~**Leaderboard**: `leaderboard_weekly`, refreshed nightly by `pg_cron`.~~
   **Superseded by step 1.9** — it ranked *people* on a score that included `quality * 20`,
   and the client sent the same hardcoded quality for every pour. The table, its function
   and the cron job are dropped; the board now ranks pours by likes, live.
3. ✅ **Notifications**: rows generated by `security definer` triggers on `likes`/`comments`/`follows`,
   with **no insert policy** — a client cannot forge one even if it tried. The existing inbox
   UI reads straight off the table now.

Push *delivery* is Phase 2 (needs a native app). The data model lands here so the inbox is real.

✅ **Working product:** a feature-complete web app on a real backend. This is a legitimate
public beta — you could launch it as a PWA and get users before any native work.
*Fully done, including the leaderboard schedule.*

---

## Step 1.9 — Accounts only, and progression that means something ✅ DONE

Three changes that all came from the same question: *is this number real?*

1. ✅ **The demo is gone.** `ui/gate.js` is a sign-in *screen* (not an overlay — overlays can be
   popped) and the app does not exist without a session. `data/seed.js` → `data/world.js`, whose
   arrays all ship **empty** and fill from Postgres: no mock users, no seeded posts, no invented
   follower or participant counts. Sessions persist in `localStorage` and are discarded only on a
   4xx from the auth server, so "sign in again" is rare rather than daily.
2. ✅ **Points and levels are earned.** `profiles.points` is recomputed from the rows by triggers
   on posts/likes/entries/votes (never `+=`, so a deleted post takes its points with it).
   `level_for_points()` maps the score onto the ten-level ladder, each step costing ~1.5x the last.
   Before this, every account sat at Level 1 forever while the UI put a `Lv1` chip on every card.
3. ✅ **The board ranks pours by likes**, from the live `top_posts` view. `scoreFromQ()` is deleted:
   it turned a constant into a 0–10 "art score" and was never even rendered.

Also here, because the bean passport made them impossible to ignore: **your own pours are fetched
in full** (`store.mine`) rather than filtered out of the current feed page — the profile grid,
streak, badges, stats and passport were all quietly showing only what happened to be on page one —
and `beanCatalog()` now prefers an exact match, after discovering that Tim Wendelboe's coffee named
simply *"Espresso"* was claiming every *"Espresso Anniversario"* in the catalogue.

⚠️ **`supabase/step-1.9.sql` must be run by hand** (Supabase SQL editor). Until it is, the client
degrades quietly: the board is empty and everyone reads 0 points at Level 1.

✅ **Working product:** a real social app where every number on screen traces to a row.

---

## Step 1.10 — Small edges, sharpened ✅ DONE

- ✅ **You cannot like your own pour.** Enforced in the `likes` insert policy, not just hidden in
  the UI — points come from likes received, so a self-like was 2 free points a tap. Existing
  self-likes are deleted by the migration.
- ✅ **The café directory is empty.** The five Tübingen cafés were real names wrapped in unverified
  hours, ratings and menus. Removed from the DB and from `seed.sql`, so re-seeding cannot bring
  them back. The Cafés tab and the "at a café" option in the create sheet both handle an empty
  directory rather than rendering a map with no pins.
- ✅ **Roasters are gone from the product.** You pick a coffee; a bean name already identifies its
  maker. The roaster select, the `recipe.roaster` field, the roaster row on bean pages and the
  roaster counts in the passport and stats are all removed, and the "Roaster hopper" badge is now
  "World tour" (5 origins).
- ✅ **Latte art is opt-in.** `freshCreate()` used to default `pattern` to `'rosetta'`, so every milk
  drink was tagged with art the user never claimed — and a post with `art:true` and no pattern
  rendered a `#null` chip. A pour counts as art only when a pattern was actually tagged.
- ✅ **The wordmark reloads the app.**
- ✅ Both throwaway test accounts removed (`delete from auth.users` — needs the SQL editor; the
  browser's role cannot do it, which is the same gap that blocks in-app account deletion).

⚠️ **`supabase/step-1.10.sql` must be run by hand.**

---

## Before Phase 2 — the honest gap list

Audited 2026-07-26 against the running code. Phase 2 ports these to native, so fixing them
here means fixing them once.

### Step 1.11 — audit fixes ✅ DONE (2026-07-26)

Found by asking "is this number real?" of the *media* path for the first time:

- 🔴 **No photo had ever reached R2.** The bucket had no CORS policy, so the browser's PUT died at
  the preflight, the client fell back to keeping the image inline, and `image_key` — a column for
  R2 object keys — received a 300 KB base64 data URI. Every viewer downloaded every photo at full
  size on every feed load (753 KB for four posts), no CDN resizing ever ran, and `deleteImage()`
  had nothing to delete, so a deleted post kept its image (a GDPR problem, not just waste).
  Fixed at three levels: a CHECK constraint so the column cannot hold an image, a submit-time
  retry with a visible failure instead of a silent fallback, and
  `supabase/migrate-base64-images.mjs` to move the three existing photos into R2.
- ✅ Saved collection is readable — `saves` rows are fetched instead of filtering the feed page.
- ✅ Notification deep links fetch the post instead of doing nothing.
- ✅ The board and people search respect blocks; blocking now holds everywhere, not just the feed.
- ✅ "Brew this recipe" restores the machine — `splitMachine()` reverses the stored "Brand Model".
- ✅ Points refresh when you open your profile, not only after you post.
- ✅ `avatar_color` is validated as a hex colour, client and database. It flows into a `style`
  attribute and users can PATCH their own row, so it was a CSS injection vector.
- ✅ Null guards on the café sheet (a café without hours) and the entry picker.

**Correctness (P0)** — done in steps 1.9 and 1.11:
- ✅ Own pours fetched in full, not derived from the feed page.
- ✅ Post cache: board rows, challenge entries and profile grids open instead of showing a blank
  sheet (`findPost()` only knew about the feed).
- ✅ `fetchMine()` takes the viewer's id, not the author's.
- ✅ Saved collection reads from `saves`.
- ✅ Notification deep links fetch the post.

**Data honesty (P1)** — what is still decorative:
- ⬜ Challenge `ends` is the literal string `'2d'`; challenges never actually end. Needs a
  timestamp, or the countdown should go.
- ⬜ Café `hours` is a string and the *Open now* filter is `hours.startsWith('Open')`. Needs real
  opening hours, or drop the filter.
- ⬜ Café ratings are editorial; the 10%-off promo is still mocked (a business motion, not a
  technical one).
- ⬜ Premium is a client-set boolean on the profile row. Harmless while it is free; enforce in RLS
  **before** it ever means money (see step 2.5).

**Operational, needs a human at a dashboard:**
- ✅ `step-1.9.sql` and `step-1.10.sql` run (points live, cafés emptied, test accounts gone).
- ✅ Email confirmation enabled.
- ✅ **R2 bucket CORS** (fixed 2026-07-28) — the allowed origin used to carry a path
  (`https://mgtajo.github.io/crema`); browsers send scheme+host only, so it could never match,
  and the move to the custom domain added a second origin the list didn't know about. Every
  photo landed inline until the policy listed `https://crema-app.com`,
  `https://www.crema-app.com`, `https://mgtajo.github.io` and `http://localhost:4599` as bare
  scheme+host. Symptom of a miss: the create sheet's "Upload failed" state, with a
  `TypeError: Failed to fetch` from the direct PUT in `data/media.js` — the presign call
  succeeds, because the Edge Function answers `Access-Control-Allow-Origin: *` and the bucket
  does not.
- ⬜ Run `step-1.11.sql`, then `migrate-base64-images.mjs`, then validate the constraint.
- ✅ `step-1.12.sql` run — post editing is enforced in the database, not just the client.
- ⬜ Run `step-1.13.sql` — until it does, Settings says profile photos aren't switched on yet.
  Nothing else breaks: every query naming `avatar_key` gives that one column up on the first
  error and retries without it, so avatars stay as initials.
- ✅ `step-1.15.sql` run (2026-07-28) — visibility + follow requests. Followers-only pours are
  enforced by the select policy on `posts`, and a follow is a request the other person accepts:
  the asker sees Requested, the followee gets the row above the feed and the inbox notification,
  and only they can move it to `accepted`. Before this the columns didn't exist, so the client
  gave up on them and every follow landed accepted the moment it was made.
- ⬜ Run `step-1.14.sql` — the new scoring. Do this one promptly: the Levels screen already
  shows the new rules, so until it runs the app describes a score the database isn't keeping.
  It restates everyone's points in one pass (challenges stop paying; exact recipes and new
  beans start).
- ⬜ **Supabase → Auth → URL Configuration → Redirect URLs** must list `https://mgtajo.github.io/crema/**`
  (and `http://localhost:4599/**`), or Google sign-in completes and then lands on the Site URL with
  no `?code=`. The Google console side is already correct.
- ⬜ Rotate the R2 access key that was pasted into a chat window.
- ✅ Throwaway auth users deleted; `step-1.11.sql` sweeps any remaining profile-less accounts.

---

## Step 1.16 — reasons to come back ✅ CODE DONE (needs deploy)

Everything Crema knew how to say, it said on a screen the user was already looking at. For a
habit product that is backwards: the moment that decides whether someone keeps a streak is the
moment they are *not* in the app. Two halves, and the first works for everyone.

### The streak, made legible

`domain/streak.js` — pure, tested (`streak.test.mjs`, 20 cases), no imports, so it ports to
React Native untouched. `streak()` used to be six lines inside the store returning a bare
number; it now answers *is this at risk*, *has the rest day been spent*, *what is the best ever*.

- **Rest days.** Once a streak reaches 7 days a single missed day is forgiven, once. Losing a
  40-day streak to one hotel morning is the moment people quit an app like this, and a streak
  nobody believes they can keep is a countdown, not a habit. Derived from the pours like every
  other count in Crema — replay the same posts, get the same streak. Two blank days still ends it.
- **The nudge on Home** appears on exactly three occasions: the streak is alive but today is
  empty (the only actionable one), today's pour hit a milestone, or a recent streak lapsed and
  is worth restarting. Every other day it renders nothing — a banner that shows up every
  morning is wallpaper by week two.
- **The streak sheet** (tap the chip) explains the rule, draws the last 28 days, and is where
  reminders are opted into.

### Reaching people who aren't looking

Web Push, no vendor SDK: `supabase/functions/send-push/` implements RFC 8291 encryption and
RFC 8292 VAPID on plain WebCrypto, ~140 lines, **verified against the published RFC 8291 §5
test vector** (`webpush.test.mjs`). That vector matters more than it looks — an implementation
that has, say, swapped the two public keys inside `key_info` encrypts and decrypts happily
against itself and fails against every real browser.

- `push_subscriptions` is owner-only under RLS in all four verbs. An endpoint plus its two keys
  *is* the capability to notify that person, so the table is closer to a credential store than
  to profile data.
- **Three switches, not one.** "Someone liked your pour" is a fact about another person and
  defaults on. The streak nudge and the weekly recap are Crema talking on its own initiative and
  default off. Bundled together, turning off the annoying one would cost the wanted one, so
  people turn off everything instead.
- **The permission prompt only ever fires from a tap on "Remind me"**, inside a sheet that has
  just explained what the reminder is for. An unexplained prompt is denied roughly always, and a
  denial is close to permanent.
- The streak rule now exists twice — plpgsql and JS. They are fuzzed against each other over
  34k histories (`streak-parity-test.mjs`); the first draft of the SQL disagreed on 1,496 of
  them, which would have meant an evening push the app then contradicted.

### Where it works — the part that shapes the design

Push reaches Chrome/Edge/Firefox on desktop and Android, and Safari 16.4+ on macOS, **in an
ordinary browser tab**. On **iOS it works only after Add to Home Screen** — Apple ships no Web
Push in a Safari tab, with no flag and no workaround.

So push is a bonus channel, never the only one: every nudge it carries is also visible in the
app itself. `iosNeedsInstall()` detects the iPhone-in-a-tab case and asks for the Home Screen
rather than showing a toggle that cannot work.

**Not done:** deploy. `supabase/README.md` §5 has the steps — generate nothing (the public key
is already in `config.js`), set the private key and hook secret, deploy `send-push`
`--no-verify-jwt`, then run `step-1.16.sql`. Email as a fallback channel for iOS-tab users is
still unbuilt and is the obvious follow-up.

---

### Phase 1 checkpoint — ✅ REACHED

| | Before | After |
| --- | --- | --- |
| Accounts | none | ✅ Email + password reset. ⚠️ Google (both ends configured; blocked on the Redirect URLs allow list). ⛔ Apple button removed 2026-07-26 — re-add with Developer Program enrolment |
| Data | one `localStorage` blob | ✅ Postgres + RLS (17/17 policy tests passing) |
| Media | base64 in browser | ✅ R2 + CDN transforms, verified end-to-end |
| Social | simulated | ✅ real, cross-user — follows, likes, saves, comments, reports, blocks |
| Signed-out | the whole app | ⛔ removed 2026-07-25 — sign-in gate, no demo mode (see principle 1) |
| Progression | `level` never moved | ✅ points from real activity; levels on a 1.5x curve (step 1.9) |
| Leaderboard | computed on read | ✅ live `top_posts` view — pours ranked by likes (replaced the nightly user board, step 1.9) |

**Open items carried into Phase 2 planning:** Sign in with Apple (needs Developer Program
enrollment first), account-deletion flow (and its R2/cache purge), Cloudflare cache purge on
image delete.

---

# Phase 2 — Native (Expo / React Native)

## Step 2.1 — Scaffold and prove the shared core

```bash
npx create-expo-app crema-native
```

Move the four non-UI layers into a shared location — either a monorepo package
(`packages/core`, consumed by both `web/` and `native/`) or, to start, a straight copy.

**Monorepo is the right call** if the web app stays live; a copy will drift within weeks.

Port as-is:

| Layer | Native status |
| --- | --- |
| `core/util.js` | Verbatim, minus `$`/`$$` (the only DOM-coupled part) |
| `data/*` | Verbatim |
| `domain/scoring.js` | Verbatim |
| `domain/art.js` | Verbatim logic; render the SVG string via `react-native-svg` |
| `store/*` | Verbatim; swap `localStorage` for `expo-secure-store` / `AsyncStorage` in the local adapter |

Then build **one screen** — the home feed as a `FlatList` of posts — against the Phase 1 API.

✅ **Working product:** a real app on your phone showing the live feed. Proves the whole
shared-core thesis in one screen.
*Rough effort: 3–4 days.*

---

## Step 2.2 — Screens, one tab at a time

Put the tab bar in from day one with placeholders, then fill tabs in. The web `ui/` maps
directly — one renderer per screen becomes one component per screen, and the single
`data-action` dispatcher in [`src/ui/actions.js`](src/ui/actions.js) becomes hooks/view-model
methods.

Suggested order, each shippable to TestFlight:

1. **Home** — feed, like, save, open post, comments.
2. **Profile** — stats, tabs, badges (`domain/scoring.js` already computes these).
3. **Explore** — search, challenges, leaderboard.
4. **Cafés** — list + detail (map comes next step).
5. **Create** — the most complex sheet; do it last, with the real camera.

Rebuild the design tokens from [`styles.css`](styles.css) as a JS theme object — the
light/dark token pairs port cleanly to a theme context.

✅ **Working product after each screen:** an app where that tab fully works and the rest show
"Coming soon". Genuinely demo-able throughout.
*Rough effort: 3–4 weeks.*

---

## Step 2.3 — Native capabilities

Now replace what the web could only mock:

| Web (mocked) | Native |
| --- | --- |
| `<input type="file" capture>` | `expo-camera` + `expo-image-picker` |
| Decorative SVG map | `react-native-maps` with real café lat/lng from Step 1.4 |
| `navigator.share`, `#p/<id>` | Native share sheet + universal/app links |
| Fixed `9:41` status bar | Real device chrome (the phone frame disappears entirely) |

✅ **Working product:** an app that feels native — real camera, real map, real sharing.
*Rough effort: 1 week.*

---

## Step 2.4 — Push notifications

`expo-notifications` (FCM on Android, APNs on iOS — you'll need an APNs auth key from Apple
regardless of the relay).

1. Register device token → `device_tokens` table on login.
2. Supabase trigger/Edge Function on new `notifications` rows → send push.
3. Deep-link the tap target to the right post/profile/challenge.
4. Ask for permission **contextually** (after a first meaningful interaction), never on launch —
   it materially changes opt-in rates.

✅ **Working product:** likes and follows buzz your phone and open the right screen.
*Rough effort: 3–4 days.*

---

## Step 2.5 — Premium as a real purchase

The `premium` boolean toggle in Settings becomes a real transaction. **Digital goods must go
through Apple/Google billing** — you cannot take card payments for in-app features, and this is
a common rejection reason.

1. Define the product in App Store Connect and Play Console.
2. RevenueCat SDK for purchase + receipt validation.
3. RevenueCat webhook → set `profiles.premium` server-side. **Never trust the client** for
   entitlement.
4. Implement **restore purchases** — required by Apple.

✅ **Working product:** Premium actually sells, gated server-side.
*Rough effort: 4–5 days.*

---

## Step 2.6 — Build & distribute

```bash
eas build --platform all      # cloud builds .ipa / .aab
eas submit --platform all     # uploads to both stores
```

- **TestFlight** (iOS) and **internal testing** (Play) — get real users on real devices early.
- **EAS Update** for OTA JS-only fixes without a store review. Native module changes still need
  a full build.

✅ **Working product:** installable builds in the hands of testers.
*Rough effort: 2–3 days, plus review latency.*

---

## Step 2.7 — Store submission

Non-code work that reliably takes longer than expected:

- **Legal**: privacy policy + terms (public URLs, required by both stores).
- **Apple privacy nutrition labels** and **Play Data safety** form — must match what you
  actually collect.
- ✅ **GDPR**: EU data region done (Phase 0 — Supabase EU + R2 EU jurisdiction, both confirmed).
  ⬜ Consent, export, and deletion still open — deletion must purge R2 too, and `deleteImage()`
  is ready for that call the moment a delete flow exists (Step 1.6).
- **Assets**: icon (you have `icon-512.png`), screenshots per required device size, description,
  keywords.
- ⬜ **Account deletion in-app** — Apple requires it, and **nothing exists yet**: no delete-account
  UI, no auth-user removal, no R2 purge trigger. This is the single largest concrete gap left
  anywhere in Phase 1/2.7 as of this checkpoint.
- ✅ **Moderation** — reports and blocking are real (Step 1.7). ⬜ A contact route for reviewers
  is not built.

Budget **1–2 weeks** including at least one rejection round. Rejections are normal; the common
ones here will be moderation tooling, account deletion, and IAP compliance.

✅ **Working product:** live on both stores.

---

### Phase 2 checkpoint

**Total: roughly 6–9 weeks solo**, on top of Phase 1.

---

## What comes after

- Analytics (PostHog / Amplitude) — you'll want funnel data before optimizing anything.
- Crash reporting (Sentry).
- Real art scoring — `scoreFromQ()` is gone (it derived a score from a `quality` the client
  always sent as 0.85, so every pour scored the same). Pours are ranked by the likes they earn
  until a CV model exists to judge them, which stays the interesting long-term product bet.
- Café partnerships — the 10%-off promo is mocked; making it real is a business motion, not a
  technical one.

---

## Quick reference

**Phase 1 (1.1–1.9): done and verified live.** Phase 2 hasn't started.

| | |
| --- | --- |
| **Do next** | Deploy step 1.16 (`supabase/README.md` §5 → then `step-1.16.sql`), and fix the Redirect URLs so Google sign-in completes. Both are dashboard work, both take minutes. |
| **Then** | Apple/Google developer enrolment (slow — start now, it blocks Phase 2 testing) |
| **Biggest real gap** | account deletion — doesn't exist in-app at all, blocks 2.7 store review |
| **Tooling** | `graphify update .` rebuilds a local code graph (`graphify-out/`, gitignored) — `affected`, `path` and `god-nodes` answer "what calls what" without grepping |
| **Was the riskiest step** | 1.5 (posts) — went cleanly; the actual surprises were three R2/Cloudflare deploy-config bugs in 1.6, not the data migration itself |
| **Most-underestimated, confirmed** | 1.2 RLS — worth every minute; `rls-test.mjs` has caught nothing wrong so far across 17 assertions, twice |
| **Never break** | session persistence — a transient refresh failure must never sign anyone out (only a 4xx does) |
| **Never trust the client** | premium entitlement, ownership checks (enforce in RLS) — holds; also true for the R2 upload path now (JWT-derived key prefix, never client-supplied) |
| **Pattern worth keeping** | every "is this number real?" audit found a bug — the constant art score, `level` that never moved, a passport built from one feed page, a bean lookup crediting the wrong roaster |
