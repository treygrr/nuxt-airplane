// Tracking turns a site's min and max on or off. Its restock cart stays either way.

export default defineMutationHandler('SetSiteInventoryTracking', {
  async describe({ db, variables }) {
    const site = await db.Site.get(variables.id)
    return `${variables.enabled ? 'Track' : 'Stop tracking'} inventory at ${site?.name ?? 'a site'}`
  },
  async apply({ db, variables }) {
    await db.Site.update(variables.id, { tracksInventory: variables.enabled })
  },
  reconcile: ({ db }, result) => db.Site.put(result.setSiteInventoryTracking),
})
