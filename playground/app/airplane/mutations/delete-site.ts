// Deleting the row is enough: every query listing the site drops it when it
// is read back from the tables.
export default defineMutationHandler('DeleteSite', {
  describe: async ({ db, variables }) => `Delete ${await siteName(db, variables.id)}`,
  apply: ({ db, variables }) => db.Site.delete(variables.id),
  refetch: ['GetSites'],
})
