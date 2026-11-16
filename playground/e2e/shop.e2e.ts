// The shop, used the way a shopper would, with the network really off
// (Playwright's offline mode) where the scenario says offline.

import { drained, expect, pagesLoaded, queue, ready, serverQuery, test } from './helpers'

interface Cart { cart: { lines: { variantName: string, quantity: number }[] } }

test('browses, searches and opens products offline, once the catalog is kept', async ({ page, context }) => {
  await page.goto('/')
  await ready(page)
  // "Keep the catalog offline" is on by default: the home page starts the walk.
  await expect.poll(() => page.evaluate(() => client().db.Product.count()), { timeout: 30_000 }).toBe(2000)
  await expect.poll(() => page.evaluate(() => client().state.prefetching)).toBe(0)

  await pagesLoaded(page)
  await context.setOffline(true)
  await page.locator('a.v-card[href="/c/cat-2"]').click()
  await expect(page.getByRole('heading', { name: 'Hand Tools' })).toBeVisible()
  await expect(page.getByText('305 products').first()).toBeVisible()

  // Found by role: Vuetify drops the placeholder once there is text.
  const search = page.locator('header input[role="combobox"]')
  await search.fill('level')
  await search.press('Enter')
  await expect(page.getByRole('heading', { name: 'Results for “level”' })).toBeVisible()
  await expect(page.getByText('78 products')).toBeVisible()

  await page.locator('a[href^="/p/"]').first().click()
  await expect(page.getByRole('button', { name: 'Add to cart' })).toBeVisible()
})

test('scenario 2: tapping one quantity up offline becomes one change', async ({ page, context, request }) => {
  await page.goto('/p/p-1')
  await ready(page)
  await expect(page.getByRole('button', { name: 'Add to cart' })).toBeVisible()
  await pagesLoaded(page)

  await context.setOffline(true)
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await page.getByRole('link', { name: 'Cart' }).first().click()
  await expect(page.getByRole('heading', { name: /Your cart/ })).toBeVisible()
  const increment = page.locator('.v-number-input').first().locator('button').last()
  for (let n = 0; n < 9; n++) await increment.click()
  await expect(page.locator('.v-number-input input').first()).toHaveValue('10')
  // The add, and one quantity change standing for nine.
  await expect.poll(async () => (await queue(page)).map(m => m.document)).toEqual(['AddCartLine', 'SetCartLineQuantity'])

  await context.setOffline(false)
  await drained(page)
  const { cart } = await serverQuery<Cart>(request, '{ cart { lines { variantName quantity } } }')
  expect(cart.lines.map(l => l.quantity)).toEqual([10])
})

test('scenario 1: an offline shopping trip lands as it was made', async ({ page, context, request }) => {
  // Online first: products, the account, and the pages to visit offline.
  await page.goto('/account')
  await ready(page)
  await expect(page.getByRole('heading', { name: 'Addresses' })).toBeVisible()
  for (const id of ['p-1', 'p-2', 'p-3']) {
    await page.goto(`/p/${id}`)
    await expect(page.getByRole('button', { name: 'Add to cart' })).toBeVisible()
  }

  await pagesLoaded(page)
  await context.setOffline(true)
  // Two products into the cart, as their Add to cart buttons would.
  await page.evaluate(async () => {
    const variants = await client().db.Variant.toArray()
    for (const productId of ['p-2', 'p-3']) {
      const variant = variants.find(v => v.productId === productId && (v.stock as number) > 2)!
      await client().enqueue('AddCartLine', { variantId: variant.id, quantity: 1 })
    }
  })
  await page.getByRole('link', { name: 'Cart' }).first().click()
  await expect(page.getByText('Not synced').first()).toBeVisible()
  await page.locator('.v-number-input').first().locator('button').last().click()
  await page.getByRole('button', { name: 'Remove' }).last().click()

  await page.locator('footer').getByRole('link', { name: 'Account', exact: true }).click()
  await page.getByRole('button', { name: 'Add an address' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('Alex Rivera')
  await dialog.getByLabel('Street address').fill('9 Jobsite Road')
  await dialog.getByLabel('City').fill('Bend')
  await dialog.getByLabel('State').fill('OR')
  await dialog.getByLabel('ZIP').fill('97701')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await page.locator('.v-card', { hasText: '9 Jobsite Road' }).getByRole('button', { name: 'Make default' }).click()

  await expect.poll(async () => (await queue(page)).map(m => m.document))
    .toEqual(expect.arrayContaining(['AddCartLine', 'SetCartLineQuantity', 'RemoveCartLine', 'CreateAddress', 'SetDefaultAddress']))
  const shown = await page.evaluate(() => client().db.CartLine.toArray())

  await context.setOffline(false)
  await drained(page)
  const server = await serverQuery<Cart & { addresses: { line1: string, isDefault: boolean }[] }>(request, '{ cart { lines { variantName quantity } } addresses { line1 isDefault } }')
  expect(server.cart.lines.map(l => l.quantity).sort()).toEqual(shown.map(l => l.quantity as number).sort())
  expect(server.addresses.find(a => a.isDefault)?.line1).toBe('9 Jobsite Road')
  expect(await page.evaluate(() => client().db.base.count())).toBe(0)
})

test('scenario 15: checkout sends the order after the queue, and not offline', async ({ page, context, request }) => {
  await page.goto('/p/p-1')
  await ready(page)
  await page.getByRole('button', { name: 'Add to cart' }).click()
  await page.getByRole('link', { name: 'Cart' }).first().click()
  await drained(page)

  // A quantity change still on its way when the order is placed.
  await request.post('/api/lab/chaos', { data: { latencyMs: 800 } })
  await page.locator('.v-number-input').first().locator('button').last().click()
  await page.getByRole('link', { name: 'Check out' }).click()
  await page.getByRole('button', { name: 'Place order' }).click()
  await expect(page).toHaveURL(/\/orders\/.+\?placed=1/, { timeout: 15_000 })
  await expect(page.getByText('Thank you, your order is in')).toBeVisible()
  await expect(page.getByText('2 × ')).toBeVisible()
  await request.post('/api/lab/chaos', { data: { latencyMs: 0 } })

  // Offline, there is nothing to place it with.
  await page.getByRole('button', { name: 'Order again' }).click()
  await drained(page)
  await page.getByRole('link', { name: 'Cart' }).first().click()
  await page.getByRole('link', { name: 'Check out' }).click()
  await context.setOffline(true)
  await expect(page.getByRole('button', { name: 'Place order' })).toBeDisabled()
  await expect(page.getByText('You are offline. Placing an order needs a connection')).toBeVisible()
})
