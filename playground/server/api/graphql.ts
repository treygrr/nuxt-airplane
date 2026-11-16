// The GraphQL endpoint, with the lab's chaos in front of it.
//
// A request first meets the session check, then the HTTP-level chaos
// (dropped connections, rate limits, 503s, latency), then Apollo. A mutation
// whose answer the lab wants lost runs to completion and then has its
// connection closed: applied on the server, never heard of by the client.

import { createHash } from 'node:crypto'
import { ApolloServer, HeaderMap } from '@apollo/server'
import { Kind, parse, type OperationDefinitionNode } from 'graphql'
import type { H3Event } from 'h3'
import { resolvers } from '../graphql/resolvers'
import { chaos, sleep, stats, type RequestContext } from '../utils/lab'

interface Body {
  query?: string
  operationName?: string
  variables?: Record<string, unknown>
  extensions?: { persistedQuery?: { sha256Hash?: string }, idempotencyKey?: string }
}
type Kind_ = 'query' | 'mutation'

// The SDL is a server asset (see `nitro.serverAssets` in nuxt.config.ts), so
// the same file feeds Apollo here and the module's type generation.
let apollo: Promise<ApolloServer<RequestContext>> | undefined
async function start() {
  const raw = await useStorage('assets:graphql').getItemRaw('schema.graphql')
  const server = new ApolloServer<RequestContext>({ typeDefs: Buffer.from(raw as Uint8Array).toString('utf8'), resolvers })
  await server.start()
  return server
}

/**
 * What each persisted query is, by hash. The client sends the hash alone
 * once the server knows it, so the kind is learned from the one time the
 * text comes along.
 */
const known = new Map<string, { kind: Kind_, name: string }>()

function identify(body: Body): { kind: Kind_, name: string } {
  const hash = body.extensions?.persistedQuery?.sha256Hash
  if (body.query) {
    try {
      const op = parse(body.query).definitions.find((d): d is OperationDefinitionNode => d.kind === Kind.OPERATION_DEFINITION)
      const found = { kind: (op?.operation === 'mutation' ? 'mutation' : 'query') as Kind_, name: op?.name?.value ?? body.operationName ?? 'anonymous' }
      known.set(hash ?? createHash('sha256').update(body.query).digest('hex'), found)
      return found
    }
    catch {
      // Not valid GraphQL: Apollo will say so.
    }
  }
  return (hash && known.get(hash)) || { kind: 'query', name: body.operationName ?? 'unknown' }
}

/**
 * Gives the client no answer, as a network failure would. A production
 * build closes the connection. In dev, Nuxt proxies each request to Nitro,
 * and the client's connection outlives the one closed here: it would hang
 * until the client's own timeout. So dev answers 502 with no body instead,
 * which the client treats the same way: no answer, try again later.
 */
function drop(event: H3Event) {
  if (import.meta.dev) {
    setResponseStatus(event, 502)
    return ''
  }
  event.node.req.socket.destroy()
  return null
}

function refuse(event: H3Event, status: number, code: string, message: string) {
  setResponseStatus(event, status)
  return { errors: [{ message, extensions: { code } }] }
}

export default defineEventHandler(async (event) => {
  // Protected like a real API: a bearer token is required (any value will do).
  if (!getHeader(event, 'authorization')?.startsWith('Bearer ')) {
    return refuse(event, 401, 'UNAUTHENTICATED', 'Missing bearer token')
  }

  const body = (await readBody<Body>(event)) ?? {}
  const { kind, name } = identify(body)
  // The lab reads its counters through here; it is never in the way of them.
  const lab = name === 'LabStats'
  if (!lab) stats.requests++
  const inScope = !lab && (chaos.scope === 'all' || kind === 'mutation')

  if (!lab && chaos.sessionExpired) {
    stats.unauthorized++
    return refuse(event, 401, 'UNAUTHENTICATED', 'Your session has expired')
  }
  if (inScope && (chaos.dropNext > 0 || Math.random() < chaos.dropRate)) {
    if (chaos.dropNext > 0) chaos.dropNext--
    stats.dropped++
    return drop(event)
  }
  if (inScope && chaos.rateLimitNext > 0) {
    chaos.rateLimitNext--
    stats.rateLimited++
    setResponseHeader(event, 'retry-after', chaos.retryAfterSeconds)
    return refuse(event, 429, 'RATE_LIMITED', 'Too many requests')
  }
  if (inScope && chaos.unavailableNext > 0) {
    chaos.unavailableNext--
    stats.unavailable++
    return refuse(event, 503, 'UNAVAILABLE', 'The server is busy')
  }
  if (inScope && (chaos.latencyMs || chaos.jitterMs)) await sleep(chaos.latencyMs + Math.random() * chaos.jitterMs)

  const server = await (apollo ??= start())
  const headers = new HeaderMap()
  for (const [key, value] of Object.entries(getHeaders(event))) if (value) headers.set(key, value)
  const response = await server.executeHTTPGraphQLRequest({
    httpGraphQLRequest: { method: 'POST', headers, search: '', body },
    context: async () => ({ idempotencyKey: body.extensions?.idempotencyKey }),
  })

  if (kind === 'mutation' && !lab && chaos.loseNext > 0) {
    chaos.loseNext--
    stats.lostAnswers++
    return drop(event)
  }

  for (const [key, value] of response.headers) setResponseHeader(event, key, value)
  setResponseStatus(event, response.status ?? 200)
  if (response.body.kind !== 'complete') throw new Error('Incremental delivery is not supported')
  return response.body.string
})
