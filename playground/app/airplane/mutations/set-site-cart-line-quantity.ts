// Stepping a quantity sends only where it ended.

export default defineMutationHandler('SetSiteCartLineQuantity', {
  async describe({ db, variables }) {
    const line = await db.SiteCartLine.get(`${variables.siteId}~${variables.variantId}`)
    return `Restock ${variables.quantity} × ${line?.productName ?? 'an item'}`
  },
  apply: ({ db, variables }) => db.SiteCartLine.update(`${variables.siteId}~${variables.variantId}`, { quantity: variables.quantity }),
  merge: (earlier, later) => earlier.siteId === later.siteId && earlier.variantId === later.variantId && later,
  reconcile: ({ db }, result) => db.SiteCartLine.put(result.setSiteCartLineQuantity),
})
