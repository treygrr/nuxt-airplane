// A site's items are stored on the site row, as the response has them.
// Adding one means an entry there, named from the catalog in `db.Item`.
export default defineMutationHandler('AddSiteItem', {
  describe: async ({ db, variables }) => `Add ${await itemName(db, variables.itemId)} to ${await siteName(db, variables.siteId)}`,
  async apply({ db, variables }) {
    const { siteId, itemId, onHand } = variables
    const name = await itemName(db, itemId)
    await db.Site.update(siteId, (site) => {
      site.items = [...site.items, { id: itemId, name, onHand: onHand ?? 0 }]
    })
  },
  refetch: ['GetSites'],
})
