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

**1. Demo mode never goes away.**
The single most important rule. Signed-out users keep today's exact experience — seeded world,
`localStorage`, no account. Signing in swaps the persistence adapter for the remote one. If the
backend is down, half-built, or you're mid-migration, the app still runs. This is also a good
product decision: try before signup.

```js
// store/persistence.js — the whole migration in one function
export function makePersistence(session){
  return session ? new RemotePersistence(session) : new LocalStoragePersistence(KEY);
}
```

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

1. Supabase project, **EU (Frankfurt)** region. Save the project URL + anon key.
2. Cloudflare account → R2 bucket (`crema-media`), EU jurisdiction.
3. Bind a custom domain to the bucket (e.g. `media.crema.app`) and enable Image
   Transformations on that zone.
4. Apple Developer Program ($99/yr) and Google Play Console ($25 one-time) — **start these now**,
   Apple's enrolment can take days and blocks Phase 2 testing.
5. Decide the bundle identifier (`app.crema.ios` / `app.crema.android`) — painful to change later.

✅ **Working product:** unchanged web app, plus infrastructure ready to point at.
*Rough effort: 1 day, mostly waiting on account verification.*

---

# Phase 1 — Backend

## Step 1.1 — Make the store async (no backend yet)

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
*Rough effort: half a day.*

---

## Step 1.2 — Schema + RLS (database only)

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
*Rough effort: 2–3 days including RLS testing.*

---

## Step 1.3 — Auth, additive

Add sign-in without taking anything away.

1. Enable Email, Apple, and Google providers in Supabase.
   **If you ship Google sign-in, Apple requires Sign in with Apple too.**
2. Add a Settings entry: *Sign in / Create account* (signed out) or *Signed in as … / Sign out*.
3. On first sign-in, create the `profiles` row from the local `state.me` — the onboarding data
   the user already entered.
4. Wire `makePersistence(session)` and re-run `load()` on auth state change.

At this point `RemotePersistence` can still be a stub that throws — just don't flip anyone to it
yet. Or implement it as read-your-own-blob to prove the seam end to end.

✅ **Working product:** app works signed out (exactly as today) **and** signed in (same
experience, now with a real account). Two modes, both functional.
*Rough effort: 2 days.*

---

## Step 1.4 — Reference data from the DB

Lowest-risk real migration: read-only data with no writes and no auth complexity.

1. Seed `cafes`, `beans`, `challenges` tables from
   [`src/data/seed.js`](src/data/seed.js) and [`src/data/catalog.js`](src/data/catalog.js).
2. Add `data/remote.js` that fetches them, with the bundled arrays as fallback on any error.
3. Cache in `localStorage` with a short TTL so offline/PWA still works.

Add real **lat/lng** to cafés here — Phase 2 needs them for the native map, and the current
`x`/`y` percentages are decorative only.

✅ **Working product:** app looks identical, but editing a café row in Supabase changes what
users see. First proof the backend is live.
*Rough effort: 2 days.*

---

## Step 1.5 — Posts (the first genuinely social step)

The big one. Signed-in users' posts live server-side and are visible to everyone.

1. Implement `RemotePersistence` properly — but **not** as one blob. Expand the store into
   granular calls behind the same selectors:

   | Store today | Becomes |
   | --- | --- |
   | `feedPosts()` | `GET /posts?…` (paginated, newest first) |
   | `myPosts()` | `GET /posts?user_id=eq.me` |
   | `submitPost()` in `ui/actions.js` | `POST /posts` |
   | `findPost(id)` | `GET /posts?id=eq.…` |

2. Keep the optimistic pattern the UI already uses: mutate `state`, repaint immediately, then
   fire the network call and reconcile on failure.
3. Add **pagination** — the current feed renders everything. Infinite scroll on `created_at`.
4. Signed-out users keep reading the bundled seed feed.

✅ **Working product:** two accounts on two devices see each other's posts. It's a social
network now.
*Rough effort: 4–5 days.*

---

## Step 1.6 — Media to R2

Until now posts carried base64 data URLs (works, but heavy). Now they carry R2 keys.

### Upload path

1. **Keep the client-side resize.** `handleUpload()` in
   [`src/ui/actions.js`](src/ui/actions.js) already downscales to 1080px on canvas — port that
   behaviour forward. A CDN optimizer downstream doesn't make uploading a 12MP original free.
2. Supabase **Edge Function** `POST /upload-url`: verifies the JWT, generates an object key
   (`posts/{user_id}/{uuid}.jpg`), returns a **presigned PUT URL** for R2.
3. Client PUTs bytes straight to R2 — they never transit Supabase.
4. Client saves `image_key` on the post row.

### Delivery

Serve through the custom domain with transformations in the URL:

```
https://media.crema.app/cdn-cgi/image/width=800,format=auto/posts/<key>
```

Build a small helper (`data/media.js`) so call sites ask for `imageUrl(key, 'feed'|'thumb'|'hero')`
rather than hand-writing transformation strings. Feed cards, the 3-up grid, and café heroes all
want different widths.

### Migration + cleanup

- Existing base64 images: either leave them (they're per-browser demo data and will age out) or
  upload on next edit. Not worth a migration job.
- **Account deletion must purge R2 objects**, not just DB rows. Write this now, while the
  data model is small — GDPR requires it and retrofitting is worse.

✅ **Working product:** photos load fast from CDN, in the right size per surface.
*Rough effort: 3 days.*

---

## Step 1.7 — Social graph

`follows`, `likes`, `saves`, `comments`, `comment_likes`, `cafe_follows` as real tables.

These are the highest-traffic writes in the app, and all of them are already optimistic in
`ui/actions.js` (`toggleLike`, `toggleFollow`, `toggleSave`, `addComment` all mutate → repaint →
`save()`). Keep that: mutate local, repaint, POST, revert on failure.

Add here:
- **Rate limiting** on comments (spam surface).
- **Report handling** — the Report button is currently a toast that does nothing. Make it write
  a `reports` row. You need a moderation story before the App Store review, not after.
- **Block/mute** — Apple's review guidelines expect moderation tools in social apps with UGC.

✅ **Working product:** the full social loop — follow, like, comment, save — across accounts.
*Rough effort: 4 days.*

---

## Step 1.8 — Challenges, leaderboard, notifications

1. **Challenges**: `challenge_joins` + `challenge_entries`. Entry votes become real rows, not
   the current `seedOf(id)` hash in `challengeEntries()`.
2. **Leaderboard**: a scheduled job (pg_cron) computing weekly points from pours, art scores and
   challenge results into a `leaderboard_weekly` table. Don't compute on read.
3. **Notifications**: rows generated by Postgres triggers on `likes`/`comments`/`follows`.
   The inbox UI already exists and reads a `notifications` array — point it at the table.

Push *delivery* is Phase 2 (needs a native app). The data model lands here so the inbox is real.

✅ **Working product:** a feature-complete web app on a real backend. This is a legitimate
public beta — you could launch it as a PWA and get users before any native work.
*Rough effort: 4–5 days.*

---

### Phase 1 checkpoint

| | Before | After |
| --- | --- | --- |
| Accounts | none | Email / Apple / Google |
| Data | one `localStorage` blob | Postgres + RLS |
| Media | base64 in browser | R2 + CDN transforms |
| Social | simulated | real, cross-user |
| Signed-out | the whole app | preserved as demo mode |

**Total: roughly 4–6 weeks solo.**

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
- **GDPR**: EU data region (done in Phase 0), consent, export, and deletion — deletion must
  purge R2 too (Step 1.6).
- **Assets**: icon (you have `icon-512.png`), screenshots per required device size, description,
  keywords.
- **Account deletion in-app** — Apple requires it for any app with account creation.
- **Moderation** — reports, blocking, and a contact route (Step 1.7). Reviewers check this for
  UGC apps.

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

| | |
| --- | --- |
| **Do first** | Apple/Google developer enrolment (slow), Supabase EU project |
| **Riskiest step** | 1.5 (posts) — the first real data migration |
| **Most-underestimated** | 1.2 RLS policies, and 2.7 store review |
| **Never break** | signed-out demo mode |
| **Never trust the client** | premium entitlement, ownership checks (enforce in RLS) |
