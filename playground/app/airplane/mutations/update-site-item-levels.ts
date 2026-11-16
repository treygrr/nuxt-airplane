// Editing an item's levels a few times sends only the last.

export default defineMutationHandler('UpdateSiteItemLevels', {
  async describe({ db, variables }) {
    const item = await db.SiteItem.get(`${variables.siteId}~${variables.variantId}`)
    return `Keep ${item?.productName ?? 'an item'} between ${variables.min} and ${variables.max}`
  },
  apply: ({ db, variables }) => db.SiteItem.update(`${variables.siteId}~${variables.variantId}`, { min: variables.min, max: variables.max }),
  merge: (earlier, later) => earlier.siteId === later.siteId && earlier.variantId === later.variantId && later,
  reconcile: ({ db }, result) => db.SiteItem.put(result.updateSiteItemLevels),
})
