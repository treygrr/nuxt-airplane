// The client: the network, the sync loop and what the components observe.
//
// It reads the tables and decides what to send and when. Every write to the
// tables is the engine's (`engine.ts`), called directly or, when the engine
// runs in a web worker, with a message.

import { Dexie, liveQuery } from 'dexie'
import { reactive, computed, shallowRef, readonly } from 'vue'
import { isQuotaError } from './db'
import { cacheKeyOf, createEngine, openDatabase, type AirplaneEngineOptions } from './engine'
import { UnresolvedTempIdError, heldBack, queryKey, queryRead, queuedRows, readQueryTableMap, readTempIdMap, requeueStuckRows, resultAccessor, sameRow, splitVariables, substituteTempIds, uuid, withDependents } from './helpers'
import { createRequester } from './request'
import {
  GraphQLRequestError,
  type AirplaneEngine,
  type MutationHandler,
  type MutationRow,
  type AirplaneRequestOptions,
  type AirplaneRuntimeConfig,
  type Locals,
  type QueryHandler,
  type QueryName,
} from './types'

export interface AirplaneClientOptions extends AirplaneRuntimeConfig, AirplaneEngineOptions {
  request: AirplaneRequestOptions
  /** Runs a function inside the Nuxt app context (so composables work in `headers`). */
  runWithContext?: <T>(fn: () => T) => T | Promise<Awaited<T>>
  /** The engine running in a web worker. The client then leaves every write to the tables to it. */
  remote?: AirplaneEngine
  /**
   * `false` holds every sync back until `start()` is called. The module's
   * plugin starts it once the first page has hydrated, so a plugin of the app that
   * decides to go offline, even after awaiting something, always does so
   * before anything is sent. Default `true`: syncs from the start.
   */
  autoStart?: boolean
  /** Where the "work offline" choice is kept. Default `localStorage`, where there is one. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
}

/** The key the "work offline" choice is kept under, per database. */
export const offlineKey = (dbName: string) => `nuxt-airplane:offline:${dbName}`

// The pure pieces live in `helpers`; they are part of what this module offers.
export * from './helpers'
export { parseRetryAfter } from './request'

/** What `useAirplaneQuery` observes: the live result of `read` plus the fetch record. */
export interface QuerySnapshot {
  data: unknown
  updatedAt: number | null
  /** A response for this query (any variables) has been stored at some point. */
  cached: boolean
}

/** An error answer that is about the session or the server, not about the mutation it came back for. */
export function retryLaterByDefault(error: GraphQLRequestError) {
  return error.status === 401 || error.status === 429 || error.status >= 500
    || error.errors.some(e => ['UNAUTHENTICATED', 'TOO_MANY_REQUESTS', 'RATE_LIMITED'].includes(String(e.extensions?.code)))
}

/** First wait after a sync that could not get through, doubled each time up to the cap. */
const BACKOFF_BASE = 1000
const BACKOFF_MAX = 5 * 60_000
/** A server may ask for longer than the cap, but not for ever. */
const RETRY_AFTER_MAX = 60 * 60_000

/** How long to wait before attempt number `failures` + 1: exponential, with jitter so clients do not return together. */
export function backoffDelay(failures: number, retryAfter?: number, random = Math.random()) {
  if (retryAfter !== undefined) return Math.min(retryAfter, RETRY_AFTER_MAX)
  return Math.min(BACKOFF_MAX, BACKOFF_BASE * 2 ** failures) * (0.5 + random / 2)
}

/** Mutations in flight at once, unless `concurrency` says otherwise. */
const SYNC_LANES = 4
/** Share of the browser's allowance in use above which the oldest cached rows are dropped. */
const STORAGE_HIGH_WATER = 0.9
/** At most one look at the allowance per this many milliseconds. */
const STORAGE_CHECK_EVERY = 30_000

export type AirplaneClient = ReturnType<typeof createAirplaneClient>

export function createAirplaneClient(options: AirplaneClientOptions) {
  const entities = options.entities ?? {}
  const { db, opened } = openDatabase(options)
  const { documents, mutationHandlers, queryHandlers } = options

  /** Everything that writes to the tables: here, or in the worker. */
  const engine = createEngine(options, { db, opened })
  const write = options.remote ?? engine

  /** Deploy key from config plus the documents hash: either changing busts the cache. */
  const cacheKey = cacheKeyOf(options)

  /**
   * Resolves once the cache is known to belong to the current key. Writes
   * wait for it so a response stored by an old deploy's key is never mixed
   * with data stored under the new one.
   */
  const ready = opened.then(() => write.ready())

  const queued = () => queuedRows(db)
  const readTempIds = () => readTempIdMap(db)
  const readQueryTables = () => readQueryTableMap(db)
  const requeueStuck = () => requeueStuckRows(db)

  // --------------------------------------------------------------------------
  // "Work offline"
  //
  // The choice made with `goOffline()` / `goOnline()` is kept, per database,
  // so it survives a reload and holds in every tab: the tabs share the
  // outbox, so one that went online would send what another holds back. It
  // is read synchronously, before anything could be sent. Until a choice is
  // made, `startOffline` says.
  // --------------------------------------------------------------------------

  const storage = options.storage !== undefined ? options.storage : browserStorage()
  const OFFLINE_KEY = offlineKey(options.dbName)
  /** The kept choice, or `startOffline` when there is none (or nowhere to keep one). */
  function keptOffline(value = readKept()) {
    return value === null ? !!options.startOffline : value === '1'
  }
  function readKept(): string | null {
    try {
      return storage?.getItem(OFFLINE_KEY) ?? null
    }
    catch {
      return null
    }
  }
  function keepOffline(offline: boolean) {
    try {
      storage?.setItem(OFFLINE_KEY, offline ? '1' : '0')
    }
    catch {
      // Private mode, a full or blocked storage: the choice holds for this page only.
    }
  }

  const state = reactive({
    /** What the browser reports; assumed online where `navigator.onLine` does not exist (Node, some webviews). */
    networkOnline: typeof navigator === 'object' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true,
    /** Set by `goOffline()`: behave as offline whatever the network says. Kept across reloads and tabs. */
    forcedOffline: keptOffline(),
    /** Effective state the client acts on. */
    get online(): boolean {
      return this.networkOnline && !this.forcedOffline
    },
    syncing: false,
    /** Mutations still waiting to be sent, oldest first. */
    pending: [] as MutationRow[],
    /** Pending mutations held back because one they depend on failed. */
    get blocked(): number {
      const held = heldBack(this.pending)
      return this.pending.filter(m => m.status === 'pending' && held.has(m.id)).length
    },
    /** Size of the batch the current (or last) sync started with. */
    syncTotal: 0,
    /** Mutations of that batch that have reached the server so far. */
    syncCount: 0,
    /** Current pending list could not be sent because of a network error */
    lastError: null as string | null,
    /** When the next attempt is due after a sync that could not get through, as a timestamp. */
    retryAt: null as number | null,
    /** Paginated queries currently being walked to the end by `prefetch`. */
    prefetching: 0,
    /** Syncs are let through: from the start, or once `start()` was called (the first page has hydrated). */
    started: options.autoStart !== false,
  })

  const synced = computed(() => !state.syncing && state.pending.length === 0)
  /** The mutations the server refused, oldest first, out of the pending list. */
  const failed = computed(() => state.pending.filter(row => row.status === 'failed'))

  // Keep the pending list live from the outbox table. It is the whole queue,
  // so reading it costs more the longer the queue is, and a read holds up the
  // next write. After each read the list rests ten times as long as the read
  // took: a short queue shows every change at once, and a long one being
  // filled or drained spends a tenth of its time on the list, not all of it.
  /** The longest the list goes unread while the outbox changes, however long the queue. */
  const LIST_REST_MAX = 2000
  let listed = 0
  let rest = 0
  let listing = false
  /** The outbox changed while the list was being read. */
  let stale = false
  let listLater: ReturnType<typeof setTimeout> | undefined
  async function list() {
    if (listing) {
      stale = true
      return
    }
    const wait = listed + rest - Date.now()
    if (wait > 0) {
      listLater ??= setTimeout(() => {
        listLater = undefined
        void list()
      }, wait)
      // Never the reason a process stays alive (Node, tests).
      ;(listLater as { unref?: () => void }).unref?.()
      return
    }
    listing = true
    let started = Date.now()
    try {
      // The read is what is timed, not the database opening before the first one.
      await opened
      started = Date.now()
      state.pending = await queued()
    }
    catch {
      // A database closed under it (sign-out, a test) ends the list; nothing to report.
    }
    listed = Date.now()
    rest = Math.min((listed - started) * 10, LIST_REST_MAX)
    listing = false
    if (stale) {
      stale = false
      void list()
    }
  }
  // Every write to the outbox, from this tab, its worker or another tab.
  const outbox = `idb://${db.name}/mutations/`
  Dexie.on('storagemutated', (parts) => {
    if (Object.keys(parts).some(part => part.startsWith(outbox))) void list()
  })
  void list()

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      state.networkOnline = true
      void sync()
    })
    window.addEventListener('offline', () => (state.networkOnline = false))
    // Another tab went offline or back online.
    window.addEventListener('storage', (event) => {
      if (event.key !== OFFLINE_KEY && event.key !== null) return
      const offline = keptOffline(event.key === null ? null : event.newValue)
      if (offline === state.forcedOffline) return
      state.forcedOffline = offline
      if (!offline) void sync()
    })
  }

  /**
   * Hold the client offline regardless of the network: queries stop fetching
   * and mutations stay queued until `goOnline()`. Kept: it holds after a
   * reload and in every tab of the app, until `goOnline()`.
   */
  function goOffline() {
    state.forcedOffline = true
    keepOffline(true)
  }

  /** Release the hold from `goOffline()`, in every tab, and sync the queue if the network is up. */
  function goOnline() {
    state.forcedOffline = false
    keepOffline(false)
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

  /** Sends one operation and resolves with its data; see `request.ts`. */
  const request = createRequester(options)

  // --------------------------------------------------------------------------
  // Queries
  //
  // The tables are the only store. A response goes through the query's
  // `store` handler, and its result comes from `read`, live, online or not. A
  // query with no `read` is served from the network and nothing is kept,
  // unless its handler says `store: 'result'`: the stored result is its read.
  // --------------------------------------------------------------------------

  function queryHandler(name: string): QueryHandler | undefined {
    return (queryHandlers as Record<string, QueryHandler | undefined>)[name]
  }

  /** Whether a query can be served from the tables: it has a `read` handler, or keeps its result whole. */
  function readable(name: string) {
    return !!queryRead(name, queryHandler(name))
  }

  /** What the `read` context carries as `result`. */
  const result = resultAccessor(db)

  if (import.meta.dev) {
    const idle = Object.entries(queryHandlers).filter(([, h]) => h?.local && Object.keys(h.local).length && !h.read).map(([name]) => `"${name}"`)
    if (idle.length) console.warn(`[nuxt-airplane] ${idle.join(', ')} declare local variables but no \`read\`: only \`read\` gets them, so they do nothing.`)
    for (const [name, h] of [...Object.entries(queryHandlers), ...Object.entries(mutationHandlers)]) {
      const clash = Object.keys(h?.local ?? {}).filter(key => documents[name]?.variables?.includes(key))
      if (clash.length) console.error(`[nuxt-airplane] The handler of "${name}" declares ${clash.map(k => `"${k}"`).join(', ')} as local, but the operation declares ${clash.length > 1 ? 'them' : 'it'} too. ${clash.length > 1 ? 'They are' : 'It is'} sent, and never local.`)
    }
  }

  /**
   * Sorts what a caller passed for a query into what is sent and what only
   * `read` gets, and says which fetch record it belongs to: the key is of
   * the sent variables alone, so a local one changes nothing on the network.
   */
  function splitQuery(name: string, input: unknown): { server: unknown, local: Locals, key: string } {
    const { server, local } = splitVariables(name, input, { declared: documents[name]?.variables, local: queryHandler(name)?.local })
    return { server, local, key: queryKey(name, server) }
  }

  /**
   * Refresh callbacks of the queries currently mounted somewhere, by query
   * key. Two mounted calls with the same key, the same variables or ones
   * that differ only in local variables, each have their own.
   */
  const active = new Map<string, Set<() => Promise<void>>>()

  /**
   * The mounted online queries (`useOnlineQuery`), apart: they show nothing
   * from the tables, so what a mutation changed says nothing about them.
   * They are refetched after a sync only when a mutation names them.
   */
  const activeOnline = new Map<string, Set<() => Promise<void>>>()

  /** Adds a mounted query's refresh under `key`; the returned function takes it away again. */
  function mount(key: string, refresh: () => Promise<void>, { online = false } = {}) {
    const map = online ? activeOnline : active
    const set = map.get(key) ?? new Set()
    set.add(refresh)
    map.set(key, set)
    return () => {
      set.delete(refresh)
      if (!set.size && map.get(key) === set) map.delete(key)
    }
  }

  // --------------------------------------------------------------------------
  // Room
  // --------------------------------------------------------------------------

  /**
   * Runs a write. If the browser refuses it for lack of room, the oldest
   * cached rows go and the write is tried once more.
   */
  async function withRoom<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    }
    catch (error) {
      if (!isQuotaError(error) || !await write.evict([...active.keys()])) throw error
      return fn()
    }
  }

  let storageChecked = 0

  /** Drops the oldest cached rows before the allowance is reached, so a write does not have to fail first. */
  async function keepRoom() {
    const storage = typeof navigator === 'object' ? navigator.storage : undefined
    if (!storage?.estimate || Date.now() - storageChecked < STORAGE_CHECK_EVERY) return
    storageChecked = Date.now()
    const { usage, quota } = await storage.estimate()
    if (usage && quota && usage / quota > STORAGE_HIGH_WATER) await write.evict([...active.keys()])
  }

  /** Stores a response through the engine, making room if it has to. */
  async function keep(name: string, variables: unknown, data: unknown) {
    await withRoom(() => write.storeResponse(name, variables, data))
    void keepRoom().catch(() => {})
  }

  /** Fetches under way, by query key, and how many mutations had been accepted when each started. */
  const inflight = new Map<string, { accepted: number, promise: Promise<unknown> }>()
  /** Mutations the server has accepted this session. A fetch started before the last one may be stale. */
  let accepted = 0

  /**
   * Fetches a query and stores the response. Callers asking for the same
   * query while it is on its way share the one request, unless a mutation
   * has been accepted since it left: then it may not show that change.
   */
  function fetchQuery<T>(name: string, input: unknown): Promise<T> {
    const { server: variables, key } = splitQuery(name, input)
    const current = inflight.get(key)
    if (current?.accepted === accepted) return current.promise as Promise<T>
    const entry = {
      accepted,
      promise: (async () => {
        await ready
        const data = await request<T>(name, variables)
        await keep(name, variables, data)
        if (queryHandler(name)?.prefetch) void prefetch(name, variables, data)
        return data
      })().finally(() => {
        if (inflight.get(key) === entry) inflight.delete(key)
      }),
    }
    inflight.set(key, entry)
    return entry.promise
  }

  /** Online requests under way, by query key, and how many mutations had been accepted when each started. */
  const asking = new Map<string, { accepted: number, promise: Promise<unknown> }>()

  /**
   * Sends a query and resolves with the server's data, and that is all:
   * nothing is stored, no fetch record is written, even when the query has
   * a handler. What `useOnlineQuery` runs on. Callers asking for the same
   * variables while it is on its way share the one request, unless a
   * mutation has been accepted since it left.
   */
  function ask<T>(name: string, variables: unknown): Promise<T> {
    const doc = documents[name]
    if (doc && doc.kind !== 'query') return Promise.reject(new Error(`[nuxt-airplane] "${name}" is not a query`))
    const key = queryKey(name, variables)
    const current = asking.get(key)
    if (current?.accepted === accepted) return current.promise as Promise<T>
    const entry = {
      accepted,
      promise: request<T>(name, variables).finally(() => {
        if (asking.get(key) === entry) asking.delete(key)
      }),
    }
    asking.set(key, entry)
    return entry.promise
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
        await keep(name, vars, page)
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
  }

  /** Queries already warned about for having no `read`. */
  const unreadable = new Set<string>()

  /**
   * Observes a query's result: `read` re-run whenever a table it touched
   * changes. A query without `read` has nothing to observe and the snapshot
   * stays empty; `useAirplaneQuery` shows it what the network returns.
   */
  function watchQuery(name: string, input: unknown) {
    const snapshot = shallowRef<QuerySnapshot>({ data: null, updatedAt: null, cached: false })
    const read = queryRead(name, queryHandler(name))
    if (!read) {
      if (import.meta.dev && !unreadable.has(name)) {
        unreadable.add(name)
        console.warn(`[nuxt-airplane] "${name}" has no query handler with \`read\` or \`store: 'result'\`: useAirplaneQuery serves it from the network only, with nothing to show offline. For a query that is only ever online, use useOnlineQuery.`)
      }
      return { snapshot: readonly(snapshot), unsubscribe: () => {} }
    }
    const { server: variables, local, key } = splitQuery(name, input)
    const subscription = liveQuery(async (): Promise<QuerySnapshot> => {
      const row = await db.queries.get(key)
      const returned = await read({ db, result, variables, local })
      // Under `nonOptionalTypename` the result types have the root's `__typename`; `read` need not write it.
      const root = documents[name]?.root
      const data = root && returned && typeof returned === 'object' && !('__typename' in returned) ? { ...returned, __typename: root } : returned
      // The tables hold data as soon as any variant of this document has been
      // fetched, so a new filter is not "loading" offline.
      const cached = !!row || (await db.queries.where('document').equals(name).count()) > 0
      return { data: data ?? null, updatedAt: row?.updatedAt ?? null, cached }
    }).subscribe({ next: s => (snapshot.value = s) })
    return { snapshot: readonly(snapshot), unsubscribe: () => subscription.unsubscribe() }
  }

  /**
   * Refetches mounted queries: all of them, or those named, or those that
   * fill one of `tables`. A query that has not shown which tables it fills
   * (never fetched, or nothing came back) is refetched to be safe.
   */
  async function refetchActive(only?: Iterable<QueryName>, tables?: Set<string>) {
    const names = only && [...only]
    const fills = tables?.size ? await readQueryTables() : {}
    const wanted = (key: string) => {
      if (!names) return true
      const name = key.slice(0, key.lastIndexOf(':'))
      if (names.includes(name as QueryName)) return true
      if (!tables?.size) return false
      const known = fills[name]
      return !known || known.some(table => tables.has(table))
    }
    // An online query is asked again only when a mutation names it.
    const named = (key: string) => !!names?.includes(key.slice(0, key.lastIndexOf(':')) as QueryName)
    await Promise.allSettled([
      ...[...active.entries()].filter(([key]) => wanted(key)),
      ...[...activeOnline.entries()].filter(([key]) => named(key)),
    ].flatMap(([, refreshes]) => [...refreshes].map(refresh => refresh())))
  }

  // --------------------------------------------------------------------------
  // Mutations / outbox
  // --------------------------------------------------------------------------

  function mutationHandler(name: string): MutationHandler | undefined {
    return (mutationHandlers as Record<string, MutationHandler | undefined>)[name]
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
   * Applies a mutation to the tables and queues it for the server. Resolves
   * with its outbox row, or with the row it was merged into.
   */
  async function enqueue(name: string, input: unknown) {
    const row = await withRoom(() => write.enqueue(name, input))
    void sync()
    return row
  }

  async function rollback(id: number): Promise<MutationRow[]> {
    const dropped = await write.rollback(id)
    // Nothing was waiting on it any more, but the network may be back.
    void sync()
    return dropped
  }

  /**
   * The queued mutations that depend on one, directly or not: what a rollback
   * of it may drop with it. Those that still do something without it stay.
   */
  function dependents(id: number): MutationRow[] {
    const chain = withDependents(state.pending, [id])
    return state.pending.filter(m => m.id !== id && chain.has(m.id))
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
  function sync(): Promise<void> {
    // Not started yet: the run waits for `start()`.
    if (!syncsStarted) return starting.then(sync)
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
   * The pending rows to send now, oldest first: every pending row that does
   * not depend, directly or through another row, on a failed one. The chain
   * below a failure waits until that row is retried or rolled back; the rest
   * of the queue is not held up by it.
   */
  async function sendable() {
    const rows = await queued()
    const held = heldBack(rows)
    return rows.filter(row => row.status === 'pending' && !held.has(row.id))
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

  let retryTimer: ReturnType<typeof setTimeout> | undefined
  /** Syncs in a row that could not get through. */
  let failures = 0

  function cancelRetry() {
    clearTimeout(retryTimer)
    retryTimer = undefined
    state.retryAt = null
  }

  /**
   * A sync that the network or the server stopped is tried again on its own,
   * later each time, or when the server said to (`Retry-After`).
   */
  function retryLater(retryAfter?: number) {
    const delay = backoffDelay(failures++, retryAfter)
    cancelRetry()
    state.retryAt = Date.now() + delay
    retryTimer = setTimeout(() => {
      retryTimer = undefined
      state.retryAt = null
      void sync().catch(() => {})
    }, delay)
    // Never the reason a process stays alive (Node, tests).
    ;(retryTimer as { unref?: () => void }).unref?.()
  }

  type Outcome = 'sent' | 'held' | 'stopped' | 'gone'

  /**
   * One run over the queue. Mutations that have nothing to do with each other
   * go out side by side, up to `concurrency` at once. One that is linked to
   * an earlier one, or changed a row an earlier one changed, waits for it. A
   * mutation without an `apply`, or whose `apply` changed nothing, could be
   * about anything: it waits for everything before it and everything after
   * waits for it.
   */
  async function runSync() {
    await ready
    if (!state.online) return
    const queue = await sendable()
    if (!queue.length) return

    cancelRetry()
    state.syncing = true
    state.syncTotal = queue.length
    state.syncCount = 0
    state.lastError = null
    const refetch = new Set<QueryName>()
    const tables = new Set<string>()
    let refetchAll = false
    /** A network failure, or an answer about the session: nothing more is started. */
    let stopped = false
    let retryAfter: number | undefined

    async function send(snapshot: MutationRow): Promise<Outcome> {
      // As it is now, not as the batch found it: a later edit may have been merged into it since. Gone if rolled back.
      const row = await db.transaction('rw', db.mutations, async () => {
        const current = await db.mutations.get(snapshot.id)
        if (current?.status !== 'pending') return
        await db.mutations.update(current.id, { status: 'syncing', attempts: (current.attempts ?? 0) + 1 })
        return current
      })
      if (!row) return 'gone'
      try {
        // An earlier row of this batch may have resolved a temp id this one
        // carries. Rewriting the row too keeps a later rebase on the real id.
        const variables = await outboundVariables(row.document, row.variables)
        if (variables !== row.variables) await db.mutations.update(row.id, { variables })
        const result = await request(row.document, variables, row.idempotencyKey)
        const h = mutationHandler(row.document)
        try {
          await write.reconcile(row.document, variables, row.tempIds ?? [], result, row.local)
        }
        catch (error) {
          // A handler bug, not a rejection: sending the mutation again would apply it twice on the server.
          state.lastError = error instanceof Error ? error.message : String(error)
          console.warn(`[nuxt-airplane] reconcile of "${row.document}" threw after the server accepted it:`, error)
        }
        if (h?.refetch) h.refetch.forEach(n => refetch.add(n))
        // What it changed says which queries to ask again. Without that, all of them.
        else if (row.keys?.length) row.keys.forEach(([table]) => tables.add(table))
        else refetchAll = true
        accepted++
        await write.acknowledge(row.id)
        state.syncCount++
        return 'sent'
      }
      catch (error) {
        // An answer about the session or the server, not this mutation: nothing
        // behind it would fare better, so stop here as for a network failure.
        const later = error instanceof GraphQLRequestError && (options.request.retryLater ?? retryLaterByDefault)(error)
        if (!later && (error instanceof GraphQLRequestError || error instanceof UnresolvedTempIdError)) {
          // The server rejected it: park it so the user can retry or roll it
          // back. Only the rows that depend on it wait; the batch goes on.
          await db.mutations.update(row.id, { status: 'failed', error: error.message })
          return 'held'
        }
        // Network trouble: leave the rest queued for the next attempt.
        stopped = true
        retryAfter ??= (error as { retryAfter?: number } | null)?.retryAfter
        // Back in the queue before the error shows: whoever reacts to it finds a mutation that can be rolled back.
        await db.mutations.update(row.id, { status: 'pending' }).catch(() => {})
        state.lastError = error instanceof Error ? error.message : String(error)
        return 'stopped'
      }
    }

    let free = Math.max(1, Math.floor(options.request.concurrency ?? SYNC_LANES))
    const waiting: (() => void)[] = []
    const lane = async () => {
      if (free > 0) free--
      else await new Promise<void>(resolve => waiting.push(resolve))
    }
    const leave = () => {
      const next = waiting.shift()
      if (next) next()
      else free++
    }

    const outcomes = new Map<number, Promise<Outcome>>()
    /** The last row of the batch to have changed each table row. */
    const lastOn = new Map<string, number>()
    /** The last row of the batch that could be about anything. */
    let barrier: number | undefined
    try {
      for (const row of queue) {
        const links = new Set([...(row.dependsOn ?? []), ...(row.after ?? [])])
        const earlier = new Set(links)
        if (!row.keys?.length) {
          for (const id of outcomes.keys()) earlier.add(id)
          barrier = row.id
        }
        else {
          if (barrier !== undefined) earlier.add(barrier)
          for (const key of row.keys) {
            const last = lastOn.get(sameRow(key))
            if (last !== undefined) earlier.add(last)
            lastOn.set(sameRow(key), row.id)
          }
        }
        const before = [...earlier].filter(id => outcomes.has(id)).map(async id => [id, await outcomes.get(id)!] as const)
        outcomes.set(row.id, (async (): Promise<Outcome> => {
          const done = await Promise.all(before)
          // Failed, or waiting on one that did: this one waits too. Rows it only shares with a failed one do not hold it.
          if (done.some(([id, outcome]) => outcome === 'held' && links.has(id))) return 'held'
          if (stopped || done.some(([, outcome]) => outcome === 'stopped')) return 'stopped'
          await lane()
          try {
            // Gone offline mid-batch: what is in flight lands, nothing more starts.
            return stopped || !state.online ? 'stopped' : await send(row)
          }
          catch (error) {
            // The database went away under it: nothing else will get through either.
            stopped = true
            state.lastError = error instanceof Error ? error.message : String(error)
            return 'stopped'
          }
          finally {
            leave()
          }
        })())
      }
      await Promise.all(outcomes.values())
    }
    finally {
      state.syncing = false
    }
    if (stopped) retryLater(retryAfter)
    else failures = 0
    if (state.syncCount) await refetchActive(refetchAll ? undefined : refetch, tables)
  }

  /**
   * Sends a mutation now, skipping the outbox and `apply`, and resolves with
   * the server's data. For mutations that cannot be queued: a checkout, a
   * form whose response the UI needs. The outbox is drained first so the
   * server sees everything queued before it; `reconcile` and `refetch` then
   * run as they would after a sync. Rejects while offline.
   */
  async function execute<T = unknown>(name: string, input: unknown): Promise<T> {
    const doc = document(name)
    if (doc.kind !== 'mutation') throw new Error(`[nuxt-airplane] "${name}" is not a mutation`)
    await ready
    if (!state.online) throw new Error(`[nuxt-airplane] Cannot send "${name}" while offline`)
    await sync()
    const { server, local } = splitVariables(name, input, { declared: doc.variables, local: mutationHandler(name)?.local })
    const outbound = await outboundVariables(name, server)
    const result = await request<T>(name, outbound, uuid())
    accepted++
    await write.reconcile(name, outbound, [], result, substituteTempIds(local, await readTempIds()).value)
    await refetchActive(mutationHandler(name)?.refetch)
    return result
  }

  /** Syncs are held until this is true; see `autoStart`. */
  let syncsStarted = options.autoStart !== false
  let begin!: () => void
  const starting = new Promise<void>(resolve => (begin = resolve))
  /** Lets syncs through, and drains what a previous session left. Called once the first page has hydrated. */
  function start() {
    if (syncsStarted) return
    syncsStarted = true
    state.started = true
    begin()
  }

  // Attempt to drain anything left over from a previous session.
  void sync()

  return {
    db,
    state,
    synced,
    failed,
    documents,
    entities,
    active,
    mount,
    splitQuery,
    fetchQuery,
    ask,
    prefetch,
    watchQuery,
    readable,
    refetchActive,
    enqueue,
    execute,
    rollback,
    dependents,
    retry,
    sync,
    goOffline,
    goOnline,
    start,
    cacheKey,
    ready,
    clear: () => write.clear(),
    clearCache: () => write.clearCache(),
    evict: () => write.evict([...active.keys()]),
    engine,
  }
}

/** The page's `localStorage`, if it has one it may use. */
function browserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'object' ? localStorage : null
  }
  catch {
    // Reading `localStorage` itself throws where storage is blocked.
    return null
  }
}
