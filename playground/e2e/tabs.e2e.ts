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

test('"Work offline" holds after a reload and in a second tab, until it is turned off', async ({ context, request }) => {
  /** The sync chip in the app bar: "Offline" while held, its menu has the switch. */
  const chip = (page: import('@playwright/test').Page) => page.locator('header .v-chip').filter({ hasText: /Offline|Synced|pending|Syncing|failed/ })
  async function setOffline(page: import('@playwright/test').Page, offline: boolean) {
    await chip(page).click()
    const toggle = page.getByLabel('Work offline')
    await (offline ? toggle.check() : toggle.uncheck())
    await page.keyboard.press('Escape')
  }

  const one = await context.newPage()
  await one.goto('/p/p-1')
  await ready(one)
  const before = (await lab(request).stats()).mutations
  await setOffline(one, true)
  await expect(chip(one)).toHaveText('Offline')
  await one.getByRole('button', { name: 'Add to cart' }).click()
  await expect(one.getByText('1 in your cart')).toBeVisible()

  // A reload comes back offline and sends nothing, and the page rendered
  // online on the server hydrates without a mismatch.
  const mismatches: string[] = []
  one.on('console', m => /hydration/i.test(m.text()) && mismatches.push(m.text()))
  await one.reload()
  await ready(one)
  await expect(chip(one)).toHaveText('Offline')
  expect(mismatches).toEqual([])
  // A tab opened now holds back the shared queue too.
  const two = await context.newPage()
  await two.goto('/p/p-1')
  await ready(two)
  await expect(chip(two)).toHaveText('Offline')
  await two.waitForTimeout(500)
  expect((await lab(request).stats()).mutations).toBe(before)

  // Turned off in the second tab: the first follows, and the queue goes.
  await setOffline(two, false)
  await expect(chip(one)).not.toHaveText('Offline')
  await drained(two)
  expect((await lab(request).stats()).mutations).toBe(before + 1)
})
