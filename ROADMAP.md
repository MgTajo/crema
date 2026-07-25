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
2. ✅ **Leaderboard**: `leaderboard_weekly`, filled by `refresh_leaderboard_weekly()` from
   pours, art quality, likes received, and challenge results. ✅ `pg_cron` enabled and
   `crema-leaderboard` scheduled at `0 3 * * *` (03:00 UTC daily) — verified active in
   `cron.job`, not just submitted.
3. ✅ **Notifications**: rows generated by `security definer` triggers on `likes`/`comments`/`follows`,
   with **no insert policy** — a client cannot forge one even if it tried. The existing inbox
   UI reads straight off the table now.

Push *delivery* is Phase 2 (needs a native app). The data model lands here so the inbox is real.

✅ **Working product:** a feature-complete web app on a real backend. This is a legitimate
public beta — you could launch it as a PWA and get users before any native work.
*Fully done, including the leaderboard schedule.*

---

### Phase 1 checkpoint — ✅ REACHED

| | Before | After |
| --- | --- | --- |
| Accounts | none | ✅ Email. ⬜ Google (client code done, dashboard setup pending). ⬜ Apple (blocked on Developer Program enrollment) |
| Data | one `localStorage` blob | ✅ Postgres + RLS (17/17 policy tests passing) |
| Media | base64 in browser | ✅ R2 + CDN transforms, verified end-to-end |
| Social | simulated | ✅ real, cross-user — follows, likes, saves, comments, reports, blocks |
| Signed-out | the whole app | ⛔ removed 2026-07-25 — sign-in gate, no demo mode (see principle 1) |
| Leaderboard | computed on read | ✅ `pg_cron`, daily at 03:00 UTC |

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
- Real art scoring — `scoreFromQ()` currently derives scores from a stored `quality` value;
  an actual CV model is the interesting long-term product bet.
- Café partnerships — the 10%-off promo is mocked; making it real is a business motion, not a
  technical one.

---

## Quick reference

**Phase 1 (1.1–1.8): done and verified live.** Phase 2 hasn't started.

| | |
| --- | --- |
| **Do next** | Apple/Google developer enrolment (slow — start now, it blocks Phase 2 testing) |
| **Biggest real gap** | account deletion — doesn't exist in-app at all, blocks 2.7 store review |
| **Was the riskiest step** | 1.5 (posts) — went cleanly; the actual surprises were three R2/Cloudflare deploy-config bugs in 1.6, not the data migration itself |
| **Most-underestimated, confirmed** | 1.2 RLS — worth every minute; `rls-test.mjs` has caught nothing wrong so far across 17 assertions, twice |
| **Never break** | session persistence — a transient refresh failure must never sign anyone out (only a 4xx does) |
| **Never trust the client** | premium entitlement, ownership checks (enforce in RLS) — holds; also true for the R2 upload path now (JWT-derived key prefix, never client-supplied) |
