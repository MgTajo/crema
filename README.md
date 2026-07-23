# ☕ Crema

A prototype social network for coffee lovers — post your latte art, log recipes, track your skill progress, discover cafés, and join weekly challenges. *Strava for the morning ritual.*

This is a **static, self-contained web app** — plain HTML/CSS/JS, no build step, no backend, no dependencies. It runs by opening `index.html`.

## Run locally

Just open the file:

```bash
open index.html        # macOS
```

Or serve it (nicer for testing uploads):

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## What's inside

| Screen | What it does |
| --- | --- |
| **Home** | Feed of pours with photos, art-score, recipe (bean · roaster · machine), likes, comments, follow. Filters: For you / Following. |
| **Explore** | Weekly challenges, a head-to-head duel you vote on, and the leaderboard. |
| **+ New pour** | Upload your own latte photo, tag the pattern, pick your bean / roaster / machine from lists, log the shot, and post. |
| **Cafés** | Map + café profiles with ratings, promos, and community pours. |
| **You** | Your skill-progress timeline, beans passport, stats, and gallery. |

- **Photos:** the seed feed uses bundled stock images in `assets/`. Your own posts use real photos you upload (resized in-browser).
- **Data:** everything is mock data kept in `localStorage`. The gear icon on your profile resets the demo.

## Deploy it live (pick one)

It's a folder of static files, so any static host works. For a low-traffic demo:

### Option A — GitHub Pages (free, permanent, you own it) — recommended
1. Create a new repo on GitHub (e.g. `crema`).
2. Push this folder (see commands below).
3. On GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → `main` / `root` → Save**.
4. Live in ~1 min at `https://<your-username>.github.io/crema/`.

### Option B — Netlify Drop (zero setup, instant)
Go to <https://app.netlify.com/drop> and drag this whole folder onto the page. You get a live link immediately (sign in to keep it permanent).

### Option C — Vercel / Cloudflare Pages
Import the repo, framework preset **"Other"**, output directory = root. Deploy.

## Push to GitHub

```bash
git add -A
git commit -m "Crema prototype"
git branch -M main
git remote add origin https://github.com/<your-username>/crema.git
git push -u origin main
```

## Notes

- No accounts, payments, or personal data are collected — it's a front-end demo.
- Uploaded photos never leave the browser (stored locally only).
- Stock images are for demonstration; swap them in `assets/` anytime.
