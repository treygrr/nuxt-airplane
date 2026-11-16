// The queue under a server that fights back: rejections, lost answers, an
// expired session, rate limits, and many changes at once.

import { drained, expect, lab, queue, ready, test } from './helpers'

/** Queues on-hand counts for `n` items at one site, offline, and returns what each should end up as. */
async function queueCounts(page: import('@playwright/test').Page, n: number, base: number) {
  return page.evaluate(async ({ n, base }) => {
    await client().fetchQuery('GetSiteItems', { siteId: 'site-1', first: 200 })
    const items = (await client().db.SiteItem.toArray()).slice(0, n)
    client().goOffline()
    for (const [i, item] of items.entries()) await client().enqueue('UpdateSiteItemOnHand', { siteId: 'site-1', variantId: item.variantId, onHand: base + i })
    return items.map((item, i) => ({ variantId: item.variantId as string, onHand: base + i }))
  }, { n, base })
}

async function serverCounts(request: import('@playwright/test').APIRequestContext) {
  const res = await request.post('/api/graphql', { data: { query: '{ siteItems(siteId: "site-1", first: 500) { edges { node { variantId onHand } } } }' }, headers: { authorization: 'Bearer e2e' } })
  const body = await res.json() as { data: { siteItems: { edges: { node: { variantId: string, onHand: number } }[] } } }
  return new Map(body.data.siteItems.edges.map(e => [e.node.variantId, e.node.onHand]))
}

test('scenario 3: a failed create holds back its chain, and clearing failures takes it all', async ({ page, request }) => {
  await page.goto('/p/p-5')
  await ready(page)
  await page.evaluate(() => client().goOffline())
  await page.getByRole('button', { name: 'Save to a list' }).click()
  await page.getByText('New list…').click()
  await page.getByRole('dialog').getByLabel('Name').fill('Doomed')
  await page.getByRole('dialog').getByRole('button', { name: 'Create and save' }).click()
  await expect.poll(async () => (await queue(page)).map(m => m.document)).toEqual(['CreateWishlist', 'AddWishlistItem'])

  await lab(request).chaos({ rejectNext: { createWishlist: 1 } })
  await page.evaluate(() => client().goOnline())
  await expect(page.getByText('Not saved: Create the list "Doomed"')).toBeVisible()
  await page.locator('.v-snackbar').getByRole('button', { name: 'Review' }).click()
  const drawer = page.locator('.v-navigation-drawer', { hasText: 'Pending changes' })
  await expect(drawer.getByText('Failed').first()).toBeVisible()
  await expect(drawer.getByText('Held back', { exact: true })).toBeVisible()

  await drawer.getByRole('button', { name: 'Clear failures' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Clear' }).click()
  await expect(drawer.getByText('All synced')).toBeVisible()
  expect(await page.evaluate(() => client().db.Wishlist.toArray())).not.toContainEqual(expect.objectContaining({ name: 'Doomed' }))
})

test('scenario 4: one rejected change does not hold back the others', async ({ page, request }) => {
  await page.goto('/inventory')
  await ready(page)
  const counts = await queueCounts(page, 10, 300)
  // The fifth one is rejected.
  await page.evaluate(() => client().enqueue('RenameSite', { id: 'site-2', name: 'bad' }))
  await lab(request).chaos({ rejectNext: { renameSite: 1 } })
  await page.evaluate(() => client().goOnline())
  await expect.poll(async () => (await queue(page)).map(m => `${m.document}:${m.status}`)).toEqual(['RenameSite:failed'])
  const server = await serverCounts(request)
  expect(counts.every(c => server.get(c.variantId) === c.onHand)).toBe(true)
})

test('scenario 5: a lost answer is retried once, with the same key', async ({ page, request }) => {
  await page.goto('/p/p-1')
  await ready(page)
  await lab(request).chaos({ loseNext: 1 })
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await drained(page)
  const stats = await lab(request).stats()
  expect(stats.lostAnswers).toBe(1)
  expect(stats.repeatedKeys).toBe(1)
  expect(stats.appliedTwice).toBe(0)
  const res = await request.post('/api/graphql', { data: { query: '{ cart { lines { quantity } } }' }, headers: { authorization: 'Bearer e2e' } })
  expect((await res.json() as { data: { cart: { lines: unknown[] } } }).data.cart.lines).toHaveLength(1)
})

test('scenario 6: an expired session stops the sync without failing anything', async ({ page, request }) => {
  await page.goto('/inventory')
  await ready(page)
  const counts = await queueCounts(page, 20, 500)
  await lab(request).chaos({ mutationWorkMs: 150 })
  await page.evaluate(() => client().goOnline())
  await expect.poll(async () => (await lab(request).stats()).mutations).toBeGreaterThanOrEqual(5)
  await lab(request).chaos({ sessionExpired: true })
  await expect.poll(() => page.evaluate(() => !client().state.syncing && client().state.lastError)).toBe('Your session has expired')
  expect(new Set((await queue(page)).map(m => m.status))).toEqual(new Set(['pending']))

  await lab(request).chaos({ sessionExpired: false, mutationWorkMs: 0 })
  await page.evaluate(() => client().sync())
  await drained(page)
  const server = await serverCounts(request)
  expect(counts.every(c => server.get(c.variantId) === c.onHand)).toBe(true)
  expect((await lab(request).stats()).appliedTwice).toBe(0)
})

test('scenario 7: a rate limit is waited out as the server asked', async ({ page, request }) => {
  await page.goto('/')
  await ready(page)
  await lab(request).chaos({ rateLimitNext: 1, retryAfterSeconds: 3 })
  const started = Date.now()
  await page.evaluate(() => client().enqueue('SetMarketingOptIn', { optIn: true }))
  await drained(page, 10_000)
  expect(Date.now() - started).toBeGreaterThan(2800)
  expect((await lab(request).stats()).rateLimited).toBe(1)
})

test('scenario 8: unrelated changes go four at a time, never two on one thing', async ({ page, request }) => {
  await page.goto('/inventory')
  await ready(page)
  const counts = await queueCounts(page, 40, 800)
  await lab(request).chaos({ mutationWorkMs: 150 })
  const started = Date.now()
  await page.evaluate(() => client().goOnline())
  await drained(page)
  const elapsed = Date.now() - started
  const stats = await lab(request).stats()
  expect(stats.maxConcurrent).toBe(4)
  expect(stats.overlaps).toBe(0)
  // One at a time would take at least 40 × 150 ms.
  expect(elapsed).toBeLessThan(40 * 150)
  const server = await serverCounts(request)
  expect(counts.every(c => server.get(c.variantId) === c.onHand)).toBe(true)
})
