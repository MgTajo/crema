# Architecture

Crema is a buildless web app organised into **layers with one-way dependencies**, so the
pieces that a real product needs to swap live behind clear seams. The goal of this structure
is to make the eventual move to **a real backend** and a **native iOS/Android app** a series of
small, contained changes rather than a rewrite.

```
        ┌───────────────────────────── ui/ ─────────────────────────────┐
        │  app.js · actions · views · overlays · components · icons      │   presentation
        └───────────────┬───────────────────────────────┬───────────────┘
                        │                               │
                    domain/                          store/                 logic + state
         art.js · scoring.js · streak.js    store.js ── persistence.js
                        │                               │
                        └───────────────┬───────────────┘
                                     data/                                   content
              assets.js · catalog.js · world.js        (bundled catalog + live world)
              supabase.js · profiles · posts · social · challenges ·
              notifications · media · push · remote.js           (backend)
                                        │
                       config.js · core/util.js · i18n.js ─ i18n.de.js       pure helpers
```

A module only imports from layers **below** it. Nothing in `data/`, `domain/`, `core/` or
`store/` imports from `ui/`, so all the non-visual logic is portable to another runtime
(React Native, a Node service) untouched.

## The layers

| Layer | Files | Responsibility | Becomes, in the target app |
| --- | --- | --- | --- |
| **core** | `core/util.js` | Pure format/time/dom helpers | Shared utilities (the DOM helpers are the only web-only part) |
| **i18n** | `i18n.js`, `i18n.de.js` | English and German. `t()` keys *are* the English sentences, so an untranslated string falls back to itself; the chosen language lives in `localStorage` rather than in the store, because it has to be known before `load()` resolves and a signed-out visitor gets to pick it too | The same table, loaded per platform locale |
| **data** | `data/assets.js`, `data/catalog.js`, `data/world.js` | The bundled catalog (drinks, machines, milks, levels) and `world.js` — the people / café / challenge / podium maps, which ship **empty** and are filled from the backend | The same, plus a real image CDN |
| **data (backend)** | `data/supabase.js`, `profiles`, `posts`, `social`, `challenges`, `notifications`, `media`, `remote` | The only modules that touch the network: auth + PostgREST + R2, and the row⇄app mapping per domain | The same, pointed at production |
| **store** | `store/store.js`, `store/persistence.js` | The single source of truth: `state`, `ui`, selectors, and the persistence adapter | The client cache / API layer talking to your backend |
| **domain** | `domain/art.js`, `domain/scoring.js`, `domain/streak.js` | Craft logic: latte-art rendering, art scores, badges, streak rules | Same logic, shared between client and server — `streak.js` is already duplicated in plpgsql for the reminder job, and the two are fuzzed against each other |
| **ui** | `ui/*` | Rendering (`gate`, `views`, `overlays`, `components`, `icons`) and interaction (`actions`, `app`) | Native screens & view models |

## The persistence seam — where the backend plugs in

Today all persisted data flows through **one object**: the adapter in
[`src/store/persistence.js`](src/store/persistence.js). `store.js` calls `read()` / `write()` /
`clear()` and knows nothing about *where* the data lives.

```js
// store.js — unaware of storage mechanics
let persistence = makePersistence(session, KEY);
export async function load(){ const s = await persistence.read(); state = s && s.posts ? s : freshState(); … }
export function save(){ Promise.resolve(persistence.write(state)).catch(warn); }   // fire-and-forget
```

Every adapter method is `async`, `load()` is awaited once in `app.js` before the first
`render()`, and `save()` is optimistic — the UI has already repainted, so a failed write
warns rather than blocks. **No view, overlay, component or action changed for any of it.**

`makePersistence(session, KEY)` scopes that store to the signed-in user's id, so two accounts
on one browser never see each other's data. `useSession()` swaps it and reloads.

## The gate — gated on intent, not on entry

`app.js` restores the session before the first paint, but a missing one is no longer a dead
end. A visitor with no session is a **guest**: they get today's public feed, the sheet for any
pour on it, and the thread under it. Everything else — posting, liking, following, their own
profile, the Following tab, Explore, Cafés — raises the sign-in sheet the moment they reach
for it. `guestWall()` in [`ui/actions.js`](src/ui/actions.js) is the single choke point, and it
lists what a guest *may* do rather than what they may not, so an action added later is closed
until someone opens it.

This costs no new permissions. The `anon` role already reads exactly this much — `posts` is
`visibility = 'public'`, `profiles`/`likes`/`comments`/`reactions` are `using (true)`, and
every insert policy is `with check (auth.uid() = …)`, which no guest satisfies. The screen and
the database agree without either being talked into it.

Signing in is still a *screen*, not an overlay, because overlays can be popped and a
half-finished sign-up shouldn't be; `ui.gate` says whether it is showing, and back returns to
the feed the guest was reading rather than leaving the app.

The session (access + refresh token) lives in `localStorage` and is discarded **only** when the
auth server actually rejects the refresh token — a 4xx. An offline or 5xx refresh keeps the
session, so coming back the next day, or opening the app on a flaky connection, never means
signing in again.

## From seed data to API

`data/seed.js` is deliberately the shape a backend returns, which is why it doubles as the
fallback dataset. Domains migrate **one at a time**, each behind its own module, and each one
degrades to the bundled arrays if the network fails:

| Domain | Module | Migrated |
| --- | --- | --- |
| Cafés, beans, challenges | `data/remote.js` | ✅ read-only, TTL-cached, refills the exported arrays in place |
| Posts | `data/posts.js` | ✅ paginated feed, optimistic create |
| Profiles | `data/profiles.js` | ✅ created from local `state.me` on first sign-in |
| Follows, likes, saves, comments, blocks, reports | `data/social.js` | ✅ rows, with counts from aggregates/views |
| Challenges, entries, votes, the board | `data/challenges.js` | ✅ rows; the board is the live `top_posts` view, ranked by likes |
| Notifications | `data/notifications.js` | ✅ rows, written by triggers — the client cannot forge one |
| Photos | `data/media.js` | ✅ R2 via presigned URLs, delivered through the CDN |

| Points & levels | `domain/scoring.js` + triggers | ✅ recomputed from the rows on every post, like, entry and vote |

Nothing user-visible is bundled or invented any more: `world.js` starts empty, counts are
counted in Postgres, and an empty section says it is empty. The last fabricated number — a
hardcoded art `quality` of 0.85 that fed both a 0–10 "art score" and the old leaderboard — is
gone; a pour is scored by the likes it earns until something exists that can actually judge it.

The backend is reached only through `data/supabase.js` — a ~150-line client (GoTrue auth with
PKCE + refresh, and PostgREST queries) rather than a vendored SDK, so the app stays buildless
and self-contained. Endpoints and the publishable key live in `src/config.js`; both are
required — with either missing the app can only say it is misconfigured.

## Toward native (iOS/Android)

- **Reuse as-is:** `core/`, `data/`, `domain/` and most of `store/` are plain JS with no DOM —
  they run unchanged under React Native or in a shared package.
- **Rewrite per platform:** only `ui/` (which emits HTML strings) is web-specific. Its structure
  — one renderer per screen, one per overlay, a shared component set, a single action dispatcher —
  maps directly onto native screens, a component library and view-model methods.
- **Same contracts:** because the store's selectors (`myPosts()`, `feedPosts()`, `myBeans()`, …)
  and mutations are the app's real API, a native client calls the same functions against the
  same store.

## Conventions

- One-way imports (never import "upward" a layer).
- `state` and `ui` are exported as **live bindings** from the store; import them, never copy them.
- Views/overlays/components are pure `data → HTML string`; they never mutate state.
- All persistence goes through the store; the store is the only file that touches the adapter.
