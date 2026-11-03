export default defineMutationHandler('DeleteSite', {
  describe: async ({ db, variables }) => `Delete ${await siteName(db, variables.id)}`,
  async apply({ db, variables }) {
    await db.sites.delete(variables.id)
    await db.siteItems.where('siteId').equals(variables.id).delete()
  },
  refetch: ['GetSites'],
})
