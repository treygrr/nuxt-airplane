// Turning tracking off empties the site's restock cart, here as on the server.

export default defineMutationHandler('SetSiteInventoryTracking', {
  async describe({ db, variables }) {
    const site = await db.Site.get(variables.id)
    return `${variables.enabled ? 'Track' : 'Stop tracking'} inventory at ${site?.name ?? 'a site'}`
  },
  async apply({ db, variables }) {
    await db.Site.update(variables.id, { tracksInventory: variables.enabled })
    if (!variables.enabled) await db.SiteCartLine.where('siteId').equals(variables.id).delete()
  },
  reconcile: ({ db }, result) => db.Site.put(result.setSiteInventoryTracking),
  refetch: ['GetSiteCartLines'],
})
