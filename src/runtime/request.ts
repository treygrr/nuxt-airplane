// Requests to the GraphQL endpoint: headers, persisted queries, errors.
//
// Shared by the client in the browser and by server-side rendering, so it
// must not load anything that needs IndexedDB: only `ohash` and the types.

import { hash } from 'ohash'
import {
  GraphQLRequestError,
  type AirplaneRequestContext,
  type AirplaneRequestOptions,
  type GraphQLResponse,
  type OperationDocument,
  type PersistedQueriesMode,
} from './types'

/** `undefined`, `null` and `{}` all mean "no variables" and share a key. */
export function queryKey(name: string, variables: unknown) {
  const normalized = variables && typeof variables === 'object' && Object.keys(variables).length ? variables : null
  return `${name}:${hash(normalized)}`
}

/** The milliseconds a `Retry-After` header asks to wait: a number of seconds, or a date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const ms = /^\s*\d+(?:\.\d+)?\s*$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined
}

/** The APQ error a response carries, if any, by message or by extension code. */
function persistedQueryError(body: GraphQLResponse): 'PersistedQueryNotFound' | 'PersistedQueryNotSupported' | undefined {
  for (const error of body.errors ?? []) {
    const code = error.extensions?.code
    if (error.message === 'PersistedQueryNotFound' || code === 'PERSISTED_QUERY_NOT_FOUND') return 'PersistedQueryNotFound'
    if (error.message === 'PersistedQueryNotSupported' || code === 'PERSISTED_QUERY_NOT_SUPPORTED') return 'PersistedQueryNotSupported'
  }
}

/** What a requester is built from. */
export interface RequesterOptions {
  endpoint: string
  /** Static headers from the `headers` module option. */
  headers?: Record<string, string>
  persistedQueries?: PersistedQueriesMode | ''
  documents: Record<string, OperationDocument>
  request: AirplaneRequestOptions
  /** Runs a function inside the Nuxt app context, so composables work in `headers`. */
  runWithContext?: <T>(fn: () => T) => T | Promise<Awaited<T>>
  /** The fetch used when `request.fetch` is not set. Default `globalThis.fetch`. */
  fetch?: typeof globalThis.fetch
}

/**
 * What a requester learns about the endpoint and keeps: a server that
 * answers `PersistedQueryNotSupported` gets full documents from then on,
 * instead of a wasted round trip per request.
 */
export interface RequesterMemo {
  persistedUnsupported: boolean
}

export type Requester = <T>(name: string, variables: unknown, idempotencyKey?: string) => Promise<T>

/**
 * Builds the function that sends one operation and resolves with its data.
 * It rejects with a `GraphQLRequestError` when the answer carries errors, and
 * with an error carrying `status` (and `retryAfter`) when the HTTP status is
 * not ok; anything else that rejects never got an answer.
 */
export function createRequester(options: RequesterOptions, memo: RequesterMemo = { persistedUnsupported: false }): Requester {
  function document(name: string) {
    const doc = options.documents[name]
    if (!doc) throw new Error(`[nuxt-airplane] Unknown GraphQL document "${name}"`)
    return doc
  }

  /**
   * Static headers from config, then the per-request ones from
   * `defineAirplaneRequest`. A plain object: a fetch that spreads
   * `init.headers`, as Nitro's in-process one does, would lose a `Headers`.
   */
  async function requestHeaders(ctx: AirplaneRequestContext) {
    const headers = new Headers({ 'content-type': 'application/json', ...options.headers })
    const { headers: dynamic } = options.request
    const extra = typeof dynamic === 'function'
      ? await (options.runWithContext ? options.runWithContext(() => dynamic(ctx)) : dynamic(ctx))
      : dynamic
    new Headers(extra ?? undefined).forEach((value, key) => headers.set(key, value))
    return Object.fromEntries(headers)
  }

  async function post<T>(ctx: AirplaneRequestContext, payload: Record<string, unknown>) {
    const doFetch = options.request.fetch ?? options.fetch ?? globalThis.fetch
    const res = await doFetch(options.endpoint, {
      method: 'POST',
      headers: await requestHeaders(ctx),
      credentials: options.request.credentials,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(options.request.timeout ?? 30_000),
    })
    const { onResponse } = options.request
    if (onResponse) await (options.runWithContext ? options.runWithContext(() => onResponse(res, ctx)) : onResponse(res, ctx))
    const body = await res.json().catch(() => ({})) as GraphQLResponse<T>
    return { res, body }
  }

  return async function request<T>(name: string, variables: unknown, idempotencyKey?: string): Promise<T> {
    const doc = document(name)
    const ctx: AirplaneRequestContext = { document: name, kind: doc.kind, variables, ...(idempotencyKey && { idempotencyKey }) }
    const mode = options.persistedQueries
    const persisted = mode && doc.hash && !memo.persistedUnsupported
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
      if (miss === 'PersistedQueryNotSupported') memo.persistedUnsupported = true
      // Not found: send the text along with the hash so the server registers
      // it. Not supported: send the text alone, and keep doing so.
      if (miss) ({ res, body } = await post<T>(ctx, { variables: variables ?? undefined, query: doc.source, extensions: extensions(miss === 'PersistedQueryNotFound') }))
    }
    const retryAfter = parseRetryAfter(res.headers.get('retry-after'))
    if (body.errors?.length) throw new GraphQLRequestError(body.errors, res.status, retryAfter)
    if (!res.ok) throw Object.assign(new Error(`[nuxt-airplane] ${res.status} ${res.statusText}`), { status: res.status, retryAfter })
    // A 200 without `data` (proxy page, empty body) must not end up in the cache.
    if (body.data == null) throw new Error('[nuxt-airplane] Response has no data')
    return body.data as T
  }
}
