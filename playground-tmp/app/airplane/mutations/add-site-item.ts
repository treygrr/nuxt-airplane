export default defineMutationHandler('AddSiteItem', {
  describe: async ({ db, variables }) => `Add ${await itemName(db, variables.itemId)} to ${await siteName(db, variables.siteId)}`,
  apply: ({ db, variables }) =>
    db.siteItems.put({ siteId: variables.siteId, itemId: variables.itemId, onHand: variables.onHand ?? 0 }),
  refetch: ['GetSites'],
})
