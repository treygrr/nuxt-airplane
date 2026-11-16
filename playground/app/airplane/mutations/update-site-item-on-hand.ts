// Counting stock taps the same number again and again: only the last count
// is sent.
//
// The site's unit count is left to the refetch. Kept up to date here, every
// count at a site would change the same Site row, and changes to one row are
// sent one at a time, in order: a stock take of 40 items would go out one by
// one instead of side by side (FINDINGS.md, 5).

export default defineMutationHandler('UpdateSiteItemOnHand', {
  async describe({ db, variables }) {
    const item = await db.SiteItem.get(`${variables.siteId}~${variables.variantId}`)
    const site = await db.Site.get(variables.siteId)
    return `Set ${item?.productName ?? 'an item'} at ${site?.name ?? 'a site'} to ${variables.onHand}`
  },
  apply: ({ db, variables }) => db.SiteItem.update(`${variables.siteId}~${variables.variantId}`, { onHand: variables.onHand }),
  merge: (earlier, later) => earlier.siteId === later.siteId && earlier.variantId === later.variantId && later,
  reconcile: ({ db }, result) => db.SiteItem.put(result.updateSiteItemOnHand),
  // A site's stock is the shop's stock: the catalog's numbers change too.
  refetch: ['GetSites', 'GetSite', 'GetSiteItems', 'GetProduct', 'GetProducts'],
})
