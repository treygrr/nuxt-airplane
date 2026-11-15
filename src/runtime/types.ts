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
}

export type MutationStatus = 'pending' | 'syncing' | 'failed'

/** A step from a row down to one of its pieces: a field name, or the id of a list element. */
export type UndoStep = string | { id: string }

/** One piece of a row that `apply` changed, with what was there before. */
export interface UndoOp {
  /** Where the piece is; the last step names it. */
  path: UndoStep[]
  /** Whether it existed. If not, undo removes it. */
  had: boolean
  /** What it was. */
  value?: unknown
  /** Where a removed list element sat. */
  index?: number
}

/** What `apply` did to one row, as what it takes to undo it. */
export interface UndoEntry {
  table: string
  key: IndexableType
  /** The row did not exist: undo deletes it. */
  created?: true
  /** The row as it was, when it was deleted or replaced whole: undo puts it back. */
  before?: unknown
  /** Otherwise the pieces that changed: undo puts back those and nothing else. */
  ops?: UndoOp[]
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
  /** `status` is the HTTP status the errors came with. */
  constructor(public errors: GraphQLError[], public status = 200) {
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
}

/**
 * - `'automatic'`: the hash goes first; the text follows only when the server
 *   answers `PersistedQueryNotFound` (Apollo's automatic persisted queries).
 * - `'manifest'`: only the hash is ever sent. The server must know the
 *   documents from the manifest written at build time.
 */
export type PersistedQueriesMode = false | 'automatic' | 'manifest'
