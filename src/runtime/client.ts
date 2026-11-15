import { Dexie, liveQuery } from 'dexie'
import { hash } from 'ohash'
import { reactive, computed, shallowRef, readonly } from 'vue'
import { BOOKKEEPING_TABLES, MODULE_STORES, createDb, describeChanges, isQuotaError, putRow, quietly, record, rowKey, thingPath, track, type RowChange } from './db'
import type { IndexableType } from 'dexie'
import {
  GraphQLRequestError,
  type AirplaneEngine,
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
  /** The engine running in a web worker. The client then leaves every write to the tables to it. */
  remote?: AirplaneEngine
  /** `'engine'`: this is the worker's side. It writes when asked and neither sends nor syncs. */
  role?: 'engine'
  /** Names of inferred tables left out because nothing in the app mentions them. */
  unusedEntities?: string[]
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
// placeholder to the real id and every queued mutation that carries it is
// rewritten, in its variables and its undo log, to point at the real row.
//
// A placeholder is also a dependency: a mutation that carries one cannot
// succeed before the one that minted it has. So is anything a queued
// mutation created locally, a row or an element of a list inside one: a
// mutation whose `apply` touches it cannot succeed before it exists on the
// server. The outbox row records both (`dependsOn`) and the chain is the
// unit of failure: a rejected mutation holds back the rows below it and
// nothing else, and rolling one back drops the ones that have nothing left
// to do without it.
//
// Two mutations that wrote the same piece of the same thing (two renames of
// one site) are ordered too (`after`): the later one waits while the earlier
// one is failed, so the server never sees them the wrong way round. That is
// order only. Rolling the earlier one back leaves the later one queued.
// ---------------------------------------------------------------------------

const TEMP_ID_PREFIX = 'tmp-'
const TEMP_ID_RE = /^tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function uuid() {
  return typeof crypto === 'object' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
}

/** A fresh placeholder id: `tmp-` plus a UUID. */
export function newTempId() {
  return `${TEMP_ID_PREFIX}${uuid()}`
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
      if (Object.hasOwn(ids, v)) {
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

/**
 * `ids` plus every outbox row that depends on one of them, directly or
 * through another row. With `ordered`, rows that only have to come after one
 * count too. A link always points at an older row, so one pass in id order
 * finds the whole closure.
 */
export function withDependents(rows: MutationRow[], ids: Iterable<number>, ordered = false): Set<number> {
  const set = new Set(ids)
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (row.dependsOn?.some(id => set.has(id)) || (ordered && row.after?.some(id => set.has(id)))) set.add(row.id)
  }
  return set
}

/** The failed rows and every row that depends on one or has to come after one: what a sync leaves queued. */
export function heldBack(rows: MutationRow[]): Set<number> {
  return withDependents(rows, rows.filter(row => row.status === 'failed').map(row => row.id), true)
}

/** An error answer that is about the session or the server, not about the mutation it came back for. */
export function retryLaterByDefault(error: GraphQLRequestError) {
  return error.status === 401 || error.status === 429 || error.status >= 500
    || error.errors.some(e => ['UNAUTHENTICATED', 'TOO_MANY_REQUESTS', 'RATE_LIMITED'].includes(String(e.extensions?.code)))
}

/** The milliseconds a `Retry-After` header asks to wait: a number of seconds, or a date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const ms = /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined
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
  const isEngine = options.role === 'engine'

  // A table that was left out reads as `undefined` on `db`. Say why instead.
  for (const name of options.unusedEntities ?? []) {
    if (name in db) continue
    Object.defineProperty(db, name, {
      configurable: true,
      get() {
        throw new Error(`[nuxt-airplane] The table "${name}" was not created because nothing in the app mentions it. Use it as \`db.${name}\`, or list it in defineAirplaneStores({ ${name}: '' }) if it is only reached by a computed name.`)
      },
    })
  }

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

  /** Empties the tables and the fetch records but keeps the outbox, which is applied again on the empty tables. */
  async function clearCache() {
    const tables = db.tables.filter(t => !BOOKKEEPING_TABLES.has(t.name))
    await quietly(db, async () => {
      for (const table of tables) await table.clear()
      // The server versions went with the tables: every row is the queue's own now.
      await db.base.clear()
      await raise(await queued())
    })
  }

  /**
   * Resolves once the cache is known to belong to the current key. Writes
   * wait for it so a response stored by an old deploy's key is never mixed
   * with data stored under the new one.
   */
  const ready = opened.then(async () => {
    // With a worker, the cache is its to check and clear.
    if (options.remote) return options.remote.ready()
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
  })

  const synced = computed(() => !state.syncing && state.pending.length === 0)

  // Keep the pending list live from the outbox table.
  if (!isEngine) {
    liveQuery(() => db.mutations.orderBy('createdAt').toArray())
      .subscribe({ next: rows => (state.pending = rows) })
  }

  if (!isEngine && typeof window !== 'undefined') {
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

  async function request<T>(name: string, variables: unknown, idempotencyKey?: string): Promise<T> {
    const doc = document(name)
    const ctx: AirplaneRequestContext = { document: name, kind: doc.kind, variables, ...(idempotencyKey && { idempotencyKey }) }
    const mode = options.persistedQueries
    const persisted = mode && doc.hash && !persistedUnsupported
      ? { persistedQuery: { version: 1, sha256Hash: doc.hash } }
      : undefined
    // The same key on every attempt lets the server answer a retry without applying it twice.
    const extensions = (withPersisted: boolean) => {
      const out = { ...(withPersisted && persisted), ...(idempotencyKey && { idempotencyKey }) }
      return Object.keys(out).length ? out : undefined
    }

    let { res, body } = await post<T>(ctx, { variables: variables ?? undefined, extensions: extensions(true), query: persisted ? undefined : doc.source })
    if (persisted && mode === 'automatic') {
      const miss = persistedQueryError(body)
      if (miss === 'PersistedQueryNotSupported') persistedUnsupported = true
      // Not found: send the text along with the hash so the server registers
      // it. Not supported: send the text alone, and keep doing so.
      if (miss) ({ res, body } = await post<T>(ctx, { variables: variables ?? undefined, query: doc.source, extensions: extensions(miss === 'PersistedQueryNotFound') }))
    }
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
    if (body.errors?.length) throw new GraphQLRequestError(body.errors, res.status, retryAfter)
    if (!res.ok) throw Object.assign(new Error(`[nuxt-airplane] ${res.status} ${res.statusText}`), { retryAfter })
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

  if (import.meta.dev && !isEngine) {
    const unhandled = Object.values(documents).filter(d => d.kind === 'query' && !readable(d.name)).map(d => `"${d.name}"`)
    if (unhandled.length) console.warn(`[nuxt-airplane] No query handler with \`read\` for ${unhandled.join(', ')}: served from the network only, nothing to show offline.`)
  }

  /** Refresh callbacks of the queries currently mounted somewhere. */
  const active = new Map<string, () => Promise<void>>()

  /**
   * Writes a response through the `store` handler and records the fetch. A
   * query with neither `store` nor `read` leaves nothing behind.
   *
   * Server data belongs under the queue. Where the response carries a row a
   * queued mutation has changed, it becomes that row's server version and the
   * queue is put on again. The same happens while a queued mutation has
   * found nothing to change yet, since this response may bring its row. Any
   * other response, a page of a catalog nobody is editing, is written
   * straight through at no extra cost.
   */
  async function storeResponse(name: string, variables: unknown, data: unknown) {
    const h = queryHandler(name)
    if (!h?.store && !h?.read) return
    const key = queryKey(name, variables)
    const fetched = (rows?: [string, IndexableType][]) =>
      db.queries.put({ key, document: name, variables, updatedAt: Date.now(), ...(rows && { rows }) })
    if (!h.store) {
      await fetched()
      return
    }
    const store = () => h.store!({ db, variables: variables as never }, data as never)
    await quietly(db, async () => {
      // A queued mutation that found nothing to change may find its row in this response.
      let again = (await queued()).some(m => !m.keys?.length && mutationHandler(m.document)?.apply)
      const brought = track()
      // No row has a server version set aside: there is no second layer to keep apart.
      if (!await db.base.count()) await store()
      else {
        const { changes } = await record(db, store)
        for (const { table, key, after } of changes) {
          if (!await db.base.get([table, key])) continue
          await db.base.put(after === undefined ? { table, key, absent: 1 } : { table, key, row: after })
          again = true
        }
      }
      brought.stop()
      if (again) await rebuild()
      // The record keeps the rows of earlier fetches too, so one the server stopped returning can still be dropped.
      for (const row of (await db.queries.get(key))?.rows ?? []) {
        if (!brought.rows.has(sameRow(row))) brought.rows.set(sameRow(row), row)
      }
      const rows = [...brought.rows.values()]
      await learnTables(name, rows)
      await fetched(rows)
    })
  }

  // --------------------------------------------------------------------------
  // Which tables a query fills (meta table)
  //
  // Learned from what its `store` writes, and kept: after a sync, a query is
  // refetched when a mutation changed a table it fills.
  // --------------------------------------------------------------------------

  const QUERY_TABLES_KEY = 'queryTables'
  let knownTables: Record<string, string[]> | undefined

  async function readQueryTables(): Promise<Record<string, string[]>> {
    const raw = (await db.meta.get(QUERY_TABLES_KEY))?.value
    return raw ? JSON.parse(raw) as Record<string, string[]> : {}
  }

  async function learnTables(name: string, rows: [string, IndexableType][]) {
    knownTables ??= await readQueryTables()
    const known = knownTables[name] ?? []
    const added = [...new Set(rows.map(([table]) => table))].filter(table => !known.includes(table))
    if (!added.length) return
    knownTables = { ...knownTables, [name]: [...known, ...added] }
    await db.meta.put({ key: QUERY_TABLES_KEY, value: JSON.stringify(knownTables) })
  }

  // --------------------------------------------------------------------------
  // Room
  //
  // A cache that only grows meets the browser's allowance sooner or later.
  // Each fetch record lists the rows its `store` wrote, so the least recently
  // fetched can go, rows and record together, when room runs out. A row the
  // queue has changed, or that a record being kept lists too, stays.
  // --------------------------------------------------------------------------

  async function evict(keep: string[] = []): Promise<number> {
    return quietly(db, async () => {
      const kept = new Set(keep)
      const records = await db.queries.orderBy('updatedAt').toArray()
      const candidates = records.filter(r => !kept.has(r.key) && r.rows?.length)
      // The oldest quarter: enough to matter, not the whole cache at once.
      const out = candidates.slice(0, Math.ceil(candidates.length / 4))
      if (!out.length) return 0
      const going = new Set(out.map(r => r.key))
      const held = new Set<string>()
      for (const r of records) {
        if (!going.has(r.key)) r.rows?.forEach(row => held.add(sameRow(row)))
      }
      for (const m of await queued()) m.keys?.forEach(row => held.add(sameRow(row)))
      let dropped = 0
      for (const { rows } of out) {
        for (const row of rows!) {
          if (held.has(sameRow(row))) continue
          held.add(sameRow(row))
          await putRow(db, row[0], row[1], undefined)
          dropped++
        }
      }
      await db.queries.bulkDelete(out.map(r => r.key))
      if (import.meta.dev) console.info(`[nuxt-airplane] Storage is running low: dropped ${dropped} cached rows from the ${out.length} least recently fetched queries.`)
      return dropped
    })
  }

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
  function fetchQuery<T>(name: string, variables: unknown): Promise<T> {
    const key = queryKey(name, variables)
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
    await Promise.allSettled(
      [...active.entries()]
        .filter(([key]) => wanted(key))
        .map(([, refresh]) => refresh()),
    )
  }

  // --------------------------------------------------------------------------
  // Mutations / outbox
  // --------------------------------------------------------------------------

  function mutationHandler(name: string): MutationHandler | undefined {
    return (mutationHandlers as Record<string, MutationHandler | undefined>)[name]
  }

  /** The outbox, oldest first: the order mutations are applied and sent in. */
  function queued() {
    return db.mutations.orderBy('createdAt').toArray()
  }

  /**
   * Runs `apply` for a queued mutation on top of the tables. The first time
   * the queue changes a row, the row as it was goes to `base` as the server's
   * version. The outbox row gets the rows it changed and what it created and
   * wrote. Returns what it touched and wrote.
   */
  async function applyMutation(row: MutationRow, { tolerant = false } = {}): Promise<{ touched: Set<string>, wrote: Set<string> }> {
    const h = mutationHandler(row.document)
    if (!h?.apply) {
      if (row.keys?.length) await db.mutations.update(row.id, { keys: [], creates: [], writes: [] })
      return { touched: new Set(), wrote: new Set() }
    }
    // Ids minted on the first apply are handed out again each time, in the
    // same order, so a re-applied create keeps the id later mutations reference.
    const tempIds = [...(row.tempIds ?? [])]
    let minted = 0
    const tempId = () => (tempIds[minted] ??= newTempId(), tempIds[minted++]!)
    const { changes, error } = await record(db, () =>
      h.apply!({ db, variables: row.variables as never, tempId }), { tolerant })
    // Said once per mutation, not every time the queue is put back on.
    if (!error) skipped.delete(row.id)
    else if (!skipped.has(row.id)) {
      skipped.add(row.id)
      console.warn(`[nuxt-airplane] "${row.document}" could not be applied again on the current data, so its change is not shown locally until it syncs:`, error)
    }
    await keepBase(changes)
    const { created, touched, wrote } = describeChanges(changes)
    await db.mutations.update(row.id, { tempIds, keys: changes.map(c => [c.table, c.key]), creates: [...created], writes: [...wrote] })
    return { touched, wrote }
  }

  /** Queued mutations whose last re-apply threw. */
  const skipped = new Set<number>()

  /**
   * Applies a queued mutation again when the queue is put back on. A handler
   * that throws on what it now finds must not take the others down with it,
   * or keep a response from being stored: what it wrote is taken back, the
   * mutation stays queued with nothing applied, and the next time tries again.
   */
  function reapply(row: MutationRow) {
    return applyMutation(row, { tolerant: true })
  }

  // --------------------------------------------------------------------------
  // The two layers
  //
  // The tables show server data with the queue applied. `base` holds the
  // server's version of each row the queue changed. Taking the queue off is
  // putting those rows back; putting it on is applying it in order.
  // --------------------------------------------------------------------------

  /** Keeps the server's version of each row in `changes` that the queue had not changed before. */
  async function keepBase(changes: RowChange[]) {
    for (const { table, key, before } of changes) {
      if (await db.base.get([table, key])) continue
      await db.base.put(before === undefined ? { table, key, absent: 1 } : { table, key, row: before })
    }
  }

  /** Takes the queue off: every row it changed goes back to the server's version. */
  async function lower(keys?: [string, IndexableType][]) {
    const entries = keys ? (await db.base.bulkGet(keys)).filter(e => !!e) : await db.base.toArray()
    for (const entry of entries) await putRow(db, entry.table, entry.key, entry.absent ? undefined : entry.row)
    if (keys) await db.base.bulkDelete(keys)
    else await db.base.clear()
  }

  /** Puts mutations on, oldest first. */
  async function raise(rows: MutationRow[]) {
    for (const row of rows) await reapply(row)
  }

  /** Takes the whole queue off and puts it back on, with `between` run on server data alone. */
  function rebuild(between?: () => Promise<unknown>) {
    return quietly(db, async () => {
      await lower()
      await between?.()
      await raise(await queued())
    })
  }

  const sameRow = ([table, key]: [string, IndexableType]) => rowKey(table, key)

  /** Whether any of `rows` changed a row that `row` changed too. */
  function sharesRows(row: MutationRow, rows: MutationRow[]) {
    const mine = new Set(row.keys?.map(sameRow))
    return rows.some(m => m.keys?.some(k => mine.has(sameRow(k))))
  }

  /**
   * The server accepted a mutation: its change is server data now. Where no
   * other queued mutation changed the same rows, those rows as they stand are
   * the server's version, and their `base` entries simply go. Otherwise the
   * queue comes off, the accepted change is applied to the server data, and
   * the rest goes back on.
   */
  function acknowledge(id: number) {
    return quietly(db, async () => {
      const rows = await queued()
      const row = rows.find(m => m.id === id)
      if (!row) return
      const rest = rows.filter(m => m.id !== id)
      await db.mutations.delete(id)
      if (!sharesRows(row, rest)) {
        if (row.keys?.length) await db.base.bulkDelete(row.keys)
        return
      }
      await lower()
      const h = mutationHandler(row.document)
      const ids = [...(row.tempIds ?? [])]
      if (h?.apply) await record(db, () => h.apply!({ db, variables: row.variables as never, tempId: () => ids.shift() ?? newTempId() }), { tolerant: true })
      await raise(rest)
    })
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
    await quietly(db, async () => {
      // A create that reaches the server twice (a tab closed mid-sync) is
      // handed the id its first run resolved to. That is a real row now, not
      // a placeholder: pointing it at the duplicate would redirect later
      // mutations from one server row to another.
      if (tempId === id || Object.values(await readTempIds()).includes(tempId)) return
      await moveRow(tempId, id)
      await rewriteQueue(tempId, id)
      const entries = Object.entries(await readTempIds()).filter(([key]) => key !== tempId)
      entries.push([tempId, id])
      await db.meta.put({ key: TEMP_IDS_KEY, value: JSON.stringify(Object.fromEntries(entries.slice(-TEMP_IDS_MAX))) })
    })
  }

  /**
   * Points the queued mutations that carry a placeholder at the server's id
   * instead: in their variables, so applying them again targets the row
   * where `moveRow` put it; in the minted ids of the mutation that created
   * it, so applying the create again writes the same row; and in the rows
   * and things they are recorded as having changed, which moved with it.
   */
  async function rewriteQueue(tempId: string, id: string) {
    const ids = { [tempId]: id }
    await db.mutations.toCollection().modify((row: MutationRow) => {
      const { value, replaced } = substituteTempIds(row.variables, ids)
      if (replaced) row.variables = value
      if (row.tempIds?.includes(tempId)) row.tempIds = row.tempIds.map(t => (t === tempId ? id : t))
      if (row.keys) row.keys = row.keys.map(([table, key]) => [table, key === tempId ? id : key])
      if (row.creates) row.creates = row.creates.map(path => rekeyThing(path, tempId, id))
      if (row.writes) row.writes = row.writes.map(path => rekeyThing(path, tempId, id))
    })
  }

  /** A thing's path, moved with the row `moveRow` re-keyed. */
  function rekeyThing(path: string, tempId: string, id: string) {
    for (const table of db.tables) {
      const from = thingPath([table.name, tempId])
      if (path === from || path.startsWith(`${from}/`) || path.startsWith(`${from}#`)) return thingPath([table.name, String(id)]) + path.slice(from.length)
    }
    return path
  }

  /** A copy of `row` with its primary key, kept at `keyPath`, set to `id`. */
  function rekeyed<T extends object>(row: T, keyPath: string, id: string): T {
    const copy = Dexie.deepClone(row)
    Dexie.setByKeyPath(copy, keyPath, id)
    return copy
  }

  /**
   * Re-keys the row created under a placeholder, in whichever table holds
   * it, inferred or declared, and its entry in `base` with it, so the row
   * stays put once the server has named it. A copy of it nested in another
   * row, or a reference to it there, is left to the next refetch.
   */
  async function moveRow(tempId: string, id: string) {
    for (const table of db.tables.filter(t => !(t.name in MODULE_STORES))) {
      const { keyPath } = table.schema.primKey
      // A lone placeholder is never the whole of a compound key.
      if (Array.isArray(keyPath)) continue
      const row = await table.get(tempId)
      if (row !== undefined) {
        await table.delete(tempId)
        if (keyPath) await table.put(rekeyed(row, keyPath, id))
        else await table.put(row, id)
      }
      const entry = await db.base.get([table.name, tempId])
      if (!entry) continue
      await db.base.delete([table.name, tempId])
      await db.base.put({ ...entry, key: id, row: keyPath && entry.row ? rekeyed(entry.row as object, keyPath, id) : entry.row })
    }
  }

  /** The context `reconcile` runs with. */
  function reconcileContext(variables: unknown, tempIds: string[] = []): ReconcileContext<never> {
    return { db, variables: variables as never, tempIds, resolve: resolveTempId }
  }

  /**
   * What a new mutation is linked to in the queue. It depends on the rows
   * that minted a placeholder its variables carry, and on those that created
   * something its `apply` touched (a row, or an element of a list inside
   * one): the server has seen neither yet. And it comes after the rows that
   * wrote a piece it writes too. A placeholder already resolved is a real id
   * by the time the mutation is sent, so it links nothing.
   */
  async function linksOf(id: number, variables: unknown, { touched, wrote }: { touched: Set<string>, wrote: Set<string> }) {
    const { unresolved } = substituteTempIds(variables, await readTempIds())
    const earlier = (await queued()).filter(row => row.id !== id)
    const dependsOn = earlier
      .filter(row => row.tempIds?.some(t => unresolved.includes(t)) || row.creates?.some(c => touched.has(c)))
      .map(row => row.id)
    const after = earlier
      .filter(row => !dependsOn.includes(row.id) && row.writes?.some(w => wrote.has(w)))
      .map(row => row.id)
    return { dependsOn, after }
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

  async function describeMutation(name: string, variables: unknown) {
    const { describe } = mutationHandler(name) ?? {}
    if (typeof describe === 'string') return describe
    if (describe) return describe({ db, variables: variables as never })
    return humanize(name)
  }

  /**
   * The queued mutation a new one of the same document could be folded into,
   * newest first, and the variables of the two as one. Only a mutation that
   * has never been sent: the server may have seen one that was, and would
   * take a changed version of it for a retry.
   */
  async function mergeTarget(name: string, variables: unknown) {
    const merge = mutationHandler(name)?.merge as ((a: unknown, b: unknown) => unknown) | undefined
    if (!merge) return
    for (const row of (await queued()).reverse()) {
      if (row.document !== name || row.status !== 'pending' || row.attempts) continue
      const merged = merge(row.variables, variables)
      if (merged) return { id: row.id, variables: row.variables, merged, description: await describeMutation(name, merged) }
    }
  }

  const union = <T>(a: T[] = [], b: T[] = []) => [...new Set([...a, ...b])]

  /**
   * Folds the mutation just queued into `target`, if that still holds: the
   * target is as it was found, the new one minted nothing, and nothing
   * queued between the two has to do with the new one. Its effect is on the
   * tables already, so the target only takes over its variables and what it
   * changed. Resolves with the merged row, or nothing when the two stay apart.
   */
  async function mergeInto(target: NonNullable<Awaited<ReturnType<typeof mergeTarget>>>, row: MutationRow) {
    const rows = await queued()
    const into = rows.find(m => m.id === target.id)
    if (!into || into.status !== 'pending' || into.attempts || row.tempIds?.length || hash(into.variables) !== hash(target.variables)) return
    const between = rows.slice(rows.indexOf(into) + 1).filter(m => m.id !== row.id)
    const tied = (m: MutationRow) => !m.keys?.length || row.dependsOn?.includes(m.id) || row.after?.includes(m.id) || sharesRows(row, [m])
    if (between.some(tied)) return
    const others = (ids?: number[]) => ids?.filter(id => id !== into.id)
    await db.mutations.delete(row.id)
    await db.mutations.update(into.id, {
      variables: target.merged,
      description: target.description,
      keys: [...new Map([...(into.keys ?? []), ...(row.keys ?? [])].map(k => [sameRow(k), k])).values()],
      creates: union(into.creates, row.creates),
      writes: union(into.writes, row.writes),
      dependsOn: union(into.dependsOn, others(row.dependsOn)),
      after: union(into.after, others(row.after)),
    })
    return (await db.mutations.get(into.id))!
  }

  async function enqueueLocal(name: string, input: unknown) {
    if (document(name).kind !== 'mutation') throw new Error(`[nuxt-airplane] "${name}" is not a mutation`)
    await ready
    // A placeholder the server has already named is its real id from the start.
    const named = substituteTempIds(input, await readTempIds()).value
    const description = await describeMutation(name, named)
    const target = await mergeTarget(name, named)
    // One transaction: the mutation is queued with its effect applied and its
    // dependencies known, or not at all if `apply` throws, and no rebase can
    // find it half-queued.
    let queuedAs: number | undefined
    return db.transaction('rw', db.tables, async () => {
      const variables = substituteTempIds(named, await readTempIds()).value
      // The queue is ordered by this, so it must not step back with the clock.
      const createdAt = Math.max(Date.now(), (await db.mutations.orderBy('createdAt').last())?.createdAt ?? 0)
      const id = queuedAs = await db.mutations.add({ document: name, variables, description, status: 'pending', createdAt, idempotencyKey: uuid() } as MutationRow)
      const did = await applyMutation((await db.mutations.get(id))!)
      await db.mutations.update(id, await linksOf(id, variables, did))
      const row = (await db.mutations.get(id))!
      return (target && await mergeInto(target, row)) || row
    }).catch(async (error) => {
      // An abort removes the row. An `apply` that awaited something other
      // than a Dexie operation made the transaction commit instead, row
      // included: the caller is told it failed, so it must not be sent.
      if (queuedAs !== undefined) await db.mutations.delete(queuedAs)
      throw error
    })
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

  /**
   * Undo a queued mutation and drop it from the outbox. Where no later
   * mutation changed the same rows or is linked to it, its rows go back to
   * the server's version and that is all. Otherwise the queue comes off and
   * goes back on without it.
   *
   * A mutation that depended on a dropped one is dropped with it when it has
   * nothing left to do: it carries a placeholder that will now never resolve,
   * or applying it again changes nothing (a quantity set on an item that is
   * gone). One that still does something stays queued on its own, such as a
   * corrected save of the same row. Resolves with the mutations it dropped.
   */
  async function rollbackLocal(id: number): Promise<MutationRow[]> {
    const target = await db.mutations.get(id)
    if (!target || target.status === 'syncing') return []
    // The hook is for what `apply` did outside the database, so it runs outside the transaction.
    await mutationHandler(target.document)?.revert?.({ db, variables: target.variables as never })
    const dropped = await quietly(db, async () => {
      const rows = await queued()
      const row = rows.find(m => m.id === id)
      if (!row || row.status === 'syncing') return []
      const others = rows.filter(m => m.id !== id)
      await db.mutations.delete(id)
      const linked = others.some(m => m.dependsOn?.includes(id) || m.after?.includes(id))
      if (!linked && !sharesRows(row, others)) {
        if (row.keys?.length) await lower(row.keys)
        return [row]
      }
      await lower()
      const gone = [row]
      const lost = (ids?: number[]) => !!ids?.some(d => gone.some(m => m.id === d))
      for (const m of others) {
        const orphan = lost(m.dependsOn)
        const placeholders = gone.flatMap(d => d.tempIds ?? [])
        const stuck = orphan && substituteTempIds(m.variables, {}).unresolved.some(t => placeholders.includes(t))
        if (!stuck && ((await reapply(m)).touched.size || !orphan)) {
          if (orphan || lost(m.after)) {
            const left = (ids?: number[]) => ids?.filter(d => !gone.some(x => x.id === d))
            await db.mutations.update(m.id, { dependsOn: left(m.dependsOn), after: left(m.after) })
          }
          continue
        }
        await db.mutations.delete(m.id)
        gone.push(m)
      }
      return gone
    })
    return dropped
  }

  async function rollback(id: number): Promise<MutationRow[]> {
    const dropped = await write.rollback(id)
    // Nothing was waiting on it any more, but the network may be back.
    void sync()
    return dropped
  }

  /** Runs a mutation's `reconcile` with the server's answer. */
  async function reconcileLocal(name: string, variables: unknown, tempIds: string[], result: unknown) {
    await mutationHandler(name)?.reconcile?.(reconcileContext(variables, tempIds), result as never)
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
          await write.reconcile(row.document, variables, row.tempIds ?? [], result)
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
        state.lastError = error instanceof Error ? error.message : String(error)
        await db.mutations.update(row.id, { status: 'pending' }).catch(() => {})
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
            return stopped ? 'stopped' : await send(row)
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
  async function execute<T = unknown>(name: string, variables: unknown): Promise<T> {
    if (document(name).kind !== 'mutation') throw new Error(`[nuxt-airplane] "${name}" is not a mutation`)
    await ready
    if (!state.online) throw new Error(`[nuxt-airplane] Cannot send "${name}" while offline`)
    await sync()
    const outbound = await outboundVariables(name, variables)
    const result = await request<T>(name, outbound, uuid())
    accepted++
    await write.reconcile(name, outbound, [], result)
    await refetchActive(mutationHandler(name)?.refetch)
    return result
  }

  /** Empties every table, including the outbox. */
  async function clearLocal() {
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) await table.clear()
    })
    knownTables = undefined
    await db.meta.put({ key: 'cacheKey', value: cacheKey })
  }

  /** Everything that writes to the tables, here or in the worker. */
  const engine: AirplaneEngine = {
    ready: () => ready,
    storeResponse,
    enqueue: enqueueLocal,
    acknowledge,
    rollback: rollbackLocal,
    reconcile: reconcileLocal,
    clearCache,
    clear: clearLocal,
    evict,
  }
  const write = options.remote ?? engine

  // Attempt to drain anything left over from a previous session.
  if (!isEngine) void sync()

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
    dependents,
    retry,
    sync,
    goOffline,
    goOnline,
    cacheKey,
    ready,
    clear: () => write.clear(),
    clearCache: () => write.clearCache(),
    evict: () => write.evict([...active.keys()]),
    engine,
  }
}
