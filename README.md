# ☕ Crema

A prototype social network for coffee lovers — post any coffee (latte art or not), log recipes, track your skill, join challenges, and discover cafés. *Strava for the morning ritual.*

**Live app:** https://mgtajo.github.io/crema/ — sign-in required; there is no demo mode.

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
R2 for photos — see [supabase/README.md](supabase/README.md) for the one-time setup.

## Project structure

```
index.html        markup + mount points; loads styles.css and src/app.js
styles.css        all styling (theme tokens, components)
src/
  app.js          composition root & boot
  core/util.js    pure helpers (format, dom, time)
  data/           supabase.js (auth + PostgREST) · profiles · posts · social · challenges ·
                  notifications · media (R2) · remote (café/bean/challenge directory) ·
                  world.js (people & directory, filled from the backend) · catalog · assets
  store/          persistence.js (the swappable backend seam) · store.js (state + selectors)
  domain/         art.js (latte-art SVG) · scoring.js (scores & badges)
  ui/             gate.js (sign-in screen) · icons · components · views · overlays · actions
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the layers map onto a real backend + native iOS/Android app, and [ROADMAP.md](ROADMAP.md) for the step-by-step plan to get there.

## What's inside

| Area | Features |
| --- | --- |
| **Accounts** | Email + password or Google / Apple sign-in, password reset, change password, sign out. The session is remembered, so a returning visitor on the same device goes straight in. |
| **Onboarding** | Runs once for a new account: name, username & city, then your machine + go-to drink (prefills new posts). |
| **Home feed** | Posts with photos, art score, drink/pattern/machine chips, expandable honest recipes (only fields the author filled in), like / comment / share / save / follow. For you & Following filters. |
| **Posts** | Full detail view, comment likes & replies, @mentions that open profiles, ⋯ menu (copy link, save, report), **Brew this recipe** (one-tap re-log with prefilled create sheet), share (native share / copy link), deep links (`#p/<id>`). |
| **People** | Tap any name/avatar → user profile with bio, stats, and their pours. Follower/following lists. People-to-follow suggestions. |
| **Explore** | Working search (people, beans, cafés, pours), challenges with **entry submission** and per-challenge leaderboards, the board of most-liked pours, trending pattern feeds (#rosetta …). |
| **Cafés** | Map + café profiles for **5 real Tübingen cafés** (Südhang, Willi's, Marktschenke, Hanseatica, Waschhaus), working filters (open now / deals / top rated), directions to Maps, community pours per café. |
| **Progress** | Every pour earns points (10 a pour, 2 per like received, 25 per challenge entry, 1 per vote); levels come from the cumulative score on a curve where each step costs ~1.5x the last. Computed in Postgres by triggers, so the numbers match the rows behind them. |
| **Profile** | Level + points progress bar, recent-activity chart with hover tooltips, recent coffees strip, beans passport with **bean detail pages** (origin, process, tasting notes, your pours), pours/saved/badges/stats tabs, **10 badges** with progress. |
| **Create** | Photo upload (resized in-browser), any drink type, pattern picker for milk drinks, **specific coffee brands available in Germany** (local + international roasters), a **brand → model machine picker** (100+ machines), optional recipe with no fabricated defaults. Adding your own coffee is a **Premium** feature (free to switch on in Settings while Crema is young). |
| **Notifications** | Inbox fed by Postgres triggers on likes, comments and follows, with an unread dot; rows open the relevant post / profile / challenge / café. |
| **Settings** | Account (email, password, sign out), edit profile (name, username, bio, city, machine), **light/dark/auto theme**, scores & levels explainer. |
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

Any static host works. This repo auto-deploys to **GitHub Pages** from `main` (Settings → Pages → main / root):

```bash
git add -A && git commit -m "your change" && git push   # live in ~1 min
```

Alternatives: Netlify Drop (drag the folder), Vercel / Cloudflare Pages (framework preset "Other").

## Notes

- Accounts are real and required; email addresses live in Supabase Auth (EU region). No payments are taken — Premium is a free switch for now.
- The images in `assets/` are stock photography used for café cards; swap them anytime.
