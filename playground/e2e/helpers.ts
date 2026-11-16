// What the scenarios share: talking to the lab, starting from a clean slate,
// and reading what the module holds in the page.

import { expect, test as base, type APIRequestContext, type Page } from '@playwright/test'

export interface Stats {
  products: number
  requests: number
  mutations: number
  repeatedKeys: number
  appliedTwice: number
  overlaps: number
  maxConcurrent: number
  dropped: number
  lostAnswers: number
  unauthorized: number
  rateLimited: number
  unavailable: number
  rejected: number
}

/** The lab's REST side door: chaos settings, counters, resets. */
export function lab(request: APIRequestContext) {
  return {
    chaos: (patch: Record<string, unknown>) => request.post('/api/lab/chaos', { data: patch }),
    reset: (products = 2000) => request.post('/api/lab/reset', { data: { products } }),
    stats: async () => ((await (await request.get('/api/lab')).json()) as { stats: Stats }).stats,
  }
}

/** A GraphQL request straight to the server, for checking what it holds. */
export async function serverQuery<T>(request: APIRequestContext, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await request.post('/api/graphql', { data: { query, variables }, headers: { authorization: 'Bearer e2e' } })
  return ((await res.json()) as { data: T }).data
}

/** Waits until the app has hydrated and its client is ready. */
export async function ready(page: Page) {
  await page.waitForFunction(() => !!(document.querySelector('#__nuxt') as unknown as { __vue_app__?: unknown })?.__vue_app__)
  await page.evaluate(() => client().ready)
}

/**
 * Waits until the code of every page has been downloaded (the app preloads it
 * when idle), so the shop can be navigated with the network off.
 */
export async function pagesLoaded(page: Page) {
  await expect.poll(() => page.evaluate(async () => {
    const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { getRoutes: () => { components?: { default?: unknown } }[] } } } } }).__vue_app__
    const routes = app.config.globalProperties.$router.getRoutes()
    return routes.every(r => typeof r.components?.default !== 'function')
  }), { timeout: 15_000 }).toBe(true)
}

/** The queue as the module sees it in the page. */
export function queue(page: Page) {
  return page.evaluate(() => client().state.pending.map(m => ({ document: m.document, status: m.status, variables: m.variables })))
}

/** Waits until nothing is queued or being sent. */
export async function drained(page: Page, timeout = 20_000) {
  await expect.poll(() => page.evaluate(async () => !client().state.syncing && (await client().db.mutations.count()) === 0), { timeout }).toBe(true)
}

/**
 * Every test starts from fresh server data and calm chaos, and every page
 * gets `client()`, the module's client, to read the tables and the queue.
 */
export const test = base.extend<{ clean: undefined }>({
  clean: [async ({ request }, use) => {
    await lab(request).reset()
    await use()
  }, { auto: true }],
  context: async ({ context }, use) => {
    await context.addInitScript(() => {
      (window as unknown as { client: () => unknown }).client = () =>
        (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $airplane: unknown } } } }).__vue_app__.config.globalProperties.$airplane
    })
    await use(context)
  },
})

export { expect }

// The module's client, reached from inside the page: the parts the tests use.
declare global {
  function client(): {
    ready: Promise<void>
    state: { pending: { id: number, document: string, status: string, variables: unknown }[], syncing: boolean, online: boolean, prefetching: number, lastError: string | null, retryAt: number | null }
    db: Record<string, { count: () => Promise<number>, toArray: () => Promise<Record<string, unknown>[]> }>
    enqueue: (name: string, variables: Record<string, unknown>) => Promise<{ id: number }>
    fetchQuery: (name: string, variables?: Record<string, unknown>) => Promise<unknown>
    watchQuery: (name: string, variables?: Record<string, unknown>) => { snapshot: { value: { data: unknown } }, unsubscribe: () => void }
    goOffline: () => void
    goOnline: () => void
    sync: () => Promise<void>
  }
}
