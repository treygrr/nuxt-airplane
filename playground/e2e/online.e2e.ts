// Online queries: asked of the server only, never kept. Search suggestions
// wait for two characters; the lab's counters are in the page as rendered.

import { expect, ready, test } from './helpers'

/**
 * The requests the browser sent for `op`, as they go. With persisted
 * queries a request is its hash first (and its text only if the server did
 * not know it), so it is found by its hash, and counted once.
 */
async function sent(page: import('@playwright/test').Page, op: string) {
  const hash = await page.evaluate(name => (client() as unknown as { documents: Record<string, { hash: string }> }).documents[name]!.hash, op)
  const bodies: { variables?: Record<string, unknown> }[] = []
  page.on('request', (r) => {
    const raw = r.url().includes('/api/graphql') ? r.postData() : null
    if (!raw) return
    const body = JSON.parse(raw) as { query?: string, variables?: Record<string, unknown>, extensions?: { persistedQuery?: { sha256Hash: string } } }
    if (body.extensions?.persistedQuery?.sha256Hash === hash && !body.query) bodies.push(body)
  })
  return bodies
}

test('search suggestions are asked for from two characters on, once per term', async ({ page }) => {
  await page.goto('/')
  await ready(page)
  const asked = await sent(page, 'GetSearchSuggestions')
  const search = page.locator('header input[role="combobox"]')
  await search.pressSequentially('l', { delay: 50 })
  await page.waitForTimeout(300)
  expect(asked).toHaveLength(0)
  await search.pressSequentially('ev', { delay: 150 })
  await expect.poll(() => asked.map(b => b.variables?.query)).toEqual(['le', 'lev'])
  // Back through "le", which is asked again (nothing is kept), to "l", which is not.
  await search.press('Backspace')
  await expect.poll(() => asked.map(b => b.variables?.query)).toEqual(['le', 'lev', 'le'])
  await search.press('Backspace')
  await page.waitForTimeout(300)
  expect(asked).toHaveLength(3)
})

test('the lab counters are in the page as rendered, and the browser does not ask for them again on load', async ({ page, request }) => {
  const html = await (await request.get('/dev')).text()
  expect(html).toContain('airplane:LabStats:')
  // Listening from the first byte: the hash is the same as the client's, read once from the home page.
  await page.goto('/')
  await ready(page)
  const asked = await sent(page, 'LabStats')
  await page.goto('/dev')
  await ready(page)
  await expect(page.getByText('Products in the catalog')).toBeVisible()
  // The page refreshes them every second; until then, hydration sent nothing.
  expect(asked).toHaveLength(0)
  await expect.poll(() => asked.length, { timeout: 5000 }).toBeGreaterThan(0)
})
