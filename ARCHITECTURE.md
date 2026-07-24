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
                        assets.js · catalog.js · seed.js
                                        │
                                     core/util.js                            pure helpers
```

A module only imports from layers **below** it. Nothing in `data/`, `domain/`, `core/` or
`store/` imports from `ui/`, so all the non-visual logic is portable to another runtime
(React Native, a Node service) untouched.

## The layers

| Layer | Files | Responsibility | Becomes, in the target app |
| --- | --- | --- | --- |
| **core** | `core/util.js` | Pure format/time/dom helpers | Shared utilities (the DOM helpers are the only web-only part) |
| **data** | `data/assets.js`, `data/catalog.js`, `data/seed.js` | The catalog (drinks, machines, beans, levels) and the seeded world (users, posts, cafés, challenges) | Backend database + API responses |
| **store** | `store/store.js`, `store/persistence.js` | The single source of truth: `state`, `ui`, selectors, and the persistence adapter | The client cache / API layer talking to your backend |
| **domain** | `domain/art.js`, `domain/scoring.js` | Craft logic: latte-art rendering, art scores, badges | Same logic, shared between client and server |
| **ui** | `ui/*` | Rendering (`views`, `overlays`, `components`, `icons`) and interaction (`actions`, `app`) | Native screens & view models |

## The persistence seam — where the backend plugs in

Today all persisted data flows through **one object**: the adapter in
[`src/store/persistence.js`](src/store/persistence.js). `store.js` calls `read()` / `write()` /
`clear()` and knows nothing about *where* the data lives.

```js
// store.js — unaware of storage mechanics
const persistence = new LocalStoragePersistence(KEY);
export function load(){ const s = persistence.read(); state = s && s.posts ? s : freshState(); … }
export function save(){ persistence.write(state); }
```

To move to a backend you write a second adapter with the same three methods (a
`RemotePersistence` sketch is already in that file) and hand it to the store. **No view,
overlay, component or action changes.**

### Making it async

A network backend is asynchronous, so the one real code change beyond the adapter is to
`await` the store's `load()`/`save()`:

- `load()` → `async`; `await` it once in `app.js` boot before the first `render()`.
- `save()` → fire-and-forget (optimistic UI: mutate `state`, repaint, then `await persistence.write`).

The interaction layer already mutates `state` first and repaints immediately, so optimistic
updates map onto it naturally.

## From seed data to API

`data/seed.js` is deliberately the shape a backend would return: arrays of users, posts,
cafés, challenges. When the backend exists, `freshState()` in the store stops cloning
`SEED_POSTS` and instead hydrates from `persistence.read()` (i.e. the API). The `data/catalog.js`
reference lists (drinks, machines, beans) become read-only catalog endpoints.

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
