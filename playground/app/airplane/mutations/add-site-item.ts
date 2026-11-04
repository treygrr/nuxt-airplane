// A site's items are stored on the site row, as the response has them.
// Adding one means an entry there, named from the catalog in `db.Item`.
export default defineMutationHandler('AddSiteItem', {
  async describe({ db, variables }) {
    const [site, item] = await Promise.all([db.Site.get(variables.siteId), db.Item.get(variables.itemId)])
    return `Add ${item?.name ?? variables.itemId} to ${site?.name ?? variables.siteId}`
  },
  async apply({ db, variables }) {
    const { siteId, itemId, onHand } = variables
    const name = (await db.Item.get(itemId))?.name ?? itemId
    await db.Site.update(siteId, (site) => {
      site.items = [...site.items, { id: itemId, name, onHand: onHand ?? 0 }]
    })
  },
  refetch: ['GetSites'],
})
