// A site's items are references to `SiteItem` rows. Adding one means a row
// for the item (named from the catalog) and a reference on the site.
export default defineMutationHandler('AddSiteItem', {
  describe: async ({ db, variables }) => `Add ${await itemName(db, variables.itemId)} to ${await siteName(db, variables.siteId)}`,
  async apply({ db, variables }) {
    const { siteId, itemId, onHand } = variables
    await db.SiteItem.put({ __typename: 'SiteItem', id: itemId, name: await itemName(db, itemId), onHand: onHand ?? 0 })
    await db.Site.update(siteId, (site) => {
      site.items = [...(site.items ?? []), { __typename: 'SiteItem', id: itemId }]
    })
  },
  refetch: ['GetSites'],
})
