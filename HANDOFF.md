# Handoff: turn the playground into a full shop that stresses nuxt-airplane

You are picking up a piece of work in this repository. This document is everything you get from the previous session, so it is long on context and short on file-by-file instructions. Read it through once before you start.

## The job

`playground/` is a small sites-and-items demo. Replace it with a complete, component-based ecommerce app, built with Vuetify, that uses every feature of the module hard enough to break it.

The app is a means. The real deliverable is evidence: either the module holds up under a realistic app, or you find where it does not. A bug you find in the module is a success, not an obstacle. Do not work around one in the app. Record it (see [When the module misbehaves](#when-the-module-misbehaves)).

Why now: in the last few days the module's core was redesigned (two layers, failure chains), seven scaling features landed, the handlers moved into a web worker by default, and the options were regrouped. All of it is unit-tested against a fake IndexedDB in Node. None of it has been used by a real app. That is the gap this work closes.

## What you are working with

**The module** (`src/`, published as `@treygrr/nuxt-airplane`, version 0.6.0, not yet released) is an offline-first GraphQL client for Nuxt 4:

- Operations live in `.gql` files. `useQuery('Name')` and `useMutation('Name')` are typed from them.
- Data lives in IndexedDB tables (Dexie). A query handler's `store` writes a response into the tables; its `read` builds the query's result from them, live.
- A mutation is applied locally by its handler's `apply`, queued in an outbox, and sent later. `reconcile` runs with the server's answer.
- Handlers that write run in a web worker by default. They get `db` and `variables` and nothing from Nuxt: no composables, no `window`.

Read these before writing code. They are the source of truth, and they are current:

| Read | For |
| --- | --- |
| `docs/content/1.getting-started/3.configuration.md` | Every module option |
| `docs/content/2.guide/2.mutations.md` | Queueing, chains, temp ids, `queue: false` |
| `docs/content/2.guide/3.mutation-handlers.md` | `apply`, `reconcile`, `merge`, `refetch`, where handlers run |
| `docs/content/2.guide/4.stores-and-query-handlers.md` | Tables, `store`/`read`, prefetch, two layers, eviction |
| `docs/content/2.guide/5.sync-and-offline.md` | The sync loop, side-by-side sending, retries, idempotency keys |
| `docs/content/2.guide/7.auth-and-headers.md` | `defineAirplaneRequest`, session errors |
| `src/runtime/client.ts`, `engine.ts`, `helpers.ts` | When the docs do not answer it |

**The playground today**: one `app.vue` of 384 lines, two components, an in-memory Apollo server as a Nitro route (`playground/server/`), bearer-token auth where any token passes, and one `.gql` file. Its handlers under `playground/app/airplane/` are good examples of the handler style. You are replacing the domain, so the existing sites/items code goes; keep the server pattern (SDL file as a Nitro server asset, feeding both Apollo and the module's type generation).

**How the repo runs**:

```sh
npm install            # at the repository root; the playground is a workspace
npm run dev            # prepares the module stub, then nuxt dev playground
npm run lint
npm run test           # vitest: the module's unit tests
npm run test:types     # vue-tsc on the module and on the playground
npm run dev:build      # production build of the playground
```

The playground loads the module by package name through the workspace, as a stub that points at `src/`. A dev server keeps the module code it started with: after changing anything under `src/`, restart it. Nuxt refuses a second dev server for the same directory, and the owner often has one running on port 3000. If you need your own, ask them to stop theirs.

## Ground rules

These come from the owner, Trey, and they are not negotiable:

- **Branch from `main`, open a PR, do not merge.** Trey merges. Before pushing to a PR branch, check it is still open (`gh pr view <n> --json state`); a commit pushed to a merged branch is lost. Never base one PR on another PR's branch.
- **Conventional Commit titles**, for commits and PRs (`feat(playground): …`). A CI check enforces it.
- **No AI attribution** in commits or PRs: no `Co-Authored-By`, no "Generated with" footer.
- **Keep the docs in sync.** If you change the module, update `docs/content/` and the README in the same PR. The installation page has a tip that describes the playground; update it.
- **The module is pre-release.** Breaking stored data or the API is fine when it is the right fix. No migrations, no aliases for old names.
- **One native behaviour over an option.** If you propose a module change, propose the behaviour, not a new knob, unless two real use cases conflict.
- **One mutation per thing.** The API you design must have `updateCartLine`, not an `updateCart` that takes the whole cart. Trey was explicit about this, and the module's side-by-side sending depends on it.

Work in phases (below) and open one PR per phase rather than one enormous PR. Each should leave `npm run lint`, `npm run test`, `npm run test:types` and `npm run dev:build` passing.

## The stack

- **Nuxt 4**, already in place.
- **Vuetify 4** (`vuetify` 4.3.x at the time of writing) through **`vuetify-nuxt-module`** (1.0.0-rc.6 at the time of writing; its peer range is `vuetify ^3.4.0 || ^4.0.0`). Install `vuetify` yourself, then add the module to `playground/nuxt.config.ts`. One risk to check first: its docs name Vite 7 as the baseline and this repo is on Vite 8. If it does not work, fall back to registering Vuetify with a plain Nuxt plugin and `vite-plugin-vuetify`, and say so in the PR.
- **Icons**: `@mdi/font`, or SVG icons through `@mdi/js` if you want the bundle small.
- Add dependencies to `playground/package.json`, not the root. Check current versions with `npm view <pkg> version` before pinning; do not trust the numbers above blindly.

### The Vuetify MCP server: set this up first

Vuetify 4 is recent enough that your memory of component APIs is likely to be of Vuetify 3. The owner wants the UI built against the Vuetify MCP server, which serves current component APIs, documentation and migration notes. It is read-only: it answers questions, you write the code.

Add it to the project, as `.mcp.json` at the repository root:

```json
{
  "mcpServers": {
    "vuetify": {
      "type": "http",
      "url": "https://mcp.vuetifyjs.com/mcp"
    }
  }
}
```

That is the hosted server and needs no API key. Do not add one; a key is only for Vuetify One subscribers. The equivalent command is `claude mcp add --transport http --scope project vuetify https://mcp.vuetifyjs.com/mcp`. If the hosted server is unreachable, the local form is `npx -y @vuetify/mcp`.

MCP servers load when a session starts. If the `vuetify` tools are not available to you, the file was added after your session began: stop, tell Trey, and have the session restarted. Do not build the UI from memory in the meantime.

Then use it: look up each component's props, slots and events before you write it, and check the Vuetify 4 migration notes for anything you remember from Vuetify 3. Commit `.mcp.json` with the first PR.

## The shop

A storefront for a hardware and tools retailer (the current seed data is tools; keep the theme). One signed-in demo customer, plus a guest state. The server stays in memory inside the playground, seeded deterministically so every run and every test starts from the same data.

### Domain

Design the schema yourself around these. Every type that is a thing gets an `id`, because the module gives each one a table.

| Type | Notes |
| --- | --- |
| `Category` | A tree, two levels deep. |
| `Product` | Name, description, brand, price, rating, images, category. Thousands of them. |
| `Variant` | Size or pack options of a product, each with its own price and stock. |
| `Cart` | One per customer. Holds totals the server computes. |
| `CartLine` | **Its own type with its own id**, not just a list on the cart. |
| `Wishlist`, `WishlistItem` | Several lists per customer, with a note per item. |
| `Address` | A customer's address book, one default. |
| `Order`, `OrderLine` | Placed orders, with a status that moves on its own over time. |
| `Review` | A customer's review of a product: rating, text. |
| `Coupon` | Applied to a cart; some are valid, some are not. |
| `Customer` | Profile fields. |

Seed size must be configurable. A default of about 2,000 products keeps dev fast; a "stress" preset of 50,000 or more products is what the scaling features are for. Put the choice somewhere a test can set it (an env variable, or a debug mutation that reseeds).

### Operations, and what each one is there to stress

Aim for 15 or more queries and 25 or more mutations. The right-hand column is the point of each row: if a feature in it ends up exercised by nothing, add an operation.

**Queries**

| Operation | Stresses |
| --- | --- |
| Category tree | A small query many components mount at once: in-flight dedupe. |
| Product list, cursor-paginated, with `prefetch` to the end | Prefetch, chunked writes, the worker on big pages, `prefetch.when` (a "keep catalog offline" setting). |
| Product list by category, by search, sorted | `read` answering filters the server has never seen, from indexes, offline. |
| Product detail (one per product visited) | Many fetch records: eviction has something to drop. |
| Cart with its lines | Two layers: refetched while edits are pending. |
| Order summary (subtotal, tax, shipping, total), **stored in its own table** | Narrowed refetch: cart-line mutations must name it in `refetch`. |
| Wishlists, addresses, orders, order detail, reviews for a product, customer profile | Ordinary coverage, and tables the queue changes while they are mounted. |
| At least one query with **no handler** | Network-only behaviour, and the offline error. |

**Mutations**

| Operation | Stresses |
| --- | --- |
| Add cart line | `tempId()`, then edits against the placeholder: chains. Rejected when out of stock: a failed row. |
| Set cart line quantity | `merge` (tap + five times, one request). Rejected over stock: the later edit of the same line waits (`after`). |
| Remove cart line | Rollback of a remove; a remove of a line created offline. |
| Apply and remove coupon | A rejection ("invalid code") that holds nothing else back. |
| Create wishlist, add item, set item note, move item to cart | A three-deep chain on placeholders; `merge` on the note. |
| Create, update, delete address; set default address | Offline create then "set as default": `dependsOn` through a temp id. Two edits of different fields of one address: same row, kept in order. |
| Create, edit, delete review | Create offline, edit before it syncs, roll the create back: the edit goes with it. |
| Update profile fields | Same-piece ordering when a first rename fails. |
| **Place order**, with `queue: false` | Drains the queue first, rejects offline, runs `reconcile`, replaces temp ids in its variables. |
| Cancel order, reorder (adds every line of an old order to the cart) | Many unrelated mutations queued at once: side-by-side sending. |
| At least one mutation with **no `apply`** | The "could be about anything" path: it must be sent alone, in order, and refetch everything. |

For each handler decide deliberately between naming `refetch` and leaving the default, and say why in a comment where it is not obvious.

A good way to start the handlers: set `handlers: { generate: true }` once, let the module scaffold a file per operation, then fill them in and turn the option back off. That exercises the scaffolding feature on a realistic set of operations. Note anything awkward about what it generates.

Remember where handlers run. `store`, `apply`, `describe`, `merge`, `reconcile` and `revert` are in the worker: no `useRoute`, no `useState`, no Vuetify, no `window`. If a handler needs something from the page, it goes in the mutation's variables. `read`, `prefetch` and `request.ts` are on the page.

### The server has to fight back

A server that always says yes proves nothing. Give the in-memory server a **chaos control** that the app can drive (a debug mutation or a plain REST route, your choice) and that a test can script:

- **Latency**: fixed and random delay per request.
- **Network failure**: drop the next N requests, or a percentage.
- **Lost answer**: apply the mutation, then fail the response. This is the case idempotency keys exist for.
- **Session expiry**: answer 401 with code `UNAUTHENTICATED` until the token is "refreshed".
- **Rate limiting**: answer 429 with a `Retry-After` header.
- **Server errors**: answer 503.
- **Targeted rejection**: reject the next mutation of a given name with a GraphQL error.

And make the server able to tell on the client:

- **Idempotency**: remember every `extensions.idempotencyKey` and answer a repeat with the first result. Count the repeats.
- **Double application**: detect a mutation applied twice anyway (stock decremented twice, two orders).
- **Ordering**: keep a per-entity sequence and record when two mutations on the same entity arrive out of the order they were made, or overlap in time.
- **Concurrency**: record the largest number of mutations in flight at once.

Expose those counters through a debug query so the app can show them and a test can assert on them.

## The app

### Structure

File-based routing with pages and a layout; the single `app.vue` goes. Components are small, grouped by area, and typed. A page composes components; it does not contain markup for things that are components elsewhere.

```
playground/app/
  layouts/default.vue
  pages/
    index.vue                  home: featured, categories
    c/[category].vue           category listing
    search.vue
    p/[id].vue                 product detail
    cart.vue
    checkout.vue
    wishlists/…
    account/…                  profile, addresses
    orders/…                   list, detail
    dev.vue                    the lab (below)
  components/
    catalog/   cart/   checkout/   wishlist/   account/   orders/   reviews/
    sync/      everything about the queue and the connection
    lab/       the chaos and stress controls
    app/       app bar, navigation drawer, footer
  composables/                 useCart(), useWishlists(), … thin wrappers
  graphql/                     .gql files, one per area, shared fragments
  airplane/                    handlers: queries/, mutations/, stores.ts, request.ts
```

Rules for components:

- A component gets data by props and reports by events, or calls one of the area composables. It does not call `useQuery` for another area's data.
- The area composables (`useCart()` and so on) are where `useQuery` and `useMutation` are called, so each operation has one home.
- No business logic in templates. No component over roughly 150 lines; split it.
- Vuetify components throughout, looked up through the MCP server. Responsive: it should work on a phone width, since offline use is mostly a phone problem.
- Loading, empty, error and offline states are designed, not left to chance: skeleton loaders while `loading`, an empty state, and what a page shows offline when its query was never fetched.

### Sync, visible everywhere

The queue is the feature. The shop should show it the way a real app would:

- An app-bar indicator: online or offline, syncing with progress (`syncCount` of `syncTotal`), a count of pending changes, a count of failed ones.
- A pending-changes panel (a drawer or a page): each row with its `description`, status and error, indented under what it depends on, with retry and roll back. Before a rollback, show what `dependents(id)` says will go with it.
- A "retrying in N s" line from `retryAt`.
- A "work offline" switch (`goOffline` / `goOnline`).
- Optimistic rows should look pending: a cart line that has not synced yet is marked.
- A failed mutation surfaces where the user is looking (a snackbar with a way to the panel), not only in the panel.

### The lab (`/dev`)

A page for driving the stress scenarios by hand and watching what the module does:

- The chaos controls above.
- Generators: queue 500 quantity changes across 50 lines; queue 200 unrelated mutations; reorder a 40-line order; visit 300 product pages; prefetch the whole catalog.
- Live numbers: rows per table, fetch records, `base` entries, outbox size, storage used and quota (`navigator.storage.estimate()`), the server's counters.
- Buttons for `evict()`, `clearCache()`, `clear()`.
- Timings for the generators, so "is this fast" has a number. Put the results in the PR.

## What it has to prove

These scenarios are the acceptance test. Each should be doable by hand from the app, and each should end up as an automated test (see the last phase). For every one, write down what you observed, pass or fail.

1. **Offline shopping trip.** Offline: add five products, change quantities, remove one, add an address, set it default, write a review. Go online. Everything lands, in a workable order, `base` is empty afterwards, and the server holds exactly what the app showed.
2. **Merge.** Offline, tap a quantity from 1 to 10. One pending row, one request, quantity 10.
3. **Chain failure.** Offline, create a wishlist, add three items, set a note on one. Make the create fail. The four below it wait, nothing else does. Roll the create back: all five go, and the tables show no trace.
4. **Unrelated failure.** With ten mutations queued, reject one in the middle. The other nine sync.
5. **Lost answer.** Add a cart line while the server applies it and drops the response. After the retry there is one line and stock went down once. The server counted a repeated key.
6. **Session expiry mid-queue.** Twenty queued, token expires after five. The sync stops, nothing is marked failed, and after a refresh the remaining fifteen go.
7. **Rate limit.** A 429 with `Retry-After: 3` is retried after about three seconds with nobody touching anything.
8. **Side by side.** Two hundred unrelated mutations drain with up to four in flight, never more, and the server recorded no ordering violation on any entity. Repeat with `concurrency: 1`.
9. **Refetch while editing.** With a quantity change pending, refetch the cart. The pending quantity still shows; after it syncs the server's totals show.
10. **Narrowed refetch.** After a quantity change syncs, the order summary is up to date (because the handler names it), and an unrelated mounted query was not refetched.
11. **Catalog at scale.** With the stress seed, prefetch the whole catalog. The page stays responsive throughout (measure long tasks), and search and sort work offline afterwards.
12. **Eviction.** Visit enough product pages that eviction runs, with edits pending. Old product records go; nothing the queue changed goes; a dropped product refetches when revisited.
13. **Two tabs.** Queue in one tab, watch it appear in the other. Only one tab sends. Close the sending tab mid-batch: the other finishes, with nothing sent twice.
14. **Reload mid-sync.** Reload during a batch. The queue survives and resumes; nothing is applied twice.
15. **Checkout.** With edits queued, place the order (`queue: false`): the queue drains first and the order matches the cart. Offline, it is refused with a clear message.
16. **Deploy.** Change `database.cacheKey` with edits pending. The cache is wiped, the queue is kept and re-applied on the fresh data.
17. **Worker off.** The whole app works with `handlers: { worker: false }` too.

## When the module misbehaves

It will. When something looks wrong:

1. Decide whether it is the app or the module. Reproduce it in the smallest form you can.
2. If it is the module, write it up in `playground/FINDINGS.md`: what you did, what happened, what should have happened, and how sure you are of the cause. Keep one entry per finding.
3. If the fix is small and clear, make it on its own branch and PR, with a failing-then-passing test in `test/client.test.ts` (the style there: a real Dexie on `fake-indexeddb`, a mocked `fetch` as the server). Do not fold module fixes into a playground PR.
4. If the fix is a design question, do not decide it. Write the options in the finding and leave it for Trey.
5. Never hide a module bug with app code. If you must work around one to keep going, mark the workaround with a comment that names the finding.

Things already known, so you do not rediscover them:

- A mutation that changed some rows but missed one that was not stored yet is not re-applied when that row arrives, unless a row it did change is in the response.
- A copy of a placeholder row nested inside another row, or a reference to it there, keeps the placeholder id until the next refetch.
- Eviction has only been tested with a simulated quota error. The 90% check through `navigator.storage.estimate()` has never run for real.
- Nothing has been run in Firefox or Safari.
- No performance has been measured. You will produce the first numbers.
- Which inferred tables exist is decided by scanning the source for their names. A table reached only by a computed name is not created; list it in `defineAirplaneStores`.
- IndexedDB cannot index booleans. Store `0 | 1` for anything a `read` filters on by index; the module warns in dev.

## Phases

Each is a PR. Report at the end of each: what was built, what was verified and how, and any findings.

1. **Foundation.** `.mcp.json`, Vuetify installed and rendering, layout and app shell, routing. The old demo still works or is cleanly removed; say which.
2. **Server.** Schema, deterministic seed with the two sizes, resolvers, the chaos control, the counters. No UI needed beyond the lab's controls. Type generation works from the SDL.
3. **Catalog.** Categories, listings, search, product detail, prefetch, offline reads. Scenario 11's measurements.
4. **Cart and checkout.** Cart, lines, coupons, order summary, addresses, placing an order, orders. Scenarios 1, 2, 5, 9, 10, 15.
5. **Everything else.** Wishlists, reviews, profile, the sync UI, the rest of the lab. Scenarios 3, 4, 6, 7, 8, 12, 13, 14, 16, 17.
6. **Automated.** Playwright tests for the scenarios, under `playground/e2e/`, driving the chaos control, run on Chromium, Firefox and WebKit. Add an `npm` script. Leave it out of the required CI checks until it has proven stable, and say what is flaky.

If you run short, a finished phase 4 with honest notes is worth more than a thin phase 6.

## What done looks like

- A shop a person could use, that keeps working with the network off.
- Every module feature exercised by at least one operation, and each scenario above with a recorded result.
- `playground/FINDINGS.md` with what broke. An empty file is a legitimate result only if every scenario really passed in a browser.
- Numbers for the scale scenarios in the PRs.
- CI green on each PR, including the playground build and its type check.

## Out of scope

Real payments, real authentication (the fake bearer token stays), server-side rendering of shop data, an admin back office, internationalisation, and a database for the server. If one of these seems necessary, it probably is not; ask.
