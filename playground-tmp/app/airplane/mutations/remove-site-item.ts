export default defineMutationHandler('RemoveSiteItem', {
  describe: async ({ db, variables }) => `Remove ${await itemName(db, variables.itemId)} from ${await siteName(db, variables.siteId)}`,
  apply: ({ db, variables }) => db.siteItems.delete([variables.siteId, variables.itemId]),
  refetch: ['GetSites'],
})
