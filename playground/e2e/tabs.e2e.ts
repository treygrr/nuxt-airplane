// Tabs share the database and the queue; a lock lets one of them send it.
// A tab that dies mid-batch leaves changes marked as being sent; the next
// one puts them back and sends them again, with the same idempotency keys.

import { drained, expect, lab, ready, test } from './helpers'

test('scenarios 13 and 14: a tab closed mid-batch hands over, and nothing is applied twice', async ({ context, request }) => {
  const first = await context.newPage()
  await first.goto('/inventory')
  await ready(first)
  const counts = await first.evaluate(async () => {
    await client().fetchQuery('GetSiteItems', { siteId: 'site-1', first: 200 })
    const items = (await client().db.SiteItem.toArray()).slice(0, 12)
    client().goOffline()
    for (const [i, item] of items.entries()) await client().enqueue('UpdateSiteItemOnHand', { siteId: 'site-1', variantId: item.variantId, onHand: 900 + i })
    return items.map((item, i) => ({ variantId: item.variantId as string, onHand: 900 + i }))
  })

  // Slow, so the first tab is mid-batch when it closes.
  await lab(request).chaos({ mutationWorkMs: 400 })
  await first.evaluate(() => client().goOnline())
  await expect.poll(async () => (await lab(request).stats()).mutations).toBeGreaterThanOrEqual(3)
  await first.close()

  // The next tab to open finishes the queue on its own.
  const second = await context.newPage()
  await second.goto('/inventory')
  await ready(second)
  await drained(second, 30_000)
  await lab(request).chaos({ mutationWorkMs: 0 })

  const stats = await lab(request).stats()
  expect(stats.appliedTwice).toBe(0)
  const res = await request.post('/api/graphql', { data: { query: '{ siteItems(siteId: "site-1", first: 500) { edges { node { variantId onHand } } } }' }, headers: { authorization: 'Bearer e2e' } })
  const server = new Map((await res.json() as { data: { siteItems: { edges: { node: { variantId: string, onHand: number } }[] } } }).data.siteItems.edges.map(e => [e.node.variantId, e.node.onHand]))
  expect(counts.every(c => server.get(c.variantId) === c.onHand)).toBe(true)
})

test('a change queued in one tab shows in another at once', async ({ context }) => {
  const one = await context.newPage()
  const two = await context.newPage()
  for (const page of [one, two]) {
    await page.goto('/p/p-1')
    await ready(page)
  }
  await one.evaluate(() => client().goOffline())
  await two.evaluate(() => client().goOffline())
  await one.getByRole('button', { name: 'Add to cart' }).click()
  await expect(two.getByText('1 in your cart')).toBeVisible()
})
