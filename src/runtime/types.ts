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
   * Row types of the tables declared with `defineAirplaneStores`. Augment it
   * yourself so `db.<table>` is typed inside handlers:
   *
   * ```ts
   * declare global {
   *   interface NuxtAirplaneStores { sites: { id: string, name: string } }
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

export interface OperationDocument {
  name: string
  kind: 'query' | 'mutation' | 'subscription'
  source: string
  /** SHA-256 of `source`, hex, computed at build time; what persisted queries send instead of the text. */
  hash?: string
}

/**
 * A cached query response, keyed by document name + variables. For queries
 * with a `read` handler only the metadata is kept and `data` is `null`.
 */
export interface QueryRow {
  key: string
  document: string
  variables: unknown
  data: unknown
  updatedAt: number
}

export type MutationStatus = 'pending' | 'syncing' | 'failed'

/** One write recorded while `apply` ran, with the row as it was before. */
export interface UndoEntry {
  table: string
  key: IndexableType
  /** `undefined` when the row did not exist, in which case undo deletes it. */
  before?: unknown
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
  /** Writes made by `apply`, oldest first, used to roll the mutation back. */
  undo?: UndoEntry[]
  /**
   * Ids handed out by `tempId()` while `apply` ran, in call order. A re-apply
   * (rebase) hands out the same ones so the local rows keep their ids.
   */
  tempIds?: string[]
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
} & {
  [K in keyof NuxtAirplaneStores]: Table<NuxtAirplaneStores[K], IndexableType>
}

/** Mutate `data` in place, or return a replacement. */
// eslint-disable-next-line @typescript-eslint/no-invalid-void-type
export type Updater<T> = (data: T, variables: unknown) => T | undefined | void

/** Read and write the cached query responses from inside a mutation handler. */
export interface CacheApi {
  /** Update every cached response of a query document. */
  update<N extends QueryName>(name: N, updater: Updater<QueryResult<N>>): Promise<void>
  /** Update the cached response for one exact set of variables. */
  update<N extends QueryName>(name: N, variables: QueryVariables<N>, updater: Updater<QueryResult<N>>): Promise<void>
  get<N extends QueryName>(name: N, variables?: QueryVariables<N>): Promise<QueryResult<N> | undefined>
  set<N extends QueryName>(name: N, variables: QueryVariables<N>, data: QueryResult<N>): Promise<void>
  /** Drop the cached responses of a query document and refetch it once `apply` is done. */
  invalidate(name: QueryName): Promise<void>
}

export interface HandlerContext<V = unknown> {
  db: AirplaneDexie
  cache: CacheApi
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
   * still held. The last 1000 mappings are kept.
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
   * Runs when a queued mutation is rolled back. When omitted the writes made
   * by `apply` are undone from the recorded log instead.
   */
  revert?: (ctx: HandlerContext<MutationVariables<N>>) => unknown
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
  /** Writes a fresh response into your own tables. Runs inside a Dexie transaction. */
  store?: (ctx: QueryHandlerContext<QueryVariables<N>>, data: QueryResult<N>) => unknown
  /**
   * Builds the query's result from your tables. Runs inside Dexie's
   * `liveQuery`, so whatever it reads is observed and `data` stays live.
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
  constructor(public errors: GraphQLError[]) {
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
  /** A failed mutation holds back the ones queued after it; see the `stopOnFailure` module option. Default `true`. */
  stopOnFailure?: boolean
  /** Send operations by hash instead of text; see the `persistedQueries` module option. `''` means off. */
  persistedQueries?: PersistedQueriesMode | ''
}

/**
 * - `'automatic'`: the hash goes first; the text follows only when the server
 *   answers `PersistedQueryNotFound` (Apollo's automatic persisted queries).
 * - `'manifest'`: only the hash is ever sent. The server must know the
 *   documents from the manifest written at build time.
 */
export type PersistedQueriesMode = false | 'automatic' | 'manifest'
