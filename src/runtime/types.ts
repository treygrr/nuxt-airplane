import type { Dexie, EntityTable, IndexableType, Table } from 'dexie'

declare global {
  /**
   * Augmented by the generated `types/nuxt-offline.d.ts` with one entry per
   * query document found in the user's `.gql` / `.graphql` files.
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface NuxtOfflineQueries {}

  /** Same as {@link NuxtOfflineQueries}, for mutation documents. */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface NuxtOfflineMutations {}

  /**
   * Row types of the tables declared with `defineOfflineStores`. Augment it
   * yourself so `db.<table>` is typed inside handlers:
   *
   * ```ts
   * declare global {
   *   interface NuxtOfflineStores { sites: { id: string, name: string } }
   * }
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface NuxtOfflineStores {}
}

export type QueryName = keyof NuxtOfflineQueries & string
export type MutationName = keyof NuxtOfflineMutations & string

export type QueryResult<N extends QueryName> = NuxtOfflineQueries[N] extends { result: infer R } ? R : never
export type QueryVariables<N extends QueryName> = NuxtOfflineQueries[N] extends { variables: infer V } ? V : never
export type MutationResult<N extends MutationName> = NuxtOfflineMutations[N] extends { result: infer R } ? R : never
export type MutationVariables<N extends MutationName> = NuxtOfflineMutations[N] extends { variables: infer V } ? V : never

export interface OperationDocument {
  name: string
  kind: 'query' | 'mutation' | 'subscription'
  source: string
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
  error?: string
  /** Writes made by `apply`, oldest first, used to roll the mutation back. */
  undo?: UndoEntry[]
}

export type OfflineDexie = Dexie & {
  queries: EntityTable<QueryRow, 'key'>
  mutations: EntityTable<MutationRow, 'id'>
} & {
  [K in keyof NuxtOfflineStores]: Table<NuxtOfflineStores[K], IndexableType>
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
  db: OfflineDexie
  cache: CacheApi
  variables: V
}

export interface MutationHandler<N extends MutationName = MutationName> {
  /**
   * Runs as soon as the mutation is queued, so the UI reflects it immediately.
   * It runs inside a Dexie transaction and every write is recorded for rollback.
   */
  apply?: (ctx: HandlerContext<MutationVariables<N>>) => unknown
  /** Runs with the server's response once the mutation has been sent. */
  reconcile?: (ctx: HandlerContext<MutationVariables<N>>, result: MutationResult<N>) => unknown
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
  db: OfflineDexie
  variables: V
}

export interface QueryHandler<N extends QueryName = QueryName> {
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
export interface OfflineStores {
  stores: Record<string, string>
  /** Schema version. Bump it when changing indexes of existing tables. */
  version?: number
}

/** Marks what a file under the handlers directory default-exports. */
export const HANDLER_KIND: unique symbol = Symbol.for('nuxt-offline:kind')
export type HandlerKind = 'mutations' | 'queries' | 'stores'

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

export interface OfflineRuntimeConfig {
  endpoint: string
  dbName: string
}
