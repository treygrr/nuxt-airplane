# Changelog

## 0.7.0 (2026-11-19)

Twelve changes since 0.6.1. Three of them break existing apps; the upgrade steps are first.

## Upgrading from 0.6.1

- **`useQuery` is now `useAirplaneQuery`.** Rename the calls, or keep the old name with the new `imports` option: `airplane: { imports: { useAirplaneQuery: 'useQuery' } }`. (#94)
- **Row types changed.** (#100)
  - A field that only a mutation's result left out is now required. A `put` of a partial mutation result (`db.Site.put(result.renameSite)`) no longer compiles where the row needs more; use `db.Site.update(id, result.renameSite)`.
  - A nested entity is typed from what is selected on it at that place, so `SiteRow['items'][number]` is an inline type, not `SiteItemRow`.
  - Casts such as `put(row as never)` and `as unknown as QueryResult<'Name'>` can go.
- **Nothing is sent until the first page has hydrated.** Code that called `goOffline()` straight after startup to win a race no longer needs to. (#97)
- **With `codegen: { nonOptionalTypename: true }`**, the module now asks for `__typename` in every selection it sends, and a row an `apply` builds must write it. (#104)

## New

### Online queries, rendered on the server (#94)

`useOnlineQuery` asks the server and keeps nothing: for search suggestions, reports, live prices. It needs no handler.

```ts
const { data, error, fetching } = useOnlineQuery('Search', () => ({ term: term.value }), {
  enabled: () => term.value.length >= 2,
})
```

- It asks only while `enabled`, compares variables by value, and lets the latest request win.
- Offline it sends nothing and sets an `OfflineError`. It asks again on reconnect unless `refetchOnReconnect: false`.
- While Nuxt renders a page on the server, it asks there with your `defineAirplaneRequest` options and hands the answer to the browser in the page, so the browser does not ask again. `server: false` turns that off.
- After a sync it is asked again only when a mutation names it in `refetch`.

`useAirplaneQuery` also takes `enabled`: while `false` nothing is read or fetched.

### Local variables (#92)

A handler declares variables that reach its hooks and never the server, with their defaults. A filter the server has no argument for is answered from the tables, and toggling it fetches nothing.

```ts
export default defineQueryHandler('GetSiteItems', {
  local: { lowStock: false },
  read: async ({ db, variables, local }) => /* filter with local.lowStock */,
})

useAirplaneQuery('GetSiteItems', () => ({ siteId, lowStock: lowStockOnly.value }))
```

Mutation handlers take `local` too. The values are kept on the queued mutation and handed to `describe`, `apply`, `reconcile` and `revert`.

### "Work offline" is kept (#97)

- `goOffline()` / `goOnline()` survive a reload and hold in every open tab. Before, a reload or a second tab sent the queue the first tab was holding back.
- `startOffline: true` starts a device offline until the user chooses otherwise.
- Going offline while a batch is being sent lets what is in flight land and starts nothing more.

### Handlers without casts (#100, #104, #103)

- **Row types match what handlers do.** Mutations no longer make a row's fields optional. A handler that keeps nested entities in their own table can leave them off the row it writes. `update()` and `modify()` compile on types that reference each other.
- **`hasFields(row, 'archived', 'owner')`** checks that a row has the fields a `read` needs and types it as having them, in place of a cast.
- **`__typename` is on a row wherever a document selects it**, so narrowing on it compiles. With `nonOptionalTypename: true` the module requests it everywhere, and a `read` need not write the root one.
- **Eight helper types need no import:** `QueryName`, `QueryResult`, `QueryVariables`, `MutationName`, `MutationResult`, `MutationVariables`, `MutationRow`, `AirplaneDexie`.

### Results with no `id` (#99)

`store: 'result'` keeps a whole query result that has no table of its own, such as the signed-in user or feature flags, one per set of variables. It is cleared, evicted and rolled back like other cached data. `result(name, variables?)` on every handler context reads or changes one.

```ts
export default defineQueryHandler('GetViewer', { store: 'result' })
```

### Smaller additions

- **`isTempId(value)`** tells a placeholder id from a real one, in components and handlers, in place of matching `tmp-` by hand. (#98)
- **`useSync().failed`** lists the mutations the server refused. (#96)
- **The database schema is written to a file**, `.nuxt/nuxt-airplane/schema.ts`: every table, its indexes and where it comes from. `database.schemaFile` also writes a copy into the app to commit. (#93)
- **`imports` module option** renames the auto-imported `use*` composables. (#94)

## Fixed

- A page reloaded with changes queued, or with "work offline" on, no longer hydrates with a mismatch: `useSync()` reports what the server rendered until the page has hydrated. (#97)
- Two queries selecting different arms of the same union field produced a row type their results were not assignable to. (#104)
- A field selected both beside and inside a type condition was emitted twice in a row type. (#104)

## Docs and tests

- The landing page and the introduction say why the module exists. (#101)
- A rollback test now waits for syncing to settle. (#102)
