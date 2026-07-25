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
             art.js · scoring.js            store.js ── persistence.js
                        │                               │
                        └───────────────┬───────────────┘
                                     data/                                   content
              assets.js · catalog.js · seed.js          (bundled / fallback)
              supabase.js · profiles.js · posts.js · remote.js   (backend)
                                        │
                                config.js · core/util.js                     pure helpers
```

A module only imports from layers **below** it. Nothing in `data/`, `domain/`, `core/` or
`store/` imports from `ui/`, so all the non-visual logic is portable to another runtime
(React Native, a Node service) untouched.

## The layers

| Layer | Files | Responsibility | Becomes, in the target app |
| --- | --- | --- | --- |
| **core** | `core/util.js` | Pure format/time/dom helpers | Shared utilities (the DOM helpers are the only web-only part) |
| **data** | `data/assets.js`, `data/catalog.js`, `data/seed.js` | The catalog (drinks, machines, beans, levels) and the seeded world (users, posts, cafés, challenges) — now the **offline/fallback** copy | Bundled fallback dataset |
| **data (backend)** | `data/supabase.js`, `data/profiles.js`, `data/posts.js`, `data/remote.js` | The only modules that touch the network: auth + PostgREST, and the row⇄app mapping per domain | The same, pointed at production |
| **store** | `store/store.js`, `store/persistence.js` | The single source of truth: `state`, `ui`, selectors, and the persistence adapter | The client cache / API layer talking to your backend |
| **domain** | `domain/art.js`, `domain/scoring.js` | Craft logic: latte-art rendering, art scores, badges | Same logic, shared between client and server |
| **ui** | `ui/*` | Rendering (`views`, `overlays`, `components`, `icons`) and interaction (`actions`, `app`) | Native screens & view models |

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

`makePersistence(session, KEY)` is the whole sign-in migration: signed out it returns the
shared demo store, signed in the same adapter under a user-scoped key. `useSession()` swaps
it and reloads.

## From seed data to API

`data/seed.js` is deliberately the shape a backend returns, which is why it doubles as the
fallback dataset. Domains migrate **one at a time**, each behind its own module, and each one
degrades to the bundled arrays if the network fails:

| Domain | Module | Migrated |
| --- | --- | --- |
| Cafés, beans, challenges | `data/remote.js` | ✅ read-only, TTL-cached, refills the exported arrays in place |
| Posts | `data/posts.js` | ✅ paginated feed, optimistic create |
| Profiles | `data/profiles.js` | ✅ created from local `state.me` on first sign-in |
| Follows, likes, saves, comments | — | still local; `state.localLikes` / `localSaves` bridge them onto remote posts |
| Notifications, challenges, leaderboard | — | still local |

Whatever has not migrated keeps living in the state blob, per user. That is what makes every
step end in a working app rather than a half-migrated one.

The backend is reached only through `data/supabase.js` — a ~150-line client (GoTrue auth with
PKCE + refresh, and PostgREST queries) rather than a vendored SDK, so the app stays buildless
and self-contained. Endpoints and the publishable key live in `src/config.js`; setting
`SUPABASE_URL` to `''` forces pure demo mode.

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
