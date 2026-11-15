export default defineMutationHandler('UpdateSiteItemOnHand', {
  async describe({ db, variables }) {
    const site = await db.Site.get(variables.siteId)
    const item = site?.items.find(item => item.id === variables.itemId)
    return `Set ${item?.name ?? variables.itemId} at ${site?.name ?? variables.siteId} to ${variables.onHand}`
  },
  apply: ({ db, variables }) => db.Site.update(variables.siteId, (site) => {
    const item = site.items.find(item => item.id === variables.itemId)
    if (item) item.onHand = variables.onHand
  }),
  // Counting stock taps the same field again and again: only the last
  // number has to reach the server.
  merge: (earlier, later) => earlier.siteId === later.siteId && earlier.itemId === later.itemId && later,
  refetch: ['GetSites'],
})
