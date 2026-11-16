// The shop at scale: a catalog of 50,000 products kept offline, and queues of
// a thousand changes. Each test measures what it does and holds it to a
// budget, so a change that makes the module slower fails here before a user
// feels it. The budgets are several times what a developer machine takes:
// they catch a change of kind, not of degree.
//
// Not part of the everyday run (the catalog alone takes a while to walk):
//
//   npm run test:e2e:stress

import type { APIRequestContext, Page } from '@playwright/test'
import { drained, expect, lab, ready, test } from './helpers'

const PRODUCTS = 50_000

test.describe.configure({ timeout: 600_000 })

test.beforeEach(async ({ request }) => {
  await request.post('/api/lab/reset', { data: { stress: true } })
})

/** Records a measurement on the test, and holds it to its budget. */
function measured(name: string, ms: number, budget: number) {
  test.info().annotations.push({ type: 'measure', description: `${name}: ${Math.round(ms)} ms (budget ${budget} ms)` })
  expect(ms, `${name} took ${Math.round(ms)} ms, over its budget of ${budget} ms`).toBeLessThan(budget)
}

/** Times a query answered from the tables, as a mounted `useQuery` reads it, and says what came back. */
function timedRead(page: Page, name: string, variables: Record<string, unknown>) {
  return page.evaluate(async ({ name, variables }) => {
    const started = performance.now()
    const watch = client().watchQuery(name, variables)
    while (!watch.snapshot.value.data) await new Promise(resolve => setTimeout(resolve, 1))
    const ms = performance.now() - started
    watch.unsubscribe()
    const first = Object.values(watch.snapshot.value.data as Record<string, { edges?: unknown[], totalCount?: number }>)[0]!
    return { ms, rows: first.edges?.length ?? 1, total: first.totalCount ?? 1 }
  }, { name, variables })
}

/** Everything a site holds on the server, by variant. The server pages at 500. */
async function serverCounts(request: APIRequestContext, siteId: string) {
  const counts = new Map<string, number>()
  for (let after: string | null = null; ;) {
    const res = await request.post('/api/graphql', {
      data: { query: 'query($siteId: ID!, $after: String) { siteItems(siteId: $siteId, first: 500, after: $after) { edges { node { variantId onHand } } pageInfo { hasNextPage endCursor } } }', variables: { siteId, after } },
      headers: { authorization: 'Bearer e2e' },
    })
    const { siteItems } = (await res.json() as { data: { siteItems: { edges: { node: { variantId: string, onHand: number } }[], pageInfo: { hasNextPage: boolean, endCursor: string | null } } } }).data
    for (const { node } of siteItems.edges) counts.set(node.variantId, node.onHand)
    if (!siteItems.pageInfo.hasNextPage) return counts
    after = siteItems.pageInfo.endCursor
  }
}

/**
 * Walks a whole site into the tables, then queues one on-hand count for each
 * of its first `n` items, offline. Says what was queued and what each cost.
 */
async function queueCounts(page: Page, n: number) {
  await page.evaluate(() => client().fetchQuery('GetSiteItems', { siteId: 'site-1', first: 200 }))
  await expect.poll(() => page.evaluate(() => client().state.prefetching), { timeout: 120_000 }).toBe(0)
  return page.evaluate(async (n) => {
    const items = (await client().db.SiteItem.toArray()).filter(i => i.siteId === 'site-1').slice(0, n)
    client().goOffline()
    const each: number[] = []
    for (const [i, item] of items.entries()) {
      const started = performance.now()
      await client().enqueue('UpdateSiteItemOnHand', { siteId: 'site-1', variantId: item.variantId, onHand: 1000 + i })
      each.push(performance.now() - started)
    }
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    return {
      ms: each.reduce((a, b) => a + b, 0),
      first: mean(each.slice(0, 50)),
      last: mean(each.slice(-50)),
      counts: items.map((item, i) => ({ variantId: item.variantId as string, onHand: 1000 + i })),
    }
  }, n)
}

test('keeps a catalog of 50,000 products offline, and reads it fast', async ({ page, context }) => {
  const started = Date.now()
  await page.goto('/')
  await ready(page)
  // The home page starts the walk of every page of the catalog.
  await expect.poll(() => page.evaluate(() => client().db.Product.count()), { timeout: 300_000, intervals: [1000] }).toBe(PRODUCTS)
  await expect.poll(() => page.evaluate(() => client().state.prefetching), { timeout: 60_000 }).toBe(0)
  measured('walking the catalog', Date.now() - started, 120_000)

  await context.setOffline(true)
  // A page of the whole catalog walks an index: it does not load the table.
  const first = await timedRead(page, 'GetProducts', { first: 24 })
  expect(first).toMatchObject({ rows: 24, total: PRODUCTS })
  measured('first page by name', first.ms, 500)
  const deep = await timedRead(page, 'GetProducts', { first: 24, sort: 'PRICE_ASC', after: btoa(`o:${PRODUCTS - 1000}`) })
  expect(deep.rows).toBe(24)
  measured('a page 49,000 in, by price', deep.ms, 3000)
  // A search looks at every product.
  const search = await timedRead(page, 'GetProducts', { first: 24, search: 'level' })
  expect(search.total).toBeGreaterThan(100)
  measured('searching every product', search.ms, 5000)
  const product = await timedRead(page, 'GetProduct', { id: 'p-49999' })
  measured('one product', product.ms, 500)
})

test('queues 1,000 changes offline and lands every one, once', async ({ page, request }) => {
  await page.goto('/inventory')
  await ready(page)
  const queued = await queueCounts(page, 1000)
  expect(queued.counts).toHaveLength(1000)
  // Far more than it should take: see the next test.
  measured('queueing 1,000 changes', queued.ms, 180_000)
  expect(await page.evaluate(() => client().db.mutations.count())).toBe(1000)

  const started = Date.now()
  await page.evaluate(() => client().goOnline())
  await drained(page, 300_000)
  measured('draining 1,000 changes', Date.now() - started, 180_000)

  const server = await serverCounts(request, 'site-1')
  expect(queued.counts.filter(c => server.get(c.variantId) !== c.onHand)).toEqual([])
  const stats = await lab(request).stats()
  expect(stats.mutations).toBe(1000)
  expect(stats.appliedTwice).toBe(0)
})

test('queueing a change costs the same however long the queue is', async ({ page }) => {
  // It does not yet: every change queued reads the whole queue, so the
  // 400th costs several times the first (FINDINGS.md, 11). Marked as failing
  // until the module is changed; this test then passes and says so.
  test.fail()
  await page.goto('/inventory')
  await ready(page)
  const queued = await queueCounts(page, 400)
  test.info().annotations.push({ type: 'measure', description: `a change queued: ${queued.first.toFixed(1)} ms into an empty queue, ${queued.last.toFixed(1)} ms into one of 400` })
  expect(queued.last).toBeLessThan(queued.first * 3)
})

test('a reload halfway through a long queue finishes it, and applies nothing twice', async ({ page, request }) => {
  await page.goto('/inventory')
  await ready(page)
  const queued = await queueCounts(page, 600)
  await page.evaluate(() => client().goOnline())
  await expect.poll(async () => (await lab(request).stats()).mutations, { timeout: 60_000, intervals: [100] }).toBeGreaterThanOrEqual(200)

  const started = Date.now()
  await page.reload()
  await ready(page)
  measured('starting with a queue waiting', Date.now() - started, 15_000)
  await drained(page, 300_000)

  const server = await serverCounts(request, 'site-1')
  expect(queued.counts.filter(c => server.get(c.variantId) !== c.onHand)).toEqual([])
  expect((await lab(request).stats()).appliedTwice).toBe(0)
})

test('sorts a site of thousands of items offline', async ({ page, context }) => {
  await page.goto('/inventory')
  await ready(page)
  await page.evaluate(() => client().fetchQuery('GetSiteItems', { siteId: 'site-1', first: 200 }))
  await expect.poll(() => page.evaluate(() => client().state.prefetching), { timeout: 120_000 }).toBe(0)
  const held = await page.evaluate(async () => (await client().db.SiteItem.toArray()).filter(i => i.siteId === 'site-1').length)
  expect(held).toBeGreaterThan(10_000)

  await context.setOffline(true)
  const byLevel = await timedRead(page, 'GetSiteItems', { siteId: 'site-1', first: 25, sort: 'LEVEL' })
  expect(byLevel).toMatchObject({ rows: 25, total: held })
  measured(`a page of ${held.toLocaleString('en-US')} items by stock level`, byLevel.ms, 3000)
  const search = await timedRead(page, 'GetSiteItems', { siteId: 'site-1', first: 25, search: 'hammer', sort: 'ON_HAND', descending: true })
  expect(search.total).toBeGreaterThan(0)
  measured('searching the site', search.ms, 3000)
})
