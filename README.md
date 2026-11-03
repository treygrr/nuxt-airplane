# nuxt-airplane

Airplane mode for your GraphQL app.

Give it an endpoint and your `.gql` files. Every operation becomes a typed
`useQuery` or `useMutation`, results live in IndexedDB (via Dexie), and anything
you change mid-flight queues up and lands on the server once you're back on the
ground.

## Setup

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['nuxt-airplane'],
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

`useQuery` returns **live data from the local cache**, not the network response.
A cached result renders immediately and a refetch runs in the background when
online; any mutation handler that touches the cache updates `data` right away.

`useMutation().mutate()` resolves as soon as the change is applied locally and
queued. Sending it to the server happens in the sync loop.

## Mutation handlers

Handlers describe how a queued mutation shows up in the local cache. Put files
under `app/airplane/` and they are picked up automatically.

```ts
// app/airplane/sites.ts
export default defineMutationHandlers({
  RenameSite: {
    // Runs when the mutation is queued, so the UI reflects it immediately.
    apply: ({ cache, variables }) =>
      cache.update('GetSites', (data) => {
        const site = data.sites.find(s => s.id === variables.id)
        if (site) site.name = variables.name
      }),
    // Optional: merge the server's response once it has been sent.
    reconcile: ({ cache, variables }, result) => { /* ... */ },
    // Optional: undo `apply`. When omitted, the rows `apply` touched are
    // snapshotted and restored on rollback.
    revert: ({ cache, variables }) => { /* ... */ },
    // Queries to refetch after the server accepted it. Defaults to every active query.
    refetch: ['GetSites'],
  },
})
```

The handler context gives you:

- `cache.update(name, updater)` / `cache.update(name, variables, updater)`: edit cached responses in place or return a replacement.
- `cache.get(name, variables?)`, `cache.set(name, variables, data)`, `cache.invalidate(name)`.
- `db`: the Dexie instance (`queries` and `mutations` tables) if you need to go lower.
- `variables`: the mutation's input, typed.

## Your own tables

Opt a query into normalized storage: declare Dexie tables with `defineAirplaneStores`, then tell the module how to `store` a response and `read` it back with `defineQueryHandlers`. Mutation handlers write to the tables directly and every query reading them updates on its own. Rollback still works: writes made during `apply` are recorded by an undo log.

```ts
// app/airplane/stores.ts
declare global { interface NuxtAirplaneStores { sites: { id: string, name: string, archived: boolean } } }
export default defineAirplaneStores({ sites: '&id, name, archived' })

// app/airplane/queries.ts
export default defineQueryHandlers({
  GetSites: {
    store: ({ db }, data) => db.sites.bulkPut(data.sites),
    read: async ({ db }) => ({ sites: await db.sites.toArray() }),
  },
})

// app/airplane/sites.ts
export default defineMutationHandlers({
  RenameSite: { apply: ({ db, variables }) => db.sites.update(variables.id, { name: variables.name }) },
})
```

## Sync state

```ts
const { online, syncing, synced, pending, syncTotal, syncCount, lastError, sync, rollback, retry, goOffline, goOnline } = useSync()
```

- `pending` lists the queued mutations (document name, variables, status) oldest first.
- `rollback(id)` undoes a queued mutation locally and drops it from the queue. Mutations queued after it are re-applied on top of the restored data.
- A mutation the server rejects is marked `failed` and left in the queue; `retry(id)` or `rollback(id)` it.
- A network failure stops the batch and keeps everything queued; the next `online` event (or `sync()`) resumes it.
- `goOffline()` holds the client offline whatever the network says: queries serve the cache only and mutations stay queued. `goOnline()` releases it and syncs. `online` reflects the effective state; `networkOnline` and `forcedOffline` expose the two inputs. Handy for a "work offline" switch or for testing.

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
