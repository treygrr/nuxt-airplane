// Fills a site's restock cart: every item short of its max gets what it
// needs, beyond what is in the cart already, in quantities that may be
// ordered. Offline it works from the site's items in the tables, which the
// site page walks to the end; the server's answer is the whole cart, and
// replaces the site's lines.

import { now } from '../../lib/airplane'
import { suggestedRestock } from '../../lib/restock'

export default defineMutationHandler('FillSiteCartToMax', {
  async describe({ db, variables }) {
    const site = await db.Site.get(variables.siteId)
    return `Fill ${site?.name ?? 'a site'}'s restock cart to max`
  },
  async apply({ db, variables }) {
    const items = await db.SiteItem.where('siteId').equals(variables.siteId).toArray()
    const lines = new Map((await db.SiteCartLine.where('siteId').equals(variables.siteId).toArray()).map(line => [line.id, line]))
    const added = now()
    const rows = []
    for (const item of items) {
      const line = lines.get(item.id)
      if (item.max - item.onHand - (line?.quantity ?? 0) <= 0) continue
      const quantity = suggestedRestock(item, line?.quantity ?? 0)
      rows.push(line
        ? { ...line, quantity: line.quantity + quantity }
        : {
            id: item.id,
            siteId: item.siteId,
            variantId: item.variantId,
            productId: item.productId,
            productName: item.productName,
            variantName: item.variantName,
            sku: item.sku,
            quantity,
            addedAt: added,
            boxQuantity: item.boxQuantity ?? null,
            minOrderQuantity: item.minOrderQuantity ?? null,
          })
    }
    await db.SiteCartLine.bulkPut(rows)
  },
  async reconcile({ db, variables }, result) {
    await db.SiteCartLine.where('siteId').equals(variables.siteId).delete()
    await db.SiteCartLine.bulkPut(result.fillSiteCartToMax)
  },
})
