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
  await expect(page.getByRole('switch', { name: 'Track inventory levels' }).or(page.getByLabel('Track inventory levels'))).toBeChecked()

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
  // Two items into the cart, the first one twice: one change for it.
  const rows = page.locator('.v-data-table tbody tr')
  await rows.nth(0).getByRole('button', { name: /restock cart/ }).click()
  await rows.nth(1).getByRole('button', { name: /restock cart/ }).click()
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

  await page.getByLabel('Track inventory levels').click()
  await expect(page.getByRole('columnheader', { name: 'Min' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Restock cart' })).toHaveCount(0)
  await expect.poll(async () => (await serverQuery<{ siteCartLines: unknown[] }>(request, '{ siteCartLines(siteId: "site-1") { id } }')).siteCartLines).toHaveLength(0)

  // A site that does not track has no cart to add to.
  await page.goto('/inventory/site-2')
  await expect(page.getByRole('columnheader', { name: 'On hand' })).toBeVisible()
  await expect(page.getByRole('button', { name: /restock cart/ })).toHaveCount(0)
})
