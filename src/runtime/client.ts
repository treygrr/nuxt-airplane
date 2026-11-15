import { Dexie, liveQuery } from 'dexie'
import { hash } from 'ohash'
import { reactive, computed, shallowRef, readonly } from 'vue'
import { BOOKKEEPING_TABLES, MODULE_STORES, applyUndo, createDb, describeChanges, thingPath, whenCommitted, withUndoLog } from './db'
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
    await db.transaction('rw', db.tables, async () => {
      for (const table of tables) await table.clear()
      // What the queue wrote went with the tables, so its undo logs have
      // nothing left to take back: unwinding them would put cleared rows back.
      await db.mutations.toCollection().modify({ undo: [], creates: [], writes: [] })
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
    if (body.errors?.length) throw new GraphQLRequestError(body.errors, res.status)
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
   * Writes a response through the `store` handler, under the queued
   * mutations, and records the fetch. A query with neither `store` nor
   * `read` leaves nothing behind.
   */
  async function storeResponse(name: string, variables: unknown, data: unknown) {
    const h = queryHandler(name)
    if (!h?.store && !h?.read) return
    const record = () => db.queries.put({ key: queryKey(name, variables), document: name, variables, updatedAt: Date.now() })
    if (!h.store) {
      await record()
      return
    }
    await rebase(async () => {
      await h.store!({ db, variables: variables as never }, data as never)
      await record()
    })
  }

  async function fetchQuery<T>(name: string, variables: unknown): Promise<T> {
    await ready
    const data = await request<T>(name, variables)
    await storeResponse(name, variables, data)
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

  /** The outbox, oldest first: the order mutations are applied and sent in. */
  function queued() {
    return db.mutations.orderBy('createdAt').toArray()
  }

  /**
   * Runs `apply` for a queued mutation inside an undo-logged transaction and
   * stores on the row what it takes to undo it and what it created and
   * wrote. Returns what it touched and wrote.
   */
  async function applyMutation(row: MutationRow, { tolerant = false } = {}): Promise<{ touched: Set<string>, wrote: Set<string> }> {
    const h = mutationHandler(row.document)
    if (!h?.apply) {
      // Nothing to apply (the handler lost its `apply` in a deploy): an undo
      // log left from before would be unwound on every rebase and never redone.
      if (row.undo?.length) await db.mutations.update(row.id, { undo: [], creates: [], writes: [] })
      return { touched: new Set(), wrote: new Set() }
    }
    // Ids minted on the first apply are handed out again on a rebase, in the
    // same order, so a re-applied create keeps the id later mutations reference.
    const tempIds = [...(row.tempIds ?? [])]
    let minted = 0
    const tempId = () => (tempIds[minted] ??= newTempId(), tempIds[minted++]!)
    const { changes, error } = await withUndoLog(db, () =>
      h.apply!({ db, variables: row.variables as never, tempId }), { tolerant })
    const { undo, created, touched, wrote } = describeChanges(changes)
    // Said once per mutation, not on every response stored while it is queued.
    if (!error) skipped.delete(row.id)
    else if (!skipped.has(row.id)) {
      skipped.add(row.id)
      console.warn(`[nuxt-airplane] "${row.document}" could not be applied again on the current data, so its change is not shown locally until it syncs:`, error)
    }
    await db.mutations.update(row.id, { undo, tempIds, creates: [...created], writes: [...wrote] })
    return { touched, wrote }
  }

  /** Queued mutations whose last re-apply threw. */
  const skipped = new Set<number>()

  /**
   * Applies a queued mutation again on data that changed under it: a rebase
   * or a rollback. A handler that throws on
   * what it now finds must not take the others down with it, or keep a
   * response from being stored: what it wrote is taken back, the mutation
   * stays queued with nothing applied, and the next re-apply tries again.
   */
  function reapply(row: MutationRow) {
    return applyMutation(row, { tolerant: true })
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
    await db.transaction('rw', db.tables, async () => {
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
   * instead: in their variables, so a re-apply targets the row where
   * `moveRow` put it; in their undo logs, whatever the table, so an unwind
   * restores that row and not one under the placeholder; in the minted ids
   * of the mutation that created it, so a re-apply of the create writes the
   * same row; and in the things they created, which moved with the row.
   */
  async function rewriteQueue(tempId: string, id: string) {
    const ids = { [tempId]: id }
    await db.mutations.toCollection().modify((row: MutationRow) => {
      const { value, replaced } = substituteTempIds(row.variables, ids)
      if (replaced) row.variables = value
      if (row.tempIds?.includes(tempId)) row.tempIds = row.tempIds.map(t => (t === tempId ? id : t))
      if (row.creates) row.creates = row.creates.map(path => rekeyThing(path, tempId, id))
      if (row.writes) row.writes = row.writes.map(path => rekeyThing(path, tempId, id))
      for (const entry of row.undo ?? []) {
        if (entry.key !== tempId) continue
        entry.key = id
        const keyPath = db.tables.find(t => t.name === entry.table)?.schema.primKey.keyPath
        if (typeof keyPath === 'string' && entry.before && Dexie.getByKeyPath(entry.before, keyPath) === tempId) entry.before = rekeyed(entry.before as object, keyPath, id)
      }
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
   * it, inferred or declared, so the row stays put once the server has named
   * it. A copy of it nested in another row, or a reference to it there, is
   * left to the next refetch.
   */
  async function moveRow(tempId: string, id: string) {
    for (const table of db.tables.filter(t => !(t.name in MODULE_STORES))) {
      const { keyPath } = table.schema.primKey
      // A lone placeholder is never the whole of a compound key.
      if (Array.isArray(keyPath)) continue
      const row = await table.get(tempId)
      if (row === undefined) continue
      await table.delete(tempId)
      if (keyPath) await table.put(rekeyed(row, keyPath, id))
      else await table.put(row, id)
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

  /**
   * Runs `write` (a response going into the tables) under the queued
   * mutations: their effects are unwound, newest first, the data is written,
   * and each is applied again, oldest first. Their effect ends up on top of
   * the new data and their undo logs describe that data, not their own
   * earlier effect, so a rollback afterwards restores what the server last
   * said. In-flight (`syncing`) ones are included: the response may predate
   * them, and their effect must stay visible until the server confirms and
   * the next refetch lands. One transaction, so nothing observes the tables
   * with the queue unwound.
   */
  async function rebase(write: () => Promise<unknown>) {
    type Phase = 'unwind' | 'write' | 'replay' | 'done'
    /** Where the steps below are, and where they were when the transaction committed. */
    const at = { phase: 'unwind' as Phase, commit: undefined as Phase | undefined }
    let queue: MutationRow[] = []
    try {
      await db.transaction('rw', db.tables, async () => {
        whenCommitted(() => (at.commit = at.phase))
        queue = await queued()
        for (const row of [...queue].reverse()) if (row.undo) await applyUndo(db, row.undo)
        at.phase = 'write'
        await write()
        at.phase = 'replay'
        for (const row of queue) await reapply(row)
        at.phase = 'done'
      })
    }
    catch (error) {
      // `write` awaited something other than a Dexie operation, so the
      // transaction closed under it and committed with the queue unwound and
      // nothing applied again yet. Put the queue back before reporting it.
      if (at.commit === 'write') {
        await db.transaction('rw', db.tables, async () => {
          for (const row of queue) await reapply(row)
        })
      }
      throw error
    }
  }

  async function describeMutation(name: string, variables: unknown) {
    const { describe } = mutationHandler(name) ?? {}
    if (typeof describe === 'string') return describe
    if (describe) return describe({ db, variables: variables as never })
    return humanize(name)
  }

  async function enqueue(name: string, input: unknown) {
    if (document(name).kind !== 'mutation') throw new Error(`[nuxt-airplane] "${name}" is not a mutation`)
    await ready
    // A placeholder the server has already named is its real id from the start.
    const named = substituteTempIds(input, await readTempIds()).value
    const description = await describeMutation(name, named)
    // One transaction: the mutation is queued with its effect applied and its
    // dependencies known, or not at all if `apply` throws, and no rebase can
    // find it half-queued.
    let queuedAs: number | undefined
    const row = await db.transaction('rw', db.tables, async () => {
      const variables = substituteTempIds(named, await readTempIds()).value
      // The queue is ordered by this, so it must not step back with the clock.
      const createdAt = Math.max(Date.now(), (await db.mutations.orderBy('createdAt').last())?.createdAt ?? 0)
      const id = queuedAs = await db.mutations.add({ document: name, variables, description, status: 'pending', createdAt } as MutationRow)
      const did = await applyMutation((await db.mutations.get(id))!)
      await db.mutations.update(id, await linksOf(id, variables, did))
      return (await db.mutations.get(id))!
    }).catch(async (error) => {
      // An abort removes the row. An `apply` that awaited something other
      // than a Dexie operation made the transaction commit instead, row
      // included: the caller is told it failed, so it must not be sent.
      if (queuedAs !== undefined) await db.mutations.delete(queuedAs)
      throw error
    })
    void sync()
    return row
  }

  /**
   * Undo a queued mutation and drop it from the outbox. The writes made since
   * it are unwound newest first, from the undo logs, then the later mutations
   * are applied again on the restored data, so their effect and their own
   * undo logs stay consistent.
   *
   * A mutation that depended on a dropped one is dropped with it when it has
   * nothing left to do: it carries a placeholder that will now never resolve,
   * or applying it again changes nothing (a quantity set on an item that is
   * gone). One that still does something stays queued on its own, such as a
   * corrected save of the same row. Resolves with the mutations it dropped.
   */
  async function rollback(id: number): Promise<MutationRow[]> {
    const run = async () => {
      // Read here, inside the transaction: a rebase that lands first rewrites the logs.
      const rows = await queued()
      const row = rows.find(m => m.id === id)
      if (!row || row.status === 'syncing') return []
      // A row being sent right now is left alone: its effect must stay until
      // the server confirms it and the next refetch lands.
      const later = rows.slice(rows.indexOf(row) + 1).filter(m => m.status !== 'syncing')
      for (const m of [...later].reverse()) await undoMutation(m, false)
      await undoMutation(row, true)
      await db.mutations.delete(id)
      const dropped = [row]
      const gone = (ids?: number[]) => ids?.some(d => dropped.some(m => m.id === d))
      for (const m of later) {
        const orphan = gone(m.dependsOn)
        const placeholders = dropped.flatMap(d => d.tempIds ?? [])
        const stuck = orphan && substituteTempIds(m.variables, {}).unresolved.some(t => placeholders.includes(t))
        if (!stuck && (await reapply(m)).touched.size) {
          if (orphan || gone(m.after)) {
            const left = (ids?: number[]) => ids?.filter(d => !dropped.some(x => x.id === d))
            await db.mutations.update(m.id, { dependsOn: left(m.dependsOn), after: left(m.after) })
          }
          continue
        }
        if (!orphan) continue
        await db.mutations.delete(m.id)
        dropped.push(m)
      }
      return dropped
    }
    // One transaction, unless a `revert` hook runs: it may reach outside the
    // database, which a transaction cannot wait for.
    const reverts = mutationHandler((await db.mutations.get(id))?.document ?? '')?.revert
    const dropped = reverts ? await run() : await db.transaction('rw', db.tables, run)
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

  /**
   * Takes a mutation's effect back: through its `revert` hook when it is the
   * one being rolled back and has one, else from its undo log.
   */
  async function undoMutation(row: MutationRow, rolledBack: boolean) {
    const h = mutationHandler(row.document)
    if (rolledBack && h?.revert) await h.revert({ db, variables: row.variables as never })
    else if (row.undo) await applyUndo(db, row.undo)
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

    /** Rows this batch failed to send, and the rows below them: they stay queued. */
    const held = new Set<number>()
    try {
      for (const row of queue) {
        if (row.dependsOn?.some(id => held.has(id)) || row.after?.some(id => held.has(id))) {
          held.add(row.id)
          continue
        }
        // Rolled back while an earlier row of this batch was in flight: it is gone, do not send it.
        if (!await db.mutations.update(row.id, { status: 'syncing' })) continue
        try {
          // An earlier row of this batch may have resolved a temp id this one
          // carries. Rewriting the row too keeps a later rebase on the real id.
          const variables = await outboundVariables(row.document, row.variables)
          if (variables !== row.variables) await db.mutations.update(row.id, { variables })
          const result = await request(row.document, variables)
          const h = mutationHandler(row.document)
          try {
            await h?.reconcile?.(reconcileContext(variables, row.tempIds), result as never)
          }
          catch (error) {
            // A handler bug, not a rejection: sending the mutation again would apply it twice on the server.
            state.lastError = error instanceof Error ? error.message : String(error)
            console.warn(`[nuxt-airplane] reconcile of "${row.document}" threw after the server accepted it:`, error)
          }
          if (h?.refetch) h.refetch.forEach(n => refetch.add(n))
          else refetchAll = true
          await db.mutations.delete(row.id)
          state.syncCount++
        }
        catch (error) {
          // An answer about the session or the server, not this mutation: nothing
          // behind it would fare better, so stop here as for a network failure.
          const later = error instanceof GraphQLRequestError && (options.request.retryLater ?? retryLaterByDefault)(error)
          if (!later && (error instanceof GraphQLRequestError || error instanceof UnresolvedTempIdError)) {
            // The server rejected it: park it so the user can retry or roll it
            // back. Only the rows that depend on it wait; the batch goes on.
            await db.mutations.update(row.id, { status: 'failed', error: error.message })
            held.add(row.id)
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
    dependents,
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
