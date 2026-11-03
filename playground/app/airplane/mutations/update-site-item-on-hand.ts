export default defineMutationHandler('UpdateSiteItemOnHand', {
  describe: async ({ db, variables }) => `Set ${await itemName(db, variables.itemId)} at ${await siteName(db, variables.siteId)} to ${variables.onHand}`,
  apply: ({ db, variables }) =>
    db.siteItems.update([variables.siteId, variables.itemId], { onHand: variables.onHand }),
  refetch: ['GetSites'],
})
