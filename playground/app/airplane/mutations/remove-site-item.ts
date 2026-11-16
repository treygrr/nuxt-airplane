export default defineMutationHandler('RemoveSiteItem', {
  async describe({ db, variables }) {
    const item = await db.SiteItem.get(`${variables.siteId}~${variables.variantId}`)
    return `Remove ${item?.productName ?? 'an item'} from a site`
  },
  async apply({ db, variables }) {
    const id = `${variables.siteId}~${variables.variantId}`
    const item = await db.SiteItem.get(id)
    if (!item) return
    await db.SiteItem.delete(id)
    await db.Site.where('id').equals(variables.siteId).modify((site) => {
      site.itemCount--
      site.unitCount -= item.onHand
    })
  },
  // A site's stock is the shop's stock: the catalog's numbers change too.
  refetch: ['GetSites', 'GetSite', 'GetSiteItems', 'GetProduct', 'GetProducts'],
})
