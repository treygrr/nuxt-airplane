// The server's state, and what makes it fight back.
//
// Everything lives in memory and starts from `createSeed`. The chaos settings
// make the server misbehave the way real ones do (slow, dropping connections,
// losing answers, expiring sessions, rate limiting), and the counters record
// what the client did about it: whether it retried with the same idempotency
// key, sent two changes to one thing at once, or had too much in flight.
// The lab page drives both through /api/lab, and the end-to-end tests too.

import { GraphQLError } from 'graphql'
import { createSeed, DEFAULT_PRODUCTS, type Seed } from './seed'

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/** Product count from the environment, so a test or a stress run can choose it at start. */
const initialSize = () => Number(process.env.TOOLSHED_PRODUCTS) || DEFAULT_PRODUCTS

let data: Seed = createSeed(initialSize())
/** Bumped whenever the catalog changes, so cached listings are not served stale. */
let catalogVersion = 0

export const store = () => data
export const catalogStamp = () => catalogVersion
export const catalogChanged = () => void catalogVersion++

let sequence = 0
/** A server-assigned id, like a database sequence: never reused within a run. */
export const nextId = (prefix: string) => `${prefix}-n${++sequence}`

// ---------------------------------------------------------------------------
// Chaos
// ---------------------------------------------------------------------------

export interface Chaos {
  /** Added to every request in scope, in milliseconds. */
  latencyMs: number
  /** Up to this much more, at random. */
  jitterMs: number
  /** Close the connection on the next N requests in scope, before running them. */
  dropNext: number
  /** Close the connection on this share (0 to 1) of requests in scope, before running them. */
  dropRate: number
  /** Run the next N mutations, then close the connection: applied, but the client never hears. */
  loseNext: number
  /** Answer 401 `UNAUTHENTICATED` to everything until it is turned off. */
  sessionExpired: boolean
  /** Answer 429 `RATE_LIMITED` to the next N requests in scope, with `Retry-After`. */
  rateLimitNext: number
  retryAfterSeconds: number
  /** Answer 503 to the next N requests in scope. */
  unavailableNext: number
  /** Reject the next N mutations of a name with a GraphQL error, by mutation field name. */
  rejectNext: Record<string, number>
  /** How long a mutation holds the thing it changes. Widens the window in which two can overlap. */
  mutationWorkMs: number
  /** Answer a repeated idempotency key from the first answer. Off, the mutation is applied again. */
  honorIdempotency: boolean
  /** What latency, drops, rate limits and 503s apply to. Lost answers and rejections only ever hit mutations. */
  scope: 'all' | 'mutations'
}

const calm = (): Chaos => ({
  latencyMs: 0,
  jitterMs: 0,
  dropNext: 0,
  dropRate: 0,
  loseNext: 0,
  sessionExpired: false,
  rateLimitNext: 0,
  retryAfterSeconds: 3,
  unavailableNext: 0,
  rejectNext: {},
  mutationWorkMs: 0,
  honorIdempotency: true,
  scope: 'mutations',
})

export const chaos: Chaos = calm()

/** Changes the settings given and leaves the others. */
export function setChaos(patch: Partial<Chaos>) {
  return Object.assign(chaos, patch, { rejectNext: { ...chaos.rejectNext, ...patch.rejectNext } })
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

export interface LogEntry {
  at: number
  op: string
  entity: string | null
  key: string | null
  outcome: 'applied' | 'repeated' | 'appliedTwice' | 'rejected' | 'failed'
  error?: string
}

const zero = () => ({
  requests: 0,
  mutations: 0,
  repeatedKeys: 0,
  appliedTwice: 0,
  overlaps: 0,
  maxConcurrent: 0,
  dropped: 0,
  lostAnswers: 0,
  unauthorized: 0,
  rateLimited: 0,
  unavailable: 0,
  rejected: 0,
})

export const stats = zero()
let log: LogEntry[] = []
const LOG_MAX = 2000

export const labStats = () => ({ ...stats, products: data.products.length, log: log.map(entry => JSON.stringify(entry)) })

function record(entry: Omit<LogEntry, 'at'>) {
  log.push({ at: Date.now(), ...entry })
  if (log.length > LOG_MAX) log = log.slice(-LOG_MAX)
}

/** Starts over: a fresh catalog of `products` (or the same size), calm settings, zeroed counters, forgotten keys. */
export function reset({ products }: { products?: number } = {}) {
  data = createSeed(products ?? data.products.length)
  catalogVersion++
  Object.assign(chaos, calm())
  Object.assign(stats, zero())
  log = []
  answered.clear()
  seen.clear()
  busy.clear()
  inFlight = 0
}

// ---------------------------------------------------------------------------
// The mutation wrapper
// ---------------------------------------------------------------------------

/** What a request carries that a mutation needs: the key that is the same on each attempt. */
export interface RequestContext {
  idempotencyKey?: string
}

/** First answers, by idempotency key. Only successes: a rejected mutation may be retried and go through. */
const answered = new Map<string, unknown>()
/** Every key a mutation was applied under. */
const seen = new Set<string>()
/** Things a mutation is working on right now, with how many. */
const busy = new Map<string, number>()
let inFlight = 0

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Runs one mutation the way a careful server would, and notes what the
 * client did. `entity` names the one thing it changes, such as
 * `CartLine:l-1`, or `null` for nothing in particular.
 */
export async function mutation<T>(ctx: RequestContext, op: string, entity: string | null, run: () => T): Promise<T> {
  stats.mutations++
  const key = ctx.idempotencyKey ?? null

  if (key && chaos.honorIdempotency && answered.has(key)) {
    stats.repeatedKeys++
    record({ op, entity, key, outcome: 'repeated' })
    return answered.get(key) as T
  }

  if ((chaos.rejectNext[op] ?? 0) > 0) {
    chaos.rejectNext[op]!--
    stats.rejected++
    record({ op, entity, key, outcome: 'rejected' })
    throw new GraphQLError(`${op} was rejected by the lab`, { extensions: { code: 'LAB_REJECTED' } })
  }

  inFlight++
  stats.maxConcurrent = Math.max(stats.maxConcurrent, inFlight)
  if (entity) {
    const others = busy.get(entity) ?? 0
    if (others > 0) stats.overlaps++
    busy.set(entity, others + 1)
  }
  try {
    if (chaos.mutationWorkMs) await sleep(chaos.mutationWorkMs)
    const result = run()
    const twice = !!key && seen.has(key)
    if (twice) stats.appliedTwice++
    if (key) {
      seen.add(key)
      answered.set(key, result)
    }
    record({ op, entity, key, outcome: twice ? 'appliedTwice' : 'applied' })
    return result
  }
  catch (error) {
    record({ op, entity, key, outcome: 'failed', error: (error as Error).message })
    throw error
  }
  finally {
    inFlight--
    if (entity) {
      const left = (busy.get(entity) ?? 1) - 1
      if (left) busy.set(entity, left)
      else busy.delete(entity)
    }
  }
}

/** A rejection the client should show: bad input, not found, out of stock. */
export function fail(code: string, message: string): never {
  throw new GraphQLError(message, { extensions: { code } })
}
