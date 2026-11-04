export default defineMutationHandler('RemoveSiteItem', {
  describe: async ({ db, variables }) => `Remove ${await itemName(db, variables.itemId)} from ${await siteName(db, variables.siteId)}`,
  apply: ({ db, variables }) => db.Site.update(variables.siteId, (site) => {
    site.items = (site.items ?? []).filter(ref => ref.id !== variables.itemId)
  }),
  refetch: ['GetSites'],
})
