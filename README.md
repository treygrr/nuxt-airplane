<p align="center">
  <img src="./docs/public/logo.png" width="140" height="140" alt="nuxt-airplane logo">
</p>

# nuxt-airplane

[![npm version](https://img.shields.io/npm/v/%40treygrr%2Fnuxt-airplane?color=00DC82&labelColor=020420)](https://www.npmjs.com/package/@treygrr/nuxt-airplane)
[![License](https://img.shields.io/npm/l/%40treygrr%2Fnuxt-airplane?color=00DC82&labelColor=020420)](./LICENSE)
[![Nuxt](https://img.shields.io/badge/Nuxt-4-00DC82?logo=nuxt&labelColor=020420)](https://nuxt.com)

Airplane mode for your GraphQL app.

📖 **[Documentation](https://treygrr.github.io/nuxt-airplane/)**

Give it an endpoint and your `.gql` files. Every operation becomes a typed
`useQuery` or `useMutation`, results live in IndexedDB (via Dexie), and anything
you change mid-flight queues up and lands on the server once you're back on the
ground.

## Setup

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@treygrr/nuxt-airplane'],
  airplane: {
    endpoint: 'https://api.example.com/graphql',
  },
})
```

| Option | Default | |
| --- | --- | --- |
| `endpoint` | `/api/graphql` | GraphQL endpoint. A relative path is resolved against the app itself. |
| `schema` | – | SDL file or URL. When omitted the endpoint is introspected. In dev a relative endpoint is introspected once the dev server is up; the last good schema is cached in `node_modules/.cache/nuxt-airplane`. |
| `documents` | `['**/*.gql', '**/*.graphql']` | Globs (relative to `srcDir`) of the files holding your operations. |
| `handlersDir` | `airplane` | Directory (relative to `srcDir`) scanned for mutation handler files. |
| `dbName` | `nuxt-airplane` | IndexedDB database name. |
| `stopOnFailure` | `true` | A failed mutation holds back the ones queued after it until retried or rolled back (`useSync().blocked` counts them). |
| `cacheKey` | – | Deploy key (git SHA, build id). A change wipes cached data on next load, outbox kept; a hash of your documents is always mixed in. `NUXT_PUBLIC_AIRPLANE_CACHE_KEY` overrides it. |
| `codegen` | `{}` | Extra config for the `typescript` / `typescript-operations` codegen plugins. |

## Operations

Every named operation in your documents becomes available by name. Fragments are
resolved across files.

```graphql
# app/graphql/sites.gql
query GetSites { sites { id name archived } }
mutation RenameSite($id: ID!, $name: String!) { renameSite(id: $id, name: $name) { id name } }
```

```vue
<script setup lang="ts">
const { data, loading, fetching, error, refresh } = useQuery('GetSites')
const rename = useMutation('RenameSite')

await rename.mutate({ id: 'site-1', name: 'New name' })
</script>
```

Both are fully typed from the schema: the document name is checked, variables
and `data` get the generated operation types.

`useQuery` returns **live data from local tables**, not the network response.
Stored data renders immediately and a refetch runs in the background when
online; any mutation handler that touches a row updates `data` right away.

`useMutation().mutate()` resolves as soon as the change is applied locally and
queued. Sending it to the server happens in the sync loop.

## Query handlers

The tables are the only store. Every type your documents select with an `id`
gets a Dexie table keyed on it, typed from the schema (`db.Site` here). A
query handler writes a response into the tables and reads the query back out;
`read` is what `useQuery` returns, online or offline. Put files under
`app/airplane/` and they are picked up automatically.

```ts
// app/airplane/queries.ts
export default defineQueryHandlers({
  GetSites: {
    store: ({ db }, data) => db.Site.bulkPut(data.sites),
    read: async ({ db }) => ({ sites: await db.Site.toArray() }),
  },
})
```

A query without a handler is served from the network and has nothing to show
offline.

## Mutation handlers

Handlers describe how a queued mutation changes the tables.

```ts
// app/airplane/sites.ts
export default defineMutationHandlers({
  RenameSite: {
    // Runs when the mutation is queued, so the UI reflects it immediately.
    apply: ({ db, variables }) => db.Site.update(variables.id, { name: variables.name }),
    // Optional: summary for the pending list, computed before `apply`.
    describe: ({ variables }) => `Rename site to ${variables.name}`,
    // Optional: merge the server's response once it has been sent.
    reconcile: ({ db, variables }, result) => { /* ... */ },
    // Optional: undo `apply`. When omitted, the rows `apply` touched are
    // snapshotted and restored on rollback.
    revert: ({ db, variables }) => { /* ... */ },
    // Queries to refetch after the server accepted it. Defaults to every active query.
    refetch: ['GetSites'],
  },
})
```

The handler context gives you `db`, the typed Dexie instance, and `variables`,
the mutation's input, typed. `apply` also gets `tempId()` for rows created
offline, and `reconcile` gets `resolve()` to map them to the server's ids.

## Auth and headers

```ts
// app/airplane/request.ts
export default defineAirplaneRequest({
  headers: () => ({ Authorization: `Bearer ${useCookie('token').value}` }), // runs per request, composables work
  credentials: 'include',
  onResponse: res => { if (res.status === 401) navigateTo('/login') },
})
```

Headers are computed when a request is sent, so a mutation queued offline goes out later with the token valid at that moment. Static headers go in the `headers` module option; `schemaHeaders` covers build-time introspection of a protected endpoint.

## Your own tables

Responses are stored one row per entity, in tables inferred from your documents: every type selected with an `id` gets a `db.<Type>` table, typed from the schema. Mutation handlers write to the rows directly and every query showing them updates on its own. Add a `read` handler with `defineQueryHandlers` when a query should answer filters it has never sent, or `store` and `read` for storage of your own shape. Rollback still works: writes made during `apply` are recorded by an undo log.

```ts
// app/airplane/stores.ts
declare global { interface NuxtAirplaneStores { sites: { id: string, name: string, archived: boolean } } }
export default defineAirplaneStores({ sites: '&id, name, archived' })

// app/airplane/queries.ts
export default defineQueryHandlers({
  GetSites: {
    // Rows land in `db.Site` on their own; a custom read answers any filter offline.
    read: async ({ db, variables }) => ({
      sites: (await db.Site.toArray()).filter(s => variables?.archived == null || s.archived === variables.archived),
    }),
  },
})

// app/airplane/sites.ts
export default defineMutationHandlers({
  RenameSite: { apply: ({ db, variables }) => db.Site.update(variables.id, { name: variables.name }) },
})
```

One file per operation also works: `defineMutationHandler('RenameSite', { … })` and `defineQueryHandler('GetSites', { … })` declare a single operation, and a folder with an `index.ts` is imported through its index only, so you can compose there.

Paginated queries can opt into fetching every page in the background so the whole set is available offline: `prefetch: { next: (data, vars) => data.pageInfo.hasNextPage ? { ...vars, after: data.pageInfo.endCursor } : null, when: () => settings.cacheCatalog }`. `useSync().prefetching` counts the runs in progress.

## Sync state

```ts
const { online, syncing, synced, pending, syncTotal, syncCount, lastError, sync, rollback, retry, goOffline, goOnline } = useSync()
```

- `pending` lists the queued mutations oldest first, each with a human-readable `description` (from the handler's `describe` hook, or the humanized document name), its variables and status.
- `rollback(id)` undoes a queued mutation locally and drops it from the queue. Mutations queued after it are re-applied on top of the restored data.
- A mutation the server rejects is marked `failed` and left in the queue, and the mutations queued after it wait (`blocked`) until you `retry(id)` or `rollback(id)` it; set `stopOnFailure: false` to keep sending past failures.
- A network failure stops the batch and keeps everything queued; the next `online` event (or `sync()`) resumes it.
- Tabs share the database; a Web Lock makes sure only one of them sends the queue at a time.
- `goOffline()` holds the client offline whatever the network says: queries serve the cache only and mutations stay queued. `goOnline()` releases it and syncs. `online` reflects the effective state; `networkOnline` and `forcedOffline` expose the two inputs. Handy for a "work offline" switch or for testing.

## Security

Cached data and the outbox live unencrypted in IndexedDB under your origin: clear them on sign-out with `useAirplane().clear()`, don't queue mutations whose variables you wouldn't store (change-password, card numbers), and render server error messages as text. Credentials are never persisted; `schemaHeaders` never ships. Full notes in the [Security guide](https://treygrr.github.io/nuxt-airplane/guide/security).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [pull request guidelines](https://treygrr.github.io/nuxt-airplane/contributing/pull-requests).

## Development

```sh
npm install
npm run dev          # playground with an in-memory Apollo server at /api/graphql
npm run lint
npm run test
npm run test:types
```

The playground (`playground/`) has a sites/items inventory demo: toggle the
network in devtools, make changes, roll some back, and go online again.
