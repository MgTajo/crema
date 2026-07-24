# ☕ Crema

A prototype social network for coffee lovers — post any coffee (latte art or not), log recipes, track your skill, join challenges, and discover cafés. *Strava for the morning ritual.*

**Live demo:** https://mgtajo.github.io/crema/

This is a **static, self-contained web app** — plain HTML/CSS/JS, no build step, no backend, no dependencies. It runs by opening `index.html`, and installs as a **PWA** when served over HTTPS.

## Run locally

```bash
open index.html        # macOS — or just double-click it
# or, nicer (enables the service worker):
python3 -m http.server 8000   # → http://localhost:8000
```

## What's inside

| Area | Features |
| --- | --- |
| **Onboarding** | First-run flow: name & city, your machine + go-to drink (prefills new posts), follow suggestions. |
| **Home feed** | Posts with photos, art score, drink/pattern/machine chips, expandable honest recipes (only fields the author filled in), like / comment / share / save / follow. For you & Following filters. |
| **Posts** | Full detail view, comment likes & replies, @mentions that open profiles, ⋯ menu (copy link, save, report), **Brew this recipe** (one-tap re-log with prefilled create sheet), share (native share / copy link), deep links (`#p/<id>`). |
| **People** | Tap any name/avatar → user profile with bio, stats, and their pours. Follower/following lists. People-to-follow suggestions. |
| **Explore** | Working search (people, beans, cafés, pours), challenges with **entry submission** and per-challenge leaderboards, weekly duel voting, full leaderboard, trending pattern feeds (#rosetta …). |
| **Cafés** | Map + café profiles for **7 real Tübingen cafés**, working filters (open now / deals / top rated), directions to Maps, community pours per café. |
| **Profile** | Recent-activity chart with hover tooltips, recent coffees strip, beans passport with **bean detail pages** (origin, process, tasting notes, your pours), pours/saved/badges/stats tabs, **10 badges** with progress. |
| **Create** | Photo upload (resized in-browser), any drink type, pattern picker for milk drinks, **specific coffee brands available in Germany** (local + international roasters), a **brand → model machine picker** (100+ machines), optional recipe with no fabricated defaults. Adding your own coffee is a **Premium** feature (demo toggle in Settings). |
| **Notifications** | Mock inbox with unread dot; rows open the relevant post / profile / challenge / café. |
| **Settings** | Edit profile (name, bio, city, machine), **light/dark/auto theme**, scores & levels explainer, demo reset. |
| **PWA** | Manifest + service worker + icons — installable, works offline after first visit. |

- **Data:** everything is mock data kept in `localStorage` (key `crema_v10`). New visitors start like a fresh download — empty profile, no pours, based in **Tübingen** — while the community feed, challenges, leaderboards and cafés are already populated. Reset via Settings → Reset the demo.
- **Photos:** seed feed uses bundled stock images in `assets/`; your posts use photos you upload (never leave the browser).
- **Latte art:** posts without photos render generated SVG cups (quality-aware — wobbly to crisp).

## Deploy

Any static host works. This repo auto-deploys to **GitHub Pages** from `main` (Settings → Pages → main / root):

```bash
git add -A && git commit -m "your change" && git push   # live in ~1 min
```

Alternatives: Netlify Drop (drag the folder), Vercel / Cloudflare Pages (framework preset "Other").

## Notes

- No accounts, payments, or personal data are collected — it's a front-end demo.
- Stock images are for demonstration; swap them in `assets/` anytime.
