import type { Dexie, EntityTable } from 'dexie'

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

/** A cached query response, keyed by document name + variables. */
export interface QueryRow {
  key: string
  document: string
  variables: unknown
  data: unknown
  updatedAt: number
}

export type MutationStatus = 'pending' | 'syncing' | 'failed'

/** A queued mutation waiting to reach the server. */
export interface MutationRow {
  id: number
  document: string
  variables: unknown
  status: MutationStatus
  createdAt: number
  error?: string
  /** Cached query rows as they were before `apply` ran, used to roll back. */
  snapshot?: QueryRow[]
}

export type OfflineDexie = Dexie & {
  queries: EntityTable<QueryRow, 'key'>
  mutations: EntityTable<MutationRow, 'id'>
}

export type Updater<T> = (data: T, variables: unknown) => T | void

/** Read and write the cached query data from inside a mutation handler. */
export interface CacheApi {
  /** Update every cached response of a query document. */
  update<N extends QueryName>(name: N, updater: Updater<QueryResult<N>>): Promise<void>
  /** Update the cached response for one exact set of variables. */
  update<N extends QueryName>(name: N, variables: QueryVariables<N>, updater: Updater<QueryResult<N>>): Promise<void>
  get<N extends QueryName>(name: N, variables?: QueryVariables<N>): Promise<QueryResult<N> | undefined>
  set<N extends QueryName>(name: N, variables: QueryVariables<N>, data: QueryResult<N>): Promise<void>
  /** Drop the cached responses of a query document so they get refetched. */
  invalidate(name: QueryName): Promise<void>
}

export interface HandlerContext<V = unknown> {
  db: OfflineDexie
  cache: CacheApi
  variables: V
}

export interface MutationHandler<N extends MutationName = MutationName> {
  /** Runs as soon as the mutation is queued, so the UI reflects it immediately. */
  apply?: (ctx: HandlerContext<MutationVariables<N>>) => void | Promise<void>
  /** Runs with the server's response once the mutation has been sent. */
  reconcile?: (ctx: HandlerContext<MutationVariables<N>>, result: MutationResult<N>) => void | Promise<void>
  /**
   * Runs when a queued mutation is rolled back. When omitted the cache rows
   * touched by `apply` are restored from a snapshot instead.
   */
  revert?: (ctx: HandlerContext<MutationVariables<N>>) => void | Promise<void>
  /** Queries to refetch after the mutation has been sent. Defaults to every active query. */
  refetch?: QueryName[]
}

export type MutationHandlers = { [N in MutationName]?: MutationHandler<N> }

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
