// A line's id is the site's and the variant's together, like the item's, so
// the client names it without the server. Added again, the item's line grows.
// Two adds of the same item still queued become one.

import { now } from '../../lib/airplane'

export default defineMutationHandler('AddSiteCartLine', {
  async describe({ db, variables }) {
    const item = await db.SiteItem.get(`${variables.siteId}~${variables.variantId}`)
    const site = await db.Site.get(variables.siteId)
    return `Add ${variables.quantity} × ${item?.productName ?? 'an item'} to ${site?.name ?? 'a site'}'s restock cart`
  },
  async apply({ db, variables }) {
    const id = `${variables.siteId}~${variables.variantId}`
    const line = await db.SiteCartLine.get(id)
    if (line) return db.SiteCartLine.update(id, { quantity: line.quantity + variables.quantity })
    const item = await db.SiteItem.get(id)
    if (!item) throw new Error(`${id} is not stored`)
    await db.SiteCartLine.put({
      id,
      siteId: item.siteId,
      variantId: item.variantId,
      productId: item.productId,
      productName: item.productName,
      variantName: item.variantName,
      sku: item.sku,
      quantity: variables.quantity,
      addedAt: now(),
      boxQuantity: item.boxQuantity ?? null,
      minOrderQuantity: item.minOrderQuantity ?? null,
    })
  },
  merge: (earlier, later) => earlier.siteId === later.siteId && earlier.variantId === later.variantId && { ...later, quantity: earlier.quantity + later.quantity },
  reconcile: ({ db }, result) => db.SiteCartLine.put(result.addSiteCartLine),
})
