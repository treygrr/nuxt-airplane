export default defineMutationHandler('UnarchiveSite', {
  describe: async ({ db, variables }) => `Unarchive ${(await db.Site.get(variables.id))?.name ?? variables.id}`,
  apply: ({ db, variables }) => db.Site.update(variables.id, { archived: false }),
  refetch: ['GetSites'],
})
