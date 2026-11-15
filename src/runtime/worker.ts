// The engine in a web worker.
//
// Everything that writes to the tables (`store`, `apply`, `reconcile`, the
// two layers) can run off the main thread, so a large response or a long
// queue does not hold up the page. The client stays where it is: it talks to
// the network, runs `read` for the components, and asks the worker for each
// write with a message. Both open the same database, and Dexie tells the
// live queries on the page about what the worker committed.

import { createEngine, type AirplaneEngineOptions } from './engine'
import { collect } from './collect'
import { isQuotaError } from './db'
import type { AirplaneEngine, AirplaneRuntimeConfig } from './types'

/** What the page tells the worker to start it: the configuration and what the build made of the documents. */
export type WorkerInit = AirplaneRuntimeConfig & Partial<Pick<AirplaneEngineOptions, 'documents' | 'documentsHash' | 'entities' | 'unusedEntities'>>

/** The two ends of a message channel: a `Worker` seen from the page, or the worker's own scope. */
export interface Port {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message' | 'error', listener: (event: { data?: unknown, message?: string }) => void) => void
}

interface Call { id: number, method: keyof AirplaneEngine, args: unknown[] }
interface Reply { id: number, result?: unknown, error?: { name: string, message: string, stack?: string, quota: boolean } }
interface Init { init: WorkerInit }

const METHODS: (keyof AirplaneEngine)[] = ['ready', 'storeResponse', 'enqueue', 'acknowledge', 'rollback', 'reconcile', 'clearCache', 'clear', 'evict']

/** The page's side: an engine whose every call is a message to the worker. */
export function remoteEngine(port: Port, config: WorkerInit): AirplaneEngine {
  let next = 0
  const waiting = new Map<number, { resolve: (value: unknown) => void, reject: (error: Error) => void }>()
  // A worker that could not load, or threw outside a call, will answer nothing: say so instead of waiting for ever.
  let broken: Error | undefined
  port.addEventListener('error', (event) => {
    broken = new Error(`[nuxt-airplane] The worker failed${event.message ? `: ${event.message}` : ''}. Set \`handlers.worker\` to false in the module options to run the handlers on the page.`)
    for (const call of waiting.values()) call.reject(broken)
    waiting.clear()
  })
  port.addEventListener('message', ({ data }) => {
    const { id, result, error } = data as Reply
    const call = waiting.get(id)
    if (!call) return
    waiting.delete(id)
    if (!error) return call.resolve(result)
    // An error does not cross as itself. Rebuilt, with what the client looks at.
    const rebuilt = Object.assign(new Error(error.message), { name: error.quota ? 'QuotaExceededError' : error.name })
    if (error.stack) rebuilt.stack = error.stack
    call.reject(rebuilt)
  })
  /**
   * Posts a message. What a component hands over is often a reactive proxy,
   * which cannot be copied as it is. Variables and responses are JSON by
   * nature, so that is how they go when the plain copy is refused.
   */
  const post = (message: Init | Call) => {
    try {
      port.postMessage(message)
    }
    catch (error) {
      if ((error as Error).name !== 'DataCloneError') throw error
      port.postMessage(JSON.parse(JSON.stringify(message)))
    }
  }
  post({ init: config })
  const call = (method: keyof AirplaneEngine) => (...args: unknown[]) => new Promise((resolve, reject) => {
    if (broken) return reject(broken)
    const id = next++
    waiting.set(id, { resolve, reject })
    try {
      post({ id, method, args })
    }
    catch (error) {
      // Something that cannot be sent to the worker at all, such as a function in the variables.
      waiting.delete(id)
      reject(error as Error)
    }
  })
  return Object.fromEntries(METHODS.map(method => [method, call(method)])) as unknown as AirplaneEngine
}

/** The worker's side: answers each call with what `engine` returns. */
export function serveEngine(port: Port, engine: (init: Required<WorkerInit>) => AirplaneEngine) {
  let serving: AirplaneEngine | undefined
  port.addEventListener('message', async ({ data }) => {
    if ((data as Init).init) {
      serving = engine((data as Init).init as Required<WorkerInit>)
      return
    }
    const { id, method, args } = data as Call
    try {
      if (!serving || !METHODS.includes(method)) throw new Error(`[nuxt-airplane] The worker cannot answer "${String(method)}"`)
      const result = await (serving[method] as (...args: unknown[]) => Promise<unknown>)(...args)
      port.postMessage({ id, result } satisfies Reply)
    }
    catch (thrown) {
      const error = thrown instanceof Error ? thrown : new Error(String(thrown))
      port.postMessage({ id, error: { name: error.name, message: error.message, stack: error.stack, quota: isQuotaError(error) } } satisfies Reply)
    }
  })
}

/** Called by the generated worker entry with the default exports of the handler files. */
export function startWorker(handlers: unknown[], port: Port = globalThis as unknown as Port) {
  serveEngine(port, init => createEngine({ ...init, ...collect(handlers) }))
}
