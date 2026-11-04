import { liveQuery } from 'dexie'
import { hash } from 'ohash'
import { reactive, computed, shallowRef, readonly } from 'vue'
import { BOOKKEEPING_TABLES, applyUndo, createDb, withUndoLog } from './db'
import {
  GraphQLRequestError,
  type EntityInfo,
  type GraphQLResponse,
  type MutationHandlers,
  type MutationHandler,
  type MutationRow,
  type ReconcileContext,
  type AirplaneRequestContext,
  type AirplaneRequestOptions,
  type AirplaneRuntimeConfig,
  type AirplaneStores,
  type OperationDocument,
  type QueryHandler,
  type QueryHandlers,
  type QueryName,
} from './types'

export interface AirplaneClientOptions extends AirplaneRuntimeConfig {
  documents: Record<string, OperationDocument>
  /** Hash of the compiled documents, mixed into the cache key. */
  documentsHash: string
  /** Types the documents select with an id; each gets a table keyed on it. */
  entities?: Record<string, EntityInfo>
  mutationHandlers: MutationHandlers
  queryHandlers: QueryHandlers
  stores: AirplaneStores
  request: AirplaneRequestOptions
  /** Runs a function inside the Nuxt app context (so composables work in `headers`). */
  runWithContext?: <T>(fn: () => T) => T | Promise<Awaited<T>>
}

/** What `useQuery` observes: the live result of `read` plus the fetch record. */
export interface QuerySnapshot {
  data: unknown
  updatedAt: number | null
  /** A response for this query (any variables) has been stored at some point. */
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

// ---------------------------------------------------------------------------
// Temp ids
//
// A row created offline has no server id yet. `apply` mints a placeholder
// with `tempId()`; mutations queued after it carry that placeholder in their
// variables. Once the server has answered the create, `reconcile` maps the
// placeholder to the real id and the sync loop rewrites the queued variables
// before sending them.
// ---------------------------------------------------------------------------

const TEMP_ID_PREFIX = 'tmp-'
const TEMP_ID_RE = /^tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** A fresh placeholder id: `tmp-` plus a UUID. */
export function newTempId() {
  const uuid = typeof crypto === 'object' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
  return `${TEMP_ID_PREFIX}${uuid}`
}

/** Whether a value is an id minted by `tempId()`. */
export function isTempId(value: unknown): value is string {
  return typeof value === 'string' && TEMP_ID_RE.test(value)
}

/**
 * Replaces, anywhere in `value`, every string that is a key of `ids` with its
 * mapped id. Reports whether anything changed and which minted temp ids are
 * still in there with no mapping.
 */
export function substituteTempIds<T>(value: T, ids: Record<string, string>): { value: T, replaced: boolean, unresolved: string[] } {
  let replaced = false
  const unresolved = new Set<string>()
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v in ids) {
        replaced = true
        return ids[v]
      }
      if (isTempId(v)) unresolved.add(v)
      return v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {}
      for (const [k, item] of Object.entries(v)) out[k] = walk(item)
      return out
    }
    return v
  }
  const next = walk(value) as T
  return { value: replaced ? next : value, replaced, unresolved: [...unresolved] }
}

/** The APQ error a response carries, if any, by message or by extension code. */
function persistedQueryError(body: GraphQLResponse): 'PersistedQueryNotFound' | 'PersistedQueryNotSupported' | undefined {
  for (const error of body.errors ?? []) {
    const code = error.extensions?.code
    if (error.message === 'PersistedQueryNotFound' || code === 'PERSISTED_QUERY_NOT_FOUND') return 'PersistedQueryNotFound'
    if (error.message === 'PersistedQueryNotSupported' || code === 'PERSISTED_QUERY_NOT_SUPPORTED') return 'PersistedQueryNotSupported'
  }
}

/** A mutation about to be sent still carries a temp id the server never assigned. */
export class UnresolvedTempIdError extends Error {
  override name = 'UnresolvedTempIdError'
}

export type AirplaneClient = ReturnType<typeof createAirplaneClient>

/**
 * The tables to open: one per entity keyed on its id, plus the user's. A
 * user entry for an entity table lists extra indexes; the key is implied.
 */
export function mergeStores(entities: Record<string, EntityInfo>, user: Record<string, string>) {
  const stores: Record<string, string> = {}
  for (const [name, { key }] of Object.entries(entities)) stores[name] = `&${key}`
  for (const [name, spec] of Object.entries(user)) {
    const entity = entities[name]
    if (!entity) {
      stores[name] = spec
      continue
    }
    const extra = spec.split(',').map(s => s.trim()).filter(s => s && s.replace(/^[&+*]+/, '') !== entity.key)
    stores[name] = [`&${entity.key}`, ...extra].join(', ')
  }
  return stores
}

export function createAirplaneClient(options: AirplaneClientOptions) {
  const entities = options.entities ?? {}
  const db = createDb(options.dbName, mergeStores(entities, options.stores.stores), options.stores.version)
  const { documents, mutationHandlers, queryHandlers } = options
  /** A failed mutation holds back the ones queued after it (ordered delivery). */
  const stopOnFailure = options.stopOnFailure ?? true

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

  /** Empties the tables and the fetch records but keeps the outbox. */
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
    await requeueStuck()
  })

  /**
   * A tab closed mid-sync leaves rows marked `syncing`; they were never
   * confirmed, so they go back in the queue. (Sends are idempotent from the
   * outbox's point of view only if the API is; see the docs on retries.)
   */
  async function requeueStuck() {
    await db.mutations.where('status').equals('syncing').modify({ status: 'pending' })
  }

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
    /** Pending mutations held back because an older one failed; `0` with `stopOnFailure: false`. */
    get blocked(): number {
      if (!stopOnFailure) return 0
      const failed = this.pending.findIndex(m => m.status === 'failed')
      return failed < 0 ? 0 : this.pending.slice(failed + 1).filter(m => m.status === 'pending').length
    },
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

  async function post<T>(ctx: AirplaneRequestContext, payload: Record<string, unknown>) {
    const doFetch = options.request.fetch ?? globalThis.fetch
    const res = await doFetch(options.endpoint, {
      method: 'POST',
      headers: await requestHeaders(ctx),
      credentials: options.request.credentials,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.request.timeout ?? 30_000),
    })
    await options.request.onResponse?.(res, ctx)
    const body = await res.json().catch(() => ({})) as GraphQLResponse<T>
    return { res, body }
  }

  /**
   * With `persistedQueries: 'automatic'`, a server that answers
   * `PersistedQueryNotSupported` gets full documents for the rest of the
   * session instead of a wasted round trip per request.
   */
  let persistedUnsupported = false

  async function request<T>(name: string, variables: unknown): Promise<T> {
    const doc = document(name)
    const ctx: AirplaneRequestContext = { document: name, kind: doc.kind, variables }
    const mode = options.persistedQueries
    const extensions = mode && doc.hash && !persistedUnsupported
      ? { persistedQuery: { version: 1, sha256Hash: doc.hash } }
      : undefined

    let { res, body } = await post<T>(ctx, { variables: variables ?? undefined, extensions, query: extensions ? undefined : doc.source })
    if (extensions && mode === 'automatic') {
      const miss = persistedQueryError(body)
      if (miss === 'PersistedQueryNotSupported') persistedUnsupported = true
      // Not found: send the text along with the hash so the server registers
      // it. Not supported: send the text alone, and keep doing so.
      if (miss) ({ res, body } = await post<T>(ctx, { variables: variables ?? undefined, query: doc.source, extensions: miss === 'PersistedQueryNotFound' ? extensions : undefined }))
    }
    if (body.errors?.length) throw new GraphQLRequestError(body.errors)
    if (!res.ok) throw new Error(`[nuxt-airplane] ${res.status} ${res.statusText}`)
    // A 200 without `data` (proxy page, empty body) must not end up in the cache.
    if (body.data == null) throw new Error('[nuxt-airplane] Response has no data')
    return body.data as T
  }

  // --------------------------------------------------------------------------
  // Queries
  //
  // The tables are the only store. A response goes through the query's
  // `store` handler, and its result comes from `read`, live, online or not. A
  // query with no `read` is served from the network and nothing is kept.
  // --------------------------------------------------------------------------

  function queryHandler(name: string): QueryHandler | undefined {
    return (queryHandlers as Record<string, QueryHandler | undefined>)[name]
  }

  /** Whether a query can be served from the tables: it has a `read` handler. */
  function readable(name: string) {
    return !!queryHandler(name)?.read
  }

  if (import.meta.dev) {
    const unhandled = Object.values(documents).filter(d => d.kind === 'query' && !readable(d.name)).map(d => `"${d.name}"`)
    if (unhandled.length) console.warn(`[nuxt-airplane] No query handler with \`read\` for ${unhandled.join(', ')}: served from the network only, nothing to show offline.`)
  }

  /** Refresh callbacks of the queries currently mounted somewhere. */
  const active = new Map<string, () => Promise<void>>()

  /**
   * Writes a response through the `store` handler and records the fetch.
   * A query with neither `store` nor `read` leaves nothing behind.
   */
  async function storeResponse(name: string, variables: unknown, data: unknown) {
    const h = queryHandler(name)
    if (!h?.store && !h?.read) return
    await db.transaction('rw', db.tables, async () => {
      await h.store?.({ db, variables: variables as never }, data as never)
      await db.queries.put({ key: queryKey(name, variables), document: name, variables, updatedAt: Date.now() })
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

  /**
   * Observes a query's result: `read` re-run whenever a table it touched
   * changes. A query without `read` has nothing to observe and the snapshot
   * stays empty; `useQuery` shows it what the network returns.
   */
  function watchQuery(name: string, variables: unknown) {
    const snapshot = shallowRef<QuerySnapshot>({ data: null, updatedAt: null, cached: false })
    const read = queryHandler(name)?.read
    if (!read) return { snapshot: readonly(snapshot), unsubscribe: () => {} }
    const key = queryKey(name, variables)
    const subscription = liveQuery(async (): Promise<QuerySnapshot> => {
      const row = await db.queries.get(key)
      const data = await read({ db, variables: variables as never })
      // The tables hold data as soon as any variant of this document has been
      // fetched, so a new filter is not "loading" offline.
      const cached = !!row || (await db.queries.where('document').equals(name).count()) > 0
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
  // Mutations / outbox
  // --------------------------------------------------------------------------

  function mutationHandler(name: string): MutationHandler | undefined {
    return (mutationHandlers as Record<string, MutationHandler | undefined>)[name]
  }

  /**
   * Runs `apply` for a queued mutation inside an undo-logged transaction and
   * stores the log on the row.
   */
  async function applyMutation(row: MutationRow) {
    const h = mutationHandler(row.document)
    if (!h?.apply) return
    // Ids minted on the first apply are handed out again on a rebase, in the
    // same order, so a re-applied create keeps the id later mutations reference.
    const tempIds = [...(row.tempIds ?? [])]
    let minted = 0
    const tempId = () => (tempIds[minted] ??= newTempId(), tempIds[minted++]!)
    const { undo } = await withUndoLog(db, () =>
      h.apply!({ db, variables: row.variables as never, tempId }))
    await db.mutations.update(row.id, { undo, tempIds })
  }

  // --------------------------------------------------------------------------
  // Temp id map (meta table), see `substituteTempIds`
  // --------------------------------------------------------------------------

  const TEMP_IDS_KEY = 'tempIds'
  /**
   * Resolved ids are kept after the outbox drains: a component may still hold
   * a temp id it read before the create synced. The map is capped instead,
   * oldest first, which is far more than one outbox would ever carry.
   */
  const TEMP_IDS_MAX = 1000

  async function readTempIds(): Promise<Record<string, string>> {
    const raw = (await db.meta.get(TEMP_IDS_KEY))?.value
    return raw ? JSON.parse(raw) as Record<string, string> : {}
  }

  async function resolveTempId(tempId: string, id: string) {
    await moveRow(tempId, id)
    const entries = Object.entries(await readTempIds()).filter(([key]) => key !== tempId)
    entries.push([tempId, id])
    await db.meta.put({ key: TEMP_IDS_KEY, value: JSON.stringify(Object.fromEntries(entries.slice(-TEMP_IDS_MAX))) })
  }

  /**
   * Re-keys the row created under a placeholder, in whichever inferred table
   * holds it, so the row stays put once the server has named it. A copy of it
   * nested in another row is left to the next refetch.
   */
  async function moveRow(tempId: string, id: string) {
    const tables = Object.keys(entities)
    if (!tables.length) return
    await db.transaction('rw', tables, async () => {
      for (const table of tables) {
        const t = db.table(table)
        const row = await t.get(tempId) as Record<string, unknown> | undefined
        if (!row) continue
        await t.delete(tempId)
        await t.put({ ...row, [entities[table]!.key]: id })
      }
    })
  }

  /** The context `reconcile` runs with. */
  function reconcileContext(variables: unknown, tempIds: string[] = []): ReconcileContext<never> {
    return { db, variables: variables as never, tempIds, resolve: resolveTempId }
  }

  /**
   * The variables to send for a mutation: the queued ones with every resolved
   * temp id replaced by its server id. Throws when a minted temp id is still
   * unresolved, since the server would reject it anyway.
   */
  async function outboundVariables(name: string, variables: unknown) {
    const { value, unresolved } = substituteTempIds(variables, await readTempIds())
    if (unresolved.length) {
      throw new UnresolvedTempIdError(`[nuxt-airplane] "${name}" references the temp id "${unresolved[0]}" which has no server id yet: the mutation that created it has not been accepted, or its reconcile handler did not call resolve().`)
    }
    return value
  }

  /**
   * Re-applies every queued mutation on top of freshly stored server data.
   * In-flight (`syncing`) ones are included: the response being stored may
   * predate them, and their effect must stay visible until the server
   * confirms and the next refetch lands.
   */
  async function rebasePending() {
    const queue = await db.mutations.orderBy('createdAt').toArray()
    for (const row of queue) await applyMutation(row)
  }

  async function describeMutation(name: string, variables: unknown) {
    const { describe } = mutationHandler(name) ?? {}
    if (typeof describe === 'string') return describe
    if (describe) return describe({ db, variables: variables as never })
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
      await h.revert({ db, variables: row.variables as never })
      await db.mutations.delete(id)
    }
    else {
      // Undo this mutation's writes, then replay the mutations queued after it
      // so their changes land on the restored data. "After" is by id: two
      // mutations queued in the same millisecond share a createdAt.
      const later = (await db.mutations.where('id').above(row.id).toArray())
        .filter(m => m.status !== 'syncing')
      if (row.undo) await applyUndo(db, row.undo)
      await db.mutations.delete(id)
      for (const m of later) await applyMutation(m)
    }
    // Dropping a failed mutation releases the ones held back behind it.
    void sync()
  }

  async function retry(id: number) {
    await db.mutations.update(id, { status: 'pending', error: undefined })
    await sync()
  }

  let syncPromise: Promise<void> | null = null
  /** `sync()` was called while a run was in progress: run again when it ends. */
  let syncAgain = false

  /**
   * Send every pending mutation, oldest first. Stops at the first network
   * failure. One run at a time: a call made during a run (a mutation queued
   * mid-batch, the network coming back) does not join the batch already
   * snapshotted but is honoured by a second run right after it, and the
   * returned promise settles when the queue is drained or blocked.
   */
  function sync() {
    if (syncPromise) {
      syncAgain = true
      return syncPromise
    }
    syncPromise = (async () => {
      do {
        syncAgain = false
        await runSyncLocked()
      } while (syncAgain)
    })().finally(() => (syncPromise = null))
    return syncPromise
  }

  /**
   * The pending rows to send now, oldest first. With `stopOnFailure` the
   * queue ends at the oldest failed row: what was queued after it may depend
   * on it, so it waits until that row is retried or rolled back.
   */
  async function sendable() {
    const rows = await db.mutations.orderBy('createdAt').toArray()
    const queue: MutationRow[] = []
    for (const row of rows) {
      if (row.status === 'failed' && stopOnFailure) break
      if (row.status === 'pending') queue.push(row)
    }
    return queue
  }

  /**
   * Every tab of the app shares the outbox, so only one may drain it at a
   * time or a mutation is sent twice. A Web Lock named after the database
   * serializes the tabs: a tab that finds it taken waits its turn, then sends
   * whatever is still queued (usually nothing). The browser releases the lock
   * when its holder closes, so a tab that dies mid-batch hands over to the
   * next one, which re-queues the rows it left in `syncing`. Without the API
   * (Node, insecure contexts, old browsers) each tab syncs on its own.
   */
  const syncLock = `nuxt-airplane:sync:${options.dbName}`

  async function runSyncLocked() {
    const locks = typeof navigator === 'object' ? navigator.locks : undefined
    if (!locks) return runSync()
    await locks.request(syncLock, async () => {
      await ready
      // Holding the lock, no other tab is mid-batch: any `syncing` row is stale.
      await requeueStuck()
      await runSync()
    })
  }

  async function runSync() {
    await ready
    if (!state.online) return
    const queue = await sendable()
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
          // An earlier row of this batch may have resolved a temp id this one
          // carries. Rewriting the row too keeps a later rebase on the real id.
          const variables = await outboundVariables(row.document, row.variables)
          if (variables !== row.variables) await db.mutations.update(row.id, { variables })
          const result = await request(row.document, variables)
          const h = mutationHandler(row.document)
          await h?.reconcile?.(reconcileContext(variables, row.tempIds), result as never)
          if (h?.refetch) h.refetch.forEach(n => refetch.add(n))
          else refetchAll = true
          await db.mutations.delete(row.id)
          state.syncCount++
        }
        catch (error) {
          if (error instanceof GraphQLRequestError || error instanceof UnresolvedTempIdError) {
            // The server rejected it: park it so the user can retry or roll it back.
            await db.mutations.update(row.id, { status: 'failed', error: error.message })
            // The rest of the batch was queued after it, so it is held back too.
            if (stopOnFailure) break
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

  /**
   * Sends a mutation now, skipping the outbox and `apply`, and resolves with
   * the server's data. For mutations that cannot be queued: a checkout, a
   * form whose response the UI needs. The outbox is drained first so the
   * server sees everything queued before it; `reconcile` and `refetch` then
   * run as they would after a sync. Rejects while offline.
   */
  async function execute<T = unknown>(name: string, variables: unknown): Promise<T> {
    if (document(name).kind !== 'mutation') throw new Error(`[nuxt-airplane] "${name}" is not a mutation`)
    await ready
    if (!state.online) throw new Error(`[nuxt-airplane] Cannot send "${name}" while offline`)
    await sync()
    const outbound = await outboundVariables(name, variables)
    const result = await request<T>(name, outbound)
    const h = mutationHandler(name)
    await h?.reconcile?.(reconcileContext(outbound), result as never)
    await refetchActive(h?.refetch)
    return result
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
    entities,
    active,
    fetchQuery,
    prefetch,
    watchQuery,
    readable,
    refetchActive,
    enqueue,
    execute,
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
