import type { Dexie, EntityTable, IndexableType, Table } from 'dexie'

declare global {
  /**
   * Augmented by the generated `types/nuxt-airplane.d.ts` with one entry per
   * query document found in the user's `.gql` / `.graphql` files.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface NuxtAirplaneQueries {}

  /** Same as {@link NuxtAirplaneQueries}, for mutation documents. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface NuxtAirplaneMutations {}

  /**
   * Row types of the tables, so `db.<table>` is typed inside handlers. The
   * generated `types/nuxt-airplane.d.ts` fills it with one entry per type the
   * documents select with an `id`. Augment it yourself for a table you
   * declared with `defineAirplaneStores`:
   *
   * ```ts
   * declare global {
   *   interface NuxtAirplaneStores { drafts: { id: string, body: string } }
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface NuxtAirplaneStores {}
}

export type QueryName = keyof NuxtAirplaneQueries & string
export type MutationName = keyof NuxtAirplaneMutations & string

export type QueryResult<N extends QueryName> = NuxtAirplaneQueries[N] extends { result: infer R } ? R : never
export type QueryVariables<N extends QueryName> = NuxtAirplaneQueries[N] extends { variables: infer V } ? V : never
export type MutationResult<N extends MutationName> = NuxtAirplaneMutations[N] extends { result: infer R } ? R : never
export type MutationVariables<N extends MutationName> = NuxtAirplaneMutations[N] extends { variables: infer V } ? V : never

/** What the runtime knows about an inferred table: the field it is keyed on. */
export interface EntityInfo {
  key: string
}

export interface OperationDocument {
  name: string
  kind: 'query' | 'mutation' | 'subscription'
  source: string
  /** SHA-256 of `source`, hex, computed at build time; what persisted queries send instead of the text. */
  hash?: string
}

/**
 * A record of a fetch, keyed by document name + variables: when this variant
 * of the query last came from the server. The data itself lives in the
 * tables the query's `store` handler wrote it to.
 */
export interface QueryRow {
  key: string
  document: string
  variables: unknown
  updatedAt: number
  /**
   * The rows its `store` wrote, as `[table, key]`. What may be dropped with
   * this record when storage runs low, unless another record or the queue
   * holds the same row.
   */
  rows?: [string, IndexableType][]
}

export type MutationStatus = 'pending' | 'syncing' | 'failed'

/**
 * The server's version of a row the queue has changed. The data tables show
 * that row with the queued mutations applied; this is what it goes back to
 * when they are taken off.
 */
export interface BaseRow {
  table: string
  key: IndexableType
  /** The row as the server has it. */
  row?: unknown
  /** The server has no such row: a queued mutation created it. */
  absent?: 1
}

/** A queued mutation waiting to reach the server. */
export interface MutationRow {
  id: number
  document: string
  variables: unknown
  status: MutationStatus
  createdAt: number
  /** Human-readable summary from the handler's `describe`, or the humanized document name. */
  description: string
  error?: string
  /**
   * Sent with every attempt, in the request's `extensions`, so a server can
   * tell a retry of this mutation from a new one.
   */
  idempotencyKey?: string
  /** How many times it has been sent. */
  attempts?: number
  /** The rows `apply` changed, as `[table, key]`: what goes back to the server's version when it is taken off. */
  keys?: [string, IndexableType][]
  /**
   * Ids handed out by `tempId()` while `apply` ran, in call order. A re-apply
   * (rebase) hands out the same ones so the local rows keep their ids. Each
   * is replaced by the server's id once `resolve` has named it.
   */
  tempIds?: string[]
  /**
   * Outbox ids of the mutations this one depends on: the ones that minted a
   * placeholder its variables carry, or created something its `apply`
   * touched. While one of them is failed this row waits, and rolling one
   * back drops this row with it.
   */
  dependsOn?: number[]
  /**
   * What `apply` created, by path: a row (`Site/s1`) or an element with an
   * `id` in a list inside one (`Site/s1/items/i1`). A later mutation whose
   * `apply` touches one of them depends on this one.
   */
  creates?: string[]
  /**
   * The pieces `apply` wrote, by path: a field (`Site/s1#name`), or a thing
   * it added or removed. A later mutation that writes one of them comes
   * `after` this one.
   */
  writes?: string[]
  /**
   * Outbox ids of earlier mutations that wrote a piece this one writes too,
   * such as two renames of the same site. Order only: this row waits while
   * one of them is failed, so the server sees them in the order they were
   * made, but rolling one back leaves this row queued.
   */
  after?: number[]
}

/** Module bookkeeping, e.g. the cache key the data was written under. */
export interface MetaRow {
  key: string
  value: string
}

export type AirplaneDexie = Dexie & {
  queries: EntityTable<QueryRow, 'key'>
  mutations: EntityTable<MutationRow, 'id'>
  meta: EntityTable<MetaRow, 'key'>
  base: Table<BaseRow, [string, IndexableType]>
} & {
  [K in keyof NuxtAirplaneStores]: Table<NuxtAirplaneStores[K], IndexableType>
}

export interface HandlerContext<V = unknown> {
  db: AirplaneDexie
  variables: V
}

/** What `apply` receives: the handler context plus a way to mint placeholder ids. */
export interface ApplyContext<V = unknown> extends HandlerContext<V> {
  /**
   * A placeholder id for a row the server will assign an id to. Mutations
   * queued later that reference it are rewritten with the real id before they
   * are sent, once `reconcile` has called `resolve`. The same ids come back,
   * in the same order, when `apply` is re-run on fresh server data.
   */
  tempId: () => string
}

/** What `reconcile` receives: the handler context plus `resolve`. */
export interface ReconcileContext<V = unknown> extends HandlerContext<V> {
  /** The ids `apply` minted with `tempId()`, in call order; empty for a mutation sent with `execute`. */
  tempIds: string[]
  /**
   * Records that the placeholder `tempId` stands for the server-assigned `id`.
   * Every queued mutation whose variables mention `tempId` is sent with `id`
   * instead, also one queued after the outbox drained with an id a component
   * still held. The last 1000 mappings are kept. The row keyed `tempId` in an
   * inferred table is re-keyed to `id`; rows in your own tables are yours to
   * update here.
   */
  resolve: (tempId: string, id: string) => Promise<void>
}

export interface MutationHandler<N extends MutationName = MutationName> {
  /**
   * A human-readable summary for the pending list, e.g. "Archive North Warehouse".
   * Computed once when the mutation is queued, before `apply`, so it can read
   * the data as it was. Defaults to the humanized document name.
   */
  describe?: string | ((ctx: HandlerContext<MutationVariables<N>>) => string | Promise<string>)
  /**
   * Runs as soon as the mutation is queued, so the UI reflects it immediately.
   * It runs inside a Dexie transaction and every write is recorded for rollback.
   */
  apply?: (ctx: ApplyContext<MutationVariables<N>>) => unknown
  /**
   * Runs with the server's response once the mutation has been sent. Merge
   * server-assigned values into the local data here and call `resolve` for
   * every id minted with `tempId()`.
   */
  reconcile?: (ctx: ReconcileContext<MutationVariables<N>>, result: MutationResult<N>) => unknown
  /**
   * Runs when a queued mutation is rolled back, before the rows it changed go
   * back to the server's version: for what `apply` did outside the database.
   */
  revert?: (ctx: HandlerContext<MutationVariables<N>>) => unknown
  /**
   * Folds a mutation queued later into one of the same document that is still
   * waiting, so ten quantity changes of one cart line reach the server as
   * one. Receives the variables of both and returns those of the single
   * mutation that stands for them, or nothing when they are not about the
   * same thing. Must be pure. Only a mutation that has never been sent is
   * merged into, and only when nothing queued in between touched the same rows.
   */
  merge?: (earlier: MutationVariables<N>, later: MutationVariables<N>) => MutationVariables<N> | null | undefined | false
  /** Queries to refetch after the mutation has been sent. Defaults to every active query. */
  refetch?: QueryName[]
}

export type MutationHandlers = { [N in MutationName]?: MutationHandler<N> }

export interface QueryHandlerContext<V = unknown> {
  db: AirplaneDexie
  variables: V
}

/**
 * Walk a paginated query to the end after any page of it is fetched, so the
 * whole set is available offline.
 */
export interface QueryPrefetch<N extends QueryName = QueryName> {
  /** Variables of the page after `data`, or `null` / `undefined` when there is none. */
  next: (data: QueryResult<N>, variables: QueryVariables<N>) => QueryVariables<N> | null | undefined
  /** Safety cap on pages fetched per run. Default 1000. */
  maxPages?: number
  /** Skip the run when this returns `false`: metered connection, feature flag, user setting… */
  when?: () => boolean
}

export interface QueryHandler<N extends QueryName = QueryName> {
  /** Fetch every following page in the background once a page of this query is fetched. */
  prefetch?: QueryPrefetch<N>
  /** Writes a fresh response into the tables. Runs inside a Dexie transaction. */
  store?: (ctx: QueryHandlerContext<QueryVariables<N>>, data: QueryResult<N>) => unknown
  /**
   * Builds the query's result from the tables; what `useQuery` returns, online
   * or offline. Runs inside Dexie's `liveQuery`, so whatever it reads is
   * observed and `data` stays live. Without it the query is served from the
   * network only.
   */
  read?: (ctx: QueryHandlerContext<QueryVariables<N>>) =>
    QueryResult<N> | null | undefined | Promise<QueryResult<N> | null | undefined>
}

export type QueryHandlers = { [N in QueryName]?: QueryHandler<N> }

/** Extra Dexie tables, in Dexie's `stores()` syntax. */
export interface AirplaneStores {
  stores: Record<string, string>
  /** Schema version. Bump it when changing indexes of existing tables. */
  version?: number
}

/** What is being sent, for `headers` / `onResponse` to decide on. */
export interface AirplaneRequestContext {
  document: string
  kind: OperationDocument['kind']
  variables: unknown
  /** For a queued mutation: the key that is the same on every attempt to send it. */
  idempotencyKey?: string
}

/** How requests to the GraphQL endpoint are made; see `defineAirplaneRequest`. */
export interface AirplaneRequestOptions {
  /**
   * Extra headers, or a function returning them. The function runs for every
   * request, inside the Nuxt app context, so it can read a cookie or state and
   * always sends the current token, also for mutations synced later.
   */
  headers?: HeadersInit | ((ctx: AirplaneRequestContext) => HeadersInit | undefined | Promise<HeadersInit | undefined>)
  /** `fetch` credentials mode, e.g. `'include'` for cookie auth across origins. */
  credentials?: RequestCredentials
  /** A fetch implementation to use instead of the global one. */
  fetch?: typeof globalThis.fetch
  /**
   * Abort a request after this many milliseconds (default 30 000). A request
   * that never settles would otherwise hold the sync loop for the session.
   */
  timeout?: number
  /** Sees every response before it is parsed, e.g. to react to a 401. */
  onResponse?: (response: Response, ctx: AirplaneRequestContext) => unknown
  /**
   * Whether an error answer to a queued mutation says nothing about that
   * mutation (the session expired, the server is busy), so it should stay
   * queued and the sync stop until the next attempt, like a network failure.
   * By default: HTTP 401, 429 and 5xx, and the codes `UNAUTHENTICATED`,
   * `TOO_MANY_REQUESTS` and `RATE_LIMITED`.
   */
  retryLater?: (error: GraphQLRequestError) => boolean
  /**
   * How many queued mutations may be in flight at once (default 4). Only
   * mutations that have nothing to do with each other are sent side by side:
   * a chain, and edits of the same row, always go in order. Set it to 1 for
   * an API that cannot take concurrent mutations from one client.
   */
  concurrency?: number
}

/** Marks what a file under the handlers directory default-exports. */
export const HANDLER_KIND: unique symbol = Symbol.for('nuxt-airplane:kind')
export type HandlerKind = 'mutations' | 'queries' | 'stores' | 'request'

export interface GraphQLError {
  message: string
  path?: (string | number)[]
  extensions?: Record<string, unknown>
}

export interface GraphQLResponse<T = unknown> {
  data?: T | null
  errors?: GraphQLError[]
}

export class GraphQLRequestError extends Error {
  /**
   * `status` is the HTTP status the errors came with, and `retryAfter` the
   * milliseconds its `Retry-After` header asked to wait, if it had one.
   */
  constructor(public errors: GraphQLError[], public status = 200, public retryAfter?: number) {
    super(errors.map(e => e.message).join('\n'))
    this.name = 'GraphQLRequestError'
  }
}

export interface AirplaneRuntimeConfig {
  endpoint: string
  dbName: string
  /** Static headers from the `headers` module option. */
  headers?: Record<string, string>
  /** Deploy-specific part of the cache key; see the `cacheKey` module option. */
  cacheKey?: string
  /** Send operations by hash instead of text; see the `persistedQueries` module option. `''` means off. */
  persistedQueries?: PersistedQueriesMode | ''
  /** Run the handlers that write (`store`, `apply`, `reconcile`…) in a web worker; see the `worker` module option. */
  worker?: boolean
}

/**
 * Everything that writes to the tables. It runs where the client does, or in
 * a web worker with the client calling it over messages, so every argument
 * and result is plain data.
 */
export interface AirplaneEngine {
  ready: () => Promise<void>
  storeResponse: (name: string, variables: unknown, data: unknown) => Promise<void>
  enqueue: (name: string, input: unknown) => Promise<MutationRow>
  acknowledge: (id: number) => Promise<void>
  rollback: (id: number) => Promise<MutationRow[]>
  reconcile: (name: string, variables: unknown, tempIds: string[], result: unknown) => Promise<void>
  clearCache: () => Promise<void>
  clear: () => Promise<void>
  /** Drops the least recently fetched rows, keeping those of the queries in `keep` and of the queue. Resolves with how many went. */
  evict: (keep: string[]) => Promise<number>
}

/**
 * - `'automatic'`: the hash goes first; the text follows only when the server
 *   answers `PersistedQueryNotFound` (Apollo's automatic persisted queries).
 * - `'manifest'`: only the hash is ever sent. The server must know the
 *   documents from the manifest written at build time.
 */
export type PersistedQueriesMode = false | 'automatic' | 'manifest'
