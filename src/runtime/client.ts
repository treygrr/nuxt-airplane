import { liveQuery } from 'dexie'
import { hash } from 'ohash'
import { reactive, computed, shallowRef, readonly } from 'vue'
import { BOOKKEEPING_TABLES, applyUndo, createDb, withUndoLog } from './db'
import {
  GraphQLRequestError,
  type CacheApi,
  type GraphQLResponse,
  type MutationHandlers,
  type MutationHandler,
  type MutationRow,
  type AirplaneRequestContext,
  type AirplaneRequestOptions,
  type AirplaneRuntimeConfig,
  type AirplaneStores,
  type OperationDocument,
  type QueryHandler,
  type QueryHandlers,
  type QueryName,
  type Updater,
} from './types'

export interface AirplaneClientOptions extends AirplaneRuntimeConfig {
  documents: Record<string, OperationDocument>
  /** Hash of the compiled documents, mixed into the cache key. */
  documentsHash: string
  mutationHandlers: MutationHandlers
  queryHandlers: QueryHandlers
  stores: AirplaneStores
  request: AirplaneRequestOptions
  /** Runs a function inside the Nuxt app context (so composables work in `headers`). */
  runWithContext?: <T>(fn: () => T) => T | Promise<Awaited<T>>
}

/** What `useQuery` observes: the live data plus the cache row's metadata. */
export interface QuerySnapshot {
  data: unknown
  updatedAt: number | null
  /** A response for this query has been stored at some point. */
  cached: boolean
}

/** `ArchiveSite` → `Archive site`, `SendHTTPRequest` → `Send http request`, for mutations without a `describe`. */
export function humanize(name: string) {
  const words = name
    .replace(/[_-]+/g, ' ')
    // Acronym followed by a word: `HTTPRequest` → `HTTP Request`.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `undefined`, `null` and `{}` all mean "no variables" and share a key. */
export function queryKey(name: string, variables: unknown) {
  const normalized = variables && typeof variables === 'object' && Object.keys(variables).length ? variables : null
  return `${name}:${hash(normalized)}`
}

export type AirplaneClient = ReturnType<typeof createAirplaneClient>

export function createAirplaneClient(options: AirplaneClientOptions) {
  const db = createDb(options.dbName, options.stores.stores, options.stores.version)
  const { documents, mutationHandlers, queryHandlers } = options

  // A schema that no longer matches what is on disk (lowered version, changed
  // primary key) cannot be opened. This is a cache, so start over rather than
  // leave the app without storage.
  const opened = db.open().catch(async (error: Error) => {
    if (!['VersionError', 'UpgradeError', 'SchemaError'].includes(error.name)) throw error
    console.warn(`[nuxt-airplane] Could not open "${options.dbName}" (${error.name}), recreating it. Bump the store version to migrate instead.`)
    await db.delete()
    await db.open()
  })

  // --------------------------------------------------------------------------
  // Cache key
  // --------------------------------------------------------------------------

  /** Deploy key from config plus the documents hash: either changing busts the cache. */
  const cacheKey = `${options.cacheKey ?? ''}:${options.documentsHash}`

  /** Empties cached data (query rows and your stores) but keeps the outbox. */
  async function clearCache() {
    const tables = db.tables.filter(t => !BOOKKEEPING_TABLES.has(t.name))
    await db.transaction('rw', tables, async () => {
      for (const table of tables) await table.clear()
    })
  }

  /**
   * Resolves once the cache is known to belong to the current key. Writes
   * wait for it so a response stored by an old deploy's key is never mixed
   * with data stored under the new one.
   */
  const ready = opened.then(async () => {
    const stored = (await db.meta.get('cacheKey'))?.value
    if (stored !== undefined && stored !== cacheKey) {
      if (import.meta.dev) console.info(`[nuxt-airplane] Cache key changed, clearing cached data (outbox kept).`)
      await clearCache()
    }
    if (stored !== cacheKey) await db.meta.put({ key: 'cacheKey', value: cacheKey })
    // A tab closed mid-sync leaves rows marked `syncing`; they were never
    // confirmed, so they go back in the queue. (Sends are idempotent from the
    // outbox's point of view only if the API is; see the docs on retries.)
    await db.mutations.where('status').equals('syncing').modify({ status: 'pending' })
  })

  const state = reactive({
    /** What the browser reports; assumed online where `navigator.onLine` does not exist (Node, some webviews). */
    networkOnline: typeof navigator === 'object' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true,
    /** Set by `goOffline()`: behave as offline whatever the network says. */
    forcedOffline: false,
    /** Effective state the client acts on. */
    get online(): boolean {
      return this.networkOnline && !this.forcedOffline
    },
    syncing: false,
    /** Mutations still waiting to be sent, oldest first. */
    pending: [] as MutationRow[],
    /** Size of the batch the current (or last) sync started with. */
    syncTotal: 0,
    /** Mutations of that batch that have reached the server so far. */
    syncCount: 0,
    /** Current pending list could not be sent because of a network error */
    lastError: null as string | null,
    /** Paginated queries currently being walked to the end by `prefetch`. */
    prefetching: 0,
  })

  const synced = computed(() => !state.syncing && state.pending.length === 0)

  // Keep the pending list live from the outbox table.
  liveQuery(() => db.mutations.orderBy('createdAt').toArray())
    .subscribe({ next: rows => (state.pending = rows) })

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      state.networkOnline = true
      void sync()
    })
    window.addEventListener('offline', () => (state.networkOnline = false))
  }

  /**
   * Hold the client offline regardless of the network: queries stop fetching
   * and mutations stay queued until `goOnline()`.
   */
  function goOffline() {
    state.forcedOffline = true
  }

  /** Release the hold from `goOffline()` and sync the queue if the network is up. */
  function goOnline() {
    state.forcedOffline = false
    void sync()
  }

  // --------------------------------------------------------------------------
  // Network
  // --------------------------------------------------------------------------

  function document(name: string) {
    const doc = documents[name]
    if (!doc) throw new Error(`[nuxt-airplane] Unknown GraphQL document "${name}"`)
    return doc
  }

  /** Static headers from config, then the per-request ones from `defineAirplaneRequest`. */
  async function requestHeaders(ctx: AirplaneRequestContext) {
    const headers = new Headers({ 'content-type': 'application/json', ...options.headers })
    const { headers: dynamic } = options.request
    const extra = typeof dynamic === 'function'
      ? await (options.runWithContext ? options.runWithContext(() => dynamic(ctx)) : dynamic(ctx))
      : dynamic
    new Headers(extra ?? undefined).forEach((value, key) => headers.set(key, value))
    return headers
  }

  async function request<T>(name: string, variables: unknown): Promise<T> {
    const doc = document(name)
    const ctx: AirplaneRequestContext = { document: name, kind: doc.kind, variables }
    const doFetch = options.request.fetch ?? globalThis.fetch
    const res = await doFetch(options.endpoint, {
      method: 'POST',
      headers: await requestHeaders(ctx),
      credentials: options.request.credentials,
      body: JSON.stringify({ query: doc.source, variables: variables ?? undefined }),
      signal: AbortSignal.timeout(options.request.timeout ?? 30_000),
    })
    await options.request.onResponse?.(res, ctx)
    const body = await res.json().catch(() => ({})) as GraphQLResponse<T>
    if (body.errors?.length) throw new GraphQLRequestError(body.errors)
    if (!res.ok) throw new Error(`[nuxt-airplane] ${res.status} ${res.statusText}`)
    // A 200 without `data` (proxy page, empty body) must not end up in the cache.
    if (body.data == null) throw new Error('[nuxt-airplane] Response has no data')
    return body.data as T
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  function queryHandler(name: string): QueryHandler | undefined {
    return (queryHandlers as Record<string, QueryHandler | undefined>)[name]
  }

  /** Refresh callbacks of the queries currently mounted somewhere. */
  const active = new Map<string, () => Promise<void>>()

  /**
   * Fetches a query and stores the response: through the `store` handler when
   * there is one, as a cached blob otherwise. Pending mutations are then
   * re-applied so the fresh server state does not wipe local changes.
   */
  /** Writes one response through the `store` handler (or as a blob) plus its metadata row. */
  async function storeResponse(name: string, variables: unknown, data: unknown) {
    const h = queryHandler(name)
    const row = { key: queryKey(name, variables), document: name, variables, updatedAt: Date.now() }
    await db.transaction('rw', db.tables, async () => {
      await h?.store?.({ db, variables: variables as never }, data as never)
      // With a `read` handler the row only carries metadata.
      await db.queries.put({ ...row, data: h?.read ? null : data })
    })
  }

  async function fetchQuery<T>(name: string, variables: unknown): Promise<T> {
    await ready
    const data = await request<T>(name, variables)
    await storeResponse(name, variables, data)
    await rebasePending()
    if (queryHandler(name)?.prefetch) void prefetch(name, variables, data)
    return data
  }

  /** Documents whose remaining pages are being fetched right now. */
  const prefetching = new Set<string>()

  /**
   * Follows `prefetch.next` from the page just fetched until it returns
   * nothing, storing every page so the whole set is available offline.
   */
  async function prefetch(name: string, variables: unknown, data: unknown) {
    const p = queryHandler(name)?.prefetch
    if (!p || prefetching.has(name) || (p.when && !p.when())) return
    prefetching.add(name)
    state.prefetching++
    let pages = 0
    try {
      let vars = variables
      let page = data
      while (state.online && pages < (p.maxPages ?? 1000)) {
        const next = p.next(page as never, vars as never)
        if (!next) break
        vars = next
        page = await request(name, vars)
        await storeResponse(name, vars, page)
        pages++
      }
    }
    catch (error) {
      if (import.meta.dev) console.warn(`[nuxt-airplane] Prefetch of "${name}" stopped:`, error)
    }
    finally {
      prefetching.delete(name)
      state.prefetching--
    }
    if (pages) await rebasePending()
  }

  function watchQuery(name: string, variables: unknown) {
    const snapshot = shallowRef<QuerySnapshot>({ data: null, updatedAt: null, cached: false })
    const h = queryHandler(name)
    const key = queryKey(name, variables)
    const subscription = liveQuery(async (): Promise<QuerySnapshot> => {
      const row = await db.queries.get(key)
      const data = h?.read ? await h.read({ db, variables: variables as never }) : row?.data
      // With `read`, the tables hold data as soon as any variant of this
      // document has been fetched, so a new filter is not "loading" offline.
      const cached = h?.read
        ? !!row || (await db.queries.where('document').equals(name).count()) > 0
        : !!row
      return { data: data ?? null, updatedAt: row?.updatedAt ?? null, cached }
    }).subscribe({ next: s => (snapshot.value = s) })
    return { snapshot: readonly(snapshot), unsubscribe: () => subscription.unsubscribe() }
  }

  async function refetchActive(only?: Iterable<QueryName>) {
    const names = only && [...only]
    await Promise.allSettled(
      [...active.entries()]
        .filter(([key]) => !names || names.some(name => key.startsWith(`${name}:`)))
        .map(([, refresh]) => refresh()),
    )
  }

  // --------------------------------------------------------------------------
  // Cache API handed to mutation handlers
  // --------------------------------------------------------------------------

  /**
   * Helpers over the blob cache. Writes are recorded by the undo log like any
   * other, so nothing needs tracking here. `invalidate` only collects names:
   * refetching from inside the transaction would commit it early.
   */
  function createCacheApi(invalidated?: Set<QueryName>): CacheApi {
    async function updateRows(name: string, filter: (key: string) => boolean, updater: Updater<unknown>) {
      const rows = (await db.queries.where('document').equals(name).toArray()).filter(r => filter(r.key))
      const next = rows
        .filter(row => row.data !== null && row.data !== undefined)
        .map((row) => {
          const data = structuredClone(row.data)
          const returned = updater(data, row.variables)
          return { ...row, data: returned === undefined ? data : returned }
        })
      await db.queries.bulkPut(next)
    }

    return {
      async update(name: string, variablesOrUpdater: unknown, maybeUpdater?: Updater<unknown>) {
        if (typeof variablesOrUpdater === 'function') {
          await updateRows(name, () => true, variablesOrUpdater as Updater<unknown>)
        }
        else {
          const key = queryKey(name, variablesOrUpdater)
          await updateRows(name, k => k === key, maybeUpdater!)
        }
      },
      async get(name: string, variables?: unknown) {
        const h = queryHandler(name)
        if (h?.read) return (await h.read({ db, variables: variables as never })) ?? undefined
        return (await db.queries.get(queryKey(name, variables)))?.data as never
      },
      async set(name: string, variables: unknown, data: unknown) {
        await db.queries.put({ key: queryKey(name, variables), document: name, variables, data, updatedAt: Date.now() })
      },
      async invalidate(name: string) {
        await db.queries.where('document').equals(name).delete()
        invalidated?.add(name as QueryName)
      },
    } as CacheApi
  }

  // --------------------------------------------------------------------------
  // Mutations / outbox
  // --------------------------------------------------------------------------

  function mutationHandler(name: string): MutationHandler | undefined {
    return (mutationHandlers as Record<string, MutationHandler | undefined>)[name]
  }

  /**
   * Runs `apply` for a queued mutation inside an undo-logged transaction and
   * stores the log on the row. `rebase` skips the refetches `invalidate`
   * asked for, since a rebase is itself the result of a fetch.
   */
  async function applyMutation(row: MutationRow, { rebase = false } = {}) {
    const h = mutationHandler(row.document)
    if (!h?.apply) return
    const invalidated = new Set<QueryName>()
    const { undo } = await withUndoLog(db, () =>
      h.apply!({ db, cache: createCacheApi(invalidated), variables: row.variables as never }))
    await db.mutations.update(row.id, { undo })
    if (!rebase && invalidated.size) await refetchActive(invalidated)
  }

  /**
   * Re-applies every queued mutation on top of freshly stored server data.
   * In-flight (`syncing`) ones are included: the response being stored may
   * predate them, and their effect must stay visible until the server
   * confirms and the next refetch lands.
   */
  async function rebasePending() {
    const queue = await db.mutations.orderBy('createdAt').toArray()
    for (const row of queue) await applyMutation(row, { rebase: true })
  }

  async function describeMutation(name: string, variables: unknown) {
    const { describe } = mutationHandler(name) ?? {}
    if (typeof describe === 'string') return describe
    if (describe) return describe({ db, cache: createCacheApi(), variables: variables as never })
    return humanize(name)
  }

  async function enqueue(name: string, variables: unknown) {
    if (document(name).kind !== 'mutation') throw new Error(`[nuxt-airplane] "${name}" is not a mutation`)
    await ready
    const description = await describeMutation(name, variables)
    const id = await db.mutations.add({ document: name, variables, description, status: 'pending', createdAt: Date.now() } as MutationRow)
    const row = (await db.mutations.get(id))!
    try {
      await applyMutation(row)
    }
    catch (error) {
      await db.mutations.delete(id)
      throw error
    }
    void sync()
    return row
  }

  /** Undo a queued mutation and drop it from the outbox. */
  async function rollback(id: number) {
    const row = await db.mutations.get(id)
    if (!row || row.status === 'syncing') return
    const h = mutationHandler(row.document)

    if (h?.revert) {
      await h.revert({ db, cache: createCacheApi(), variables: row.variables as never })
      await db.mutations.delete(id)
      return
    }

    // Undo this mutation's writes, then replay the mutations queued after it
    // so their changes land on the restored data.
    const later = (await db.mutations.where('createdAt').above(row.createdAt).toArray())
      .filter(m => m.status !== 'syncing')
    if (row.undo) await applyUndo(db, row.undo)
    await db.mutations.delete(id)
    for (const m of later) await applyMutation(m, { rebase: true })
  }

  async function retry(id: number) {
    await db.mutations.update(id, { status: 'pending', error: undefined })
    await sync()
  }

  let syncPromise: Promise<void> | null = null

  /** Send every pending mutation, oldest first. Stops at the first network failure. */
  function sync() {
    if (syncPromise) return syncPromise
    syncPromise = runSync().finally(() => (syncPromise = null))
    return syncPromise
  }

  async function runSync() {
    await ready
    if (!state.online) return
    const queue = await db.mutations.where('status').equals('pending').sortBy('createdAt')
    if (!queue.length) return

    state.syncing = true
    state.syncTotal = queue.length
    state.syncCount = 0
    state.lastError = null
    const refetch = new Set<QueryName>()
    let refetchAll = false

    try {
      for (const row of queue) {
        await db.mutations.update(row.id, { status: 'syncing' })
        try {
          const result = await request(row.document, row.variables)
          const h = mutationHandler(row.document)
          await h?.reconcile?.({ db, cache: createCacheApi(), variables: row.variables as never }, result as never)
          if (h?.refetch) h.refetch.forEach(n => refetch.add(n))
          else refetchAll = true
          await db.mutations.delete(row.id)
          state.syncCount++
        }
        catch (error) {
          if (error instanceof GraphQLRequestError) {
            // The server rejected it: park it so the user can retry or roll it back.
            await db.mutations.update(row.id, { status: 'failed', error: error.message })
            continue
          }
          // Network trouble: leave the rest queued for the next attempt.
          await db.mutations.update(row.id, { status: 'pending' })
          state.lastError = error instanceof Error ? error.message : String(error)
          break
        }
      }
    }
    finally {
      state.syncing = false
    }
    if (state.syncCount) await refetchActive(refetchAll ? undefined : refetch)
  }

  /** Empties every table, including the outbox. */
  async function clear() {
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) await table.clear()
    })
    await db.meta.put({ key: 'cacheKey', value: cacheKey })
  }

  // Attempt to drain anything left over from a previous session.
  void sync()

  return {
    db,
    state,
    synced,
    documents,
    active,
    fetchQuery,
    prefetch,
    watchQuery,
    refetchActive,
    enqueue,
    rollback,
    retry,
    sync,
    goOffline,
    goOnline,
    cacheKey,
    ready,
    clear,
    clearCache,
  }
}
