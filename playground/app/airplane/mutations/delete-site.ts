// Deleting the row is enough: `GetSites` reads the table, so the site is gone
// from the list at once.
export default defineMutationHandler('DeleteSite', {
  describe: async ({ db, variables }) => `Delete ${(await db.Site.get(variables.id))?.name ?? variables.id}`,
  apply: ({ db, variables }) => db.Site.delete(variables.id),
  refetch: ['GetSites'],
})
