export default defineMutationHandler('UpdateSiteItemOnHand', {
  describe: async ({ db, variables }) => `Set ${await itemName(db, variables.itemId)} at ${await siteName(db, variables.siteId)} to ${variables.onHand}`,
  apply: ({ db, variables }) => db.Site.update(variables.siteId, (site) => {
    const item = site.items.find(item => item.id === variables.itemId)
    if (item) item.onHand = variables.onHand
  }),
  refetch: ['GetSites'],
})
