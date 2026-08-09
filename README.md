# ☕ Crema

A prototype social network for coffee lovers — post any coffee (latte art or not), log recipes, track your skill, join challenges, and discover cafés. *Strava for the morning ritual.*

**Live app:** https://crema-app.com — open it and today's pours are right there. An account is
asked for when you act (post, like, follow), never to look.

This is a **static, self-contained web app** — plain HTML/CSS/JS, **no build step, no bundler, no dependencies**. The code is organised as native **ES modules** under [`src/`](src/) in clean layers (data → store → domain → ui), so it can grow into a real product. It installs as a **PWA** when served over HTTPS.

## Run locally

The app uses ES modules, so it must be **served over HTTP** (module scripts don't run from `file://`):

```bash
python3 devserver.py          # → http://localhost:4599  (or $PORT)
```

Use `devserver.py` rather than `python3 -m http.server`: it sends `no-store`, so you don't end
up debugging a cached copy of a module you just edited. A server is required anyway for the
service worker / PWA install.

The app talks to a Supabase project (EU) configured in [`src/config.js`](src/config.js) and to
R2 for photos — see [platform/supabase/README.md](platform/supabase/README.md) for the one-time setup.

## Project structure

The repo holds two things: the **web app**, which GitHub Pages serves straight from the
repo root and so cannot move into a subfolder, and the **platform** work behind it. Brand
and go-to-market material lives in an untracked `business/` folder — the repo is public and
doubles as the web root, so it is deliberately not committed (see [`.gitignore`](.gitignore)).

```
── the web app (served at crema-app.com — these paths are the live URLs) ──
index.html        markup + mount points; loads styles.css and src/app.js
styles.css        all styling (theme tokens, components)
sw.js             service worker (precache list; bump the cache name on deploy)
manifest.webmanifest · icon-192.png · icon-512.png    PWA install
assets/           stock photography for café cards
impressum/ · privacy/ · child-safety/                 legal pages (legal.css, legal.js)
.well-known/      assetlinks.json — proves the domain to the Android TWA
src/
  app.js          composition root & boot
  core/util.js    pure helpers (format, dom, time)
  data/           supabase.js (auth + PostgREST) · profiles · posts · social · challenges ·
                  notifications · media (R2) · remote (café/bean/challenge directory) ·
                  world.js (people & directory, filled from the backend) · catalog · assets
  store/          persistence.js (the swappable backend seam) · store.js (state + selectors)
  domain/         art.js (latte-art SVG) · scoring.js (scores & badges)
  ui/             gate.js (sign-in screen) · icons · components · views · overlays · actions
devserver.py      local static server with no-store (see "Run locally")

── platform/ — everything that ships the app but isn't served by it ──
platform/supabase/      schema, the ordered step-1.x migration chain, Edge Functions, tests.
                        Run its CLI commands from platform/ — see platform/supabase/README.md
platform/android-twa/   Play Store wrapper (Bubblewrap/Gradle), signing material, resign.sh
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the layers map onto a real backend + native iOS/Android app.

## What's inside

| Area | Features |
| --- | --- |
| **Accounts** | Email + password or Google / Apple sign-in, password reset, change password, sign out. The session is remembered, so a returning visitor on the same device goes straight in. |
| **Onboarding** | Runs once for a new account: name, username & city, then your machine + go-to drink (prefills new posts). |
| **Home feed** | Posts with photos, art score, drink/pattern/machine chips, expandable honest recipes (only fields the author filled in), like / comment / share / save / follow — you can't like your own pour (enforced in RLS, not just hidden). For you & Following filters. |
| **Posts** | Full detail view, comment likes & replies, @mentions that open profiles, ⋯ menu (copy link, save, report), **Brew this recipe** (one-tap re-log with prefilled create sheet), share (native share / copy link), deep links (`#p/<id>`). |
| **People** | Tap any name/avatar → user profile with bio, stats, and their pours. Follower/following lists. People-to-follow suggestions. |
| **Explore** | Working search (people, beans, cafés, pours), challenges with **entry submission** and per-challenge leaderboards, **today's podium** (the day's three most-liked pours), trending pattern feeds (#rosetta …). |
| **Cafés** | Map + café profiles read from the directory tables, with filters, directions to Maps and community pours per café. The directory is **empty by design** — the five placeholder Tübingen cafés were removed in step 1.10; add cafés when there is verified data behind them. |
| **Progress** | Points from real activity: 10 a pour, 15 for a bean you've never logged, 5 for a recipe with dose and yield, 3 per comment received, 2 per like received, whatever a finished challenge says, and 15/10/5 for finishing a day in 1st/2nd/3rd on today's podium. Levels come from the cumulative score on a curve where each step costs ~1.5x the last. Computed in Postgres by triggers, so the numbers match the rows behind them. |
| **Profile** | Level + points progress bar, recent-activity chart with hover tooltips, recent coffees strip, **bean passport** — every coffee you have logged, with origin, roast and how often you have poured it, plus per-bean detail pages, pours/saved/badges/stats tabs, **10 badges** with progress. |
| **Create** | Photo upload (resized in-browser), any drink type, pattern picker for milk drinks, **specific coffee brands available in Germany** (you pick the coffee — there is no separate roaster field), a **brand → model machine picker** (100+ machines), optional recipe with no fabricated defaults. Latte art is opt-in: a cappuccino posts as a cappuccino unless you tag a pattern. |
| **Premium** | Six perks: **your week in coffee** (a shareable card, below), **the stats tab** — including *where it is going* (weekly totals over three months, and the month-on-month delta) — a **gold ring** on your avatar everywhere you appear, **always ad-free**, pinning your gear & coffees, and naming your own drink types. Free right now but **redeemed with a code** (`FIRSTPOUR`), handed out by mail from hello@crema-app.com — the flag can only be raised by `redeem_premium()` in Postgres, so it is a real lock rather than a client-side boolean. Logging your coffee is free for everyone, permanently: no paywall ever stands between someone and an honest record. |
| **Week in coffee** | A wrapped-style card of one **Monday–Sunday**, which turns over **Sunday at 16:00 local** — the hour the week is over in every way that matters to the person who lived it, rather than a Monday morning nobody is thinking about coffee on. It says its dates on its face and is the same card all week (and the same window as everyone else's). Its centre is **up to three standouts you pick yourself** — the week's photos, big enough to see, defaulting to the most-reacted three until you choose — over **seven bars, one per day**, with the busiest drawn in the darker roast. Then four numbers: **your usual**, **coffee o'clock** (the hour you pour at, averaged around the clock), **ahead of** (where your week sits among everyone else pouring it, from `week_standing()` in Postgres) and **applause** (the reactions the week collected). A tile with nothing behind it is replaced rather than shown as a zero. Rendered as a 1080×1350 SVG and shared as a PNG straight into Instagram; the preview and the export are the same string, so what you see is what lands. |
| **Notifications** | Inbox fed by Postgres triggers on likes, comments and follows, with an unread dot; rows open the relevant post / profile / challenge / café. Push adds a morning nudge, a streak reminder, and **your week in coffee on Sunday at 16:00 local** — the same hour the card lands, deep-linked to `#recap` so tapping it opens the card. |
| **Settings** | Account (email, password, sign out), edit profile (name, username, bio, city, machine), **Premium** (code redemption, or switch it off), **light/dark/auto theme**, scores & levels explainer. |
| **PWA** | Manifest + service worker + icons — installable, works offline after first visit. |

- **Data:** everything real. Profiles, posts, likes, comments, follows, saves, blocks, reports,
  challenge entries, votes and notifications are rows in Supabase Postgres (EU), protected by
  RLS. Cafés, beans and challenges come from the directory tables. Follower, pour and
  participant counts are counted in the database, never stored or invented. `localStorage`
  (key `crema_v11`, scoped per user) keeps only the session, theme, create-sheet defaults and a
  cache of the last-seen feed.
- **Photos:** uploaded straight to Cloudflare R2 via a presigned URL and delivered from the CDN
  at the size each surface needs.
- **Latte art:** posts without photos render generated SVG cups (quality-aware — wobbly to crisp).

## Deploy

This repo auto-deploys to **GitHub Pages** from `main`, served from the repo **root**
(Settings → Pages → main / root), on the custom domain in [`CNAME`](CNAME):

```bash
git add -A && git commit -m "your change" && git push   # live in ~1 min
```

Because the root *is* the web root, the app's files have to stay there — `index.html`,
`styles.css`, `sw.js`, `manifest.webmanifest`, the icons, `src/`, `assets/` and the legal
pages. Moving any of them into a subfolder changes its public URL and breaks the service
worker's precache list, the manifest scope and the TWA's `assetlinks.json`. `platform/` is
published as dead weight but referenced by nothing, which is harmless.

On another static host (Netlify, Vercel, Cloudflare Pages, preset "Other") point the publish
directory at the repo root, and exclude `platform/` if the host lets you.

## Notes

- **The week card reads photos through the object URL, not the resized one.** A card destined for a
  PNG can only carry pixels it owns — an SVG rasterised through an `<img>` never fetches external
  resources — so each photo is pulled through a canvas into a `data:` URI first. The
  `/cdn-cgi/image/…` variants are answered by Cloudflare's resizing edge, which does **not** carry
  the bucket's CORS headers, so a transformed image can be shown but never read: drawing one into a
  canvas taints it, and a tainted canvas cannot be exported at all. The object's own URL does carry
  them (the `coffee` bucket already allows `GET` from the app's origins), so `imageSource()` in
  `src/data/media.js` asks for that and the card downscales it itself. Nothing that merely
  *displays* an image uses it — `imageUrl()` still serves a tenth of the bytes.
- Accounts are real and required; email addresses live in Supabase Auth (EU region). No payments are taken and no card is asked for — Premium is free for now and opened by a code, so the people using it are people who wrote in and can be told when that changes.
- The images in `assets/` are stock photography used for café cards; swap them anytime.
