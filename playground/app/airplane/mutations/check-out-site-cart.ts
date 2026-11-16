// Checking out a restock cart adds each line's quantity to what the site
// holds, and empties the cart. It can be queued offline like any other change:
// its `apply` deletes the cart's lines and writes the items' counts, so it
// waits for the adds and quantity changes queued before it, and a count of
// the same item queued after it waits for it.

export default defineMutationHandler('CheckOutSiteCart', {
  async describe({ db, variables }) {
    const site = await db.Site.get(variables.siteId)
    const lines = await db.SiteCartLine.where('siteId').equals(variables.siteId).toArray()
    const units = lines.reduce((sum, line) => sum + line.quantity, 0)
    return `Restock ${units} units at ${site?.name ?? 'a site'}`
  },
  async apply({ db, variables }) {
    const lines = await db.SiteCartLine.where('siteId').equals(variables.siteId).toArray()
    let units = 0
    for (const line of lines) {
      await db.SiteItem.where('id').equals(line.id).modify((item) => {
        item.onHand += line.quantity
      })
      units += line.quantity
    }
    await db.SiteCartLine.bulkDelete(lines.map(line => line.id))
    await db.Site.where('id').equals(variables.siteId).modify((site) => {
      site.unitCount += units
    })
  },
  async reconcile({ db }, result) {
    await db.Site.put(result.checkOutSiteCart.site)
    await db.SiteItem.bulkPut(result.checkOutSiteCart.items)
  },
  // A site's stock is the shop's stock: the catalog's numbers change too.
  refetch: ['GetSiteCartLines', 'GetProduct', 'GetProducts'],
})
