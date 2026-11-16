// Inventory levels and restock carts: a site that tracks inventory keeps each
// item between a min and a max, and restocks from a cart; checking the cart
// out adds its quantities to what the site holds. Some variants come in boxes
// or have a minimum order, and the cart keeps to both.

import type { APIRequestContext } from '@playwright/test'
import { drained, expect, pagesLoaded, queue, ready, serverQuery, test } from './helpers'

interface Item { variantId: string, onHand: number, min: number, max: number, boxQuantity: number | null, minOrderQuantity: number | null }
interface Variant { id: string, name: string, sku: string, boxQuantity: number | null, minOrderQuantity: number | null }

/** Everything a site holds, as the server has it. */
async function siteItems(request: APIRequestContext, siteId: string) {
  const items: Item[] = []
  let after: string | null = null
  for (;;) {
    const { siteItems: page } = await serverQuery<{ siteItems: { edges: { node: Item }[], pageInfo: { hasNextPage: boolean, endCursor: string } } }>(request,
      'query($siteId: ID!, $after: String) { siteItems(siteId: $siteId, first: 500, after: $after) { edges { node { variantId onHand min max boxQuantity minOrderQuantity } } pageInfo { hasNextPage endCursor } } }', { siteId, after })
    items.push(...page.edges.map(e => e.node))
    if (!page.pageInfo.hasNextPage) return new Map(items.map(i => [i.variantId, i]))
    after = page.pageInfo.endCursor
  }
}

/** A product whose first variant comes in boxes and is not at the site yet. */
async function boxedProduct(request: APIRequestContext, siteId: string) {
  const held = await siteItems(request, siteId)
  const { products } = await serverQuery<{ products: { edges: { node: { id: string, name: string, variants: Variant[] } }[] } }>(request,
    '{ products(first: 500) { edges { node { id name variants { id name sku boxQuantity minOrderQuantity } } } } }')
  const product = products.edges.map(e => e.node).find(p => p.variants[0]!.boxQuantity && !p.variants[0]!.minOrderQuantity && !held.has(p.variants[0]!.id))
  if (!product) throw new Error('No boxed product to add')
  return { product, variant: product.variants[0]! }
}

test('adds a product in the modal, restocks it from the cart in whole boxes', async ({ page, request }) => {
  const { product, variant } = await boxedProduct(request, 'site-1')
  const box = variant.boxQuantity!
  await page.goto('/inventory/site-1')
  await ready(page)
  // A site that tracks inventory has a restock cart.
  await expect(page.getByRole('link', { name: 'Restock cart' })).toBeVisible()

  // Step 1: the product. Step 2: its levels.
  await page.getByRole('button', { name: 'Add product' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Search products').fill(product.name)
  await page.getByRole('option', { name: product.name }).first().click()
  await expect(dialog.getByText(`Box of ${box}`).first()).toBeVisible()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await dialog.getByLabel('Current inventory').fill('2')
  await dialog.getByLabel('Min', { exact: true }).fill('10')
  await dialog.getByLabel('Max', { exact: true }).fill('30')
  // Up to 30 from 2 is 28, in whole boxes.
  const first = Math.ceil(28 / box) * box
  await expect(dialog.getByText(`Below min: add ${first} to the restock cart`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Add to site' }).click()
  // The add is queued a moment after the click: wait for the server to have it.
  await expect.poll(async () => (await siteItems(request, 'site-1')).get(variant.id)).toMatchObject({ onHand: 2, min: 10, max: 30 })
  await drained(page)

  // The cart has it, and keeps to whole boxes: a typed 1 becomes one box.
  await page.getByRole('link', { name: 'Restock cart' }).click()
  await expect(page).toHaveURL(/view=inventory/)
  const card = page.locator('.v-card', { hasText: 'North Warehouse' })
  const row = card.locator('tr', { hasText: variant.sku })
  await expect(row.locator('input')).toHaveValue(String(first))
  await row.locator('input').fill('1')
  await row.locator('input').blur()
  await expect(row.locator('input')).toHaveValue(String(box))
  await expect.poll(async () => (await serverQuery<{ siteCartLines: { quantity: number }[] }>(request, '{ siteCartLines(siteId: "site-1") { quantity } }')).siteCartLines.map(l => l.quantity)).toEqual([box])

  // Server-side, a quantity that is not whole boxes is turned down.
  const rejected = await request.post('/api/graphql', {
    data: { query: `mutation { setSiteCartLineQuantity(siteId: "site-1", variantId: "${variant.id}", quantity: ${box + 1}) { quantity } }` },
    headers: { authorization: 'Bearer e2e' },
  })
  expect(JSON.stringify(await rejected.json())).toContain(`comes in boxes of ${box}`)

  await card.getByRole('button', { name: /Check out/ }).click()
  await expect.poll(async () => (await siteItems(request, 'site-1')).get(variant.id)!.onHand).toBe(2 + box)
  await expect(page.getByText('No restocks waiting')).toBeVisible()
})

test('restocks offline: the counts go up at once and reach the server in order', async ({ page, context, request }) => {
  await page.goto('/inventory/site-1')
  await ready(page)
  const firstRow = page.locator('.v-data-table tbody tr').first()
  await expect(firstRow.locator('.v-chip', { hasText: /Below min|In range|Over max/ })).toBeVisible()
  const before = await siteItems(request, 'site-1')
  await pagesLoaded(page)

  await context.setOffline(true)
  // Two items into the cart, the first one twice (what it needs, then a
  // typed quantity on top): one change for it.
  const rows = page.locator('.v-data-table tbody tr')
  await rows.nth(0).getByRole('button', { name: /restock cart/ }).click()
  await rows.nth(1).getByRole('button', { name: /restock cart/ }).click()
  await expect(rows.nth(0).locator('[data-test="in-cart"]')).toHaveText(/\d+/)
  await rows.nth(0).locator('td input').fill('5')
  await rows.nth(0).getByRole('button', { name: /restock cart/ }).click()
  await expect.poll(async () => (await queue(page)).map(m => m.document)).toEqual(['AddSiteCartLine', 'AddSiteCartLine'])

  await page.getByRole('link', { name: 'Restock cart' }).click()
  const card = page.locator('.v-card', { hasText: 'North Warehouse' })
  const lines = await page.evaluate(() => client().db.SiteCartLine.toArray())
  expect(lines).toHaveLength(2)
  await card.getByRole('button', { name: /Check out/ }).click()
  await expect(page.getByText('No restocks waiting')).toBeVisible()
  // Offline, the site already holds more.
  const local = await page.evaluate(() => client().db.SiteItem.toArray())
  for (const line of lines) {
    const variantId = line.variantId as string
    expect(local.find(i => i.variantId === variantId)!.onHand).toBe(before.get(variantId)!.onHand + (line.quantity as number))
  }

  await context.setOffline(false)
  await drained(page)
  const after = await siteItems(request, 'site-1')
  for (const line of lines) {
    const variantId = line.variantId as string
    expect(after.get(variantId)!.onHand).toBe(before.get(variantId)!.onHand + (line.quantity as number))
  }
})

test('a site opts out of tracking: its levels and cart go', async ({ page, request }) => {
  await page.goto('/inventory/site-1')
  await ready(page)
  await page.locator('.v-data-table tbody tr').first().getByRole('button', { name: /restock cart/ }).click()
  await expect.poll(async () => (await serverQuery<{ siteCartLines: unknown[] }>(request, '{ siteCartLines(siteId: "site-1") { id } }')).siteCartLines).toHaveLength(1)

  // Site options → Edit site: the name and tracking, together.
  await page.getByRole('button', { name: 'Site options' }).click()
  await page.getByText('Edit site').click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Name').fill('North Warehouse (old)')
  await dialog.getByLabel('Track inventory levels').click()
  await expect(dialog.getByText('Turning tracking off empties this site\'s restock cart.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('heading', { name: 'North Warehouse (old)' })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: 'Min' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Restock cart' })).toHaveCount(0)
  await expect.poll(async () => (await serverQuery<{ siteCartLines: unknown[] }>(request, '{ siteCartLines(siteId: "site-1") { id } }')).siteCartLines).toHaveLength(0)
  // Two changes to different fields of the site: they may land in either order.
  await expect.poll(async () => (await serverQuery<{ site: { name: string, tracksInventory: boolean } }>(request, '{ site(id: "site-1") { name tracksInventory } }')).site)
    .toEqual({ name: 'North Warehouse (old)', tracksInventory: false })

  // A site that does not track has no cart to add to.
  await page.goto('/inventory/site-2')
  await expect(page.getByRole('columnheader', { name: 'On hand' })).toBeVisible()
  await expect(page.getByRole('button', { name: /restock cart/ })).toHaveCount(0)
})

test('each row offers what it needs to fill up, and its menu adjusts the count', async ({ page, request }) => {
  await page.goto('/inventory/site-1')
  await ready(page)
  const row = page.locator('.v-data-table tbody tr').first()
  await expect(row.locator('.v-chip', { hasText: /Below min|In range|Over max/ })).toBeVisible()

  // On hand is shown, not edited, in the table.
  const onHand = Number((await row.locator('td').nth(2).textContent() ?? '').replace(/,/g, ''))
  await expect(row.locator('td').nth(2).locator('input')).toHaveCount(0)

  // The restock field holds what fills the item to its max; Add puts that in the cart.
  const max = Number(await row.locator('td').nth(4).textContent() ?? '')
  const wanted = Number(await row.locator('td input').inputValue())
  expect(wanted).toBeGreaterThanOrEqual(max - onHand)
  await row.getByRole('button', { name: /restock cart/ }).click()
  await expect(row.locator('[data-test="in-cart"]')).toHaveText(String(wanted))
  await expect(row.locator('td input')).toHaveValue('0')
  await expect(row.getByRole('button', { name: /restock cart/ })).toHaveAttribute('aria-disabled', 'true')

  // Adjusting on hand is in the row's menu.
  await row.getByRole('button', { name: /Actions for/ }).click()
  await page.getByRole('menuitem', { name: 'Adjust on hand' }).or(page.getByText('Adjust on hand')).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('On hand').fill(String(onHand + 7))
  await expect(dialog.getByText(`+7 from ${onHand}`)).toBeVisible()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(row.locator('td').nth(2)).toHaveText((onHand + 7).toLocaleString('en-US'))
  await expect.poll(async () => (await serverQuery<{ siteCartLines: { quantity: number }[] }>(request, '{ siteCartLines(siteId: "site-1") { quantity } }')).siteCartLines.map(l => l.quantity)).toEqual([wanted])
})

test('fill all to max carts what every item at the site needs, in quantities that may be ordered', async ({ page, request }) => {
  await page.goto('/inventory/site-1')
  await ready(page)
  await expect(page.locator('.v-data-table tbody tr').first()).toBeVisible()
  const held = [...(await siteItems(request, 'site-1')).values()]
  const short = held.filter(i => i.max > i.onHand)

  await page.getByRole('button', { name: 'Site options' }).click()
  await page.getByText('Fill all to max').click()
  // Every item short of its max, across every page, not just the one shown.
  await expect.poll(async () => (await serverQuery<{ siteCartLines: unknown[] }>(request, '{ siteCartLines(siteId: "site-1") { id } }')).siteCartLines.length, { timeout: 15_000 }).toBe(short.length)
  await drained(page)

  const { siteCartLines } = await serverQuery<{ siteCartLines: { variantId: string, quantity: number }[] }>(request, '{ siteCartLines(siteId: "site-1") { variantId quantity } }')
  for (const line of siteCartLines) {
    const item = held.find(i => i.variantId === line.variantId)!
    expect(item.onHand + line.quantity).toBeGreaterThanOrEqual(item.max)
    if (item.boxQuantity) expect(line.quantity % item.boxQuantity).toBe(0)
    if (item.minOrderQuantity) expect(line.quantity).toBeGreaterThanOrEqual(item.minOrderQuantity)
  }
  // The table's restock fields now have nothing left to add.
  await expect(page.locator('.v-data-table tbody tr').first().locator('td input')).toHaveValue('0')
})
