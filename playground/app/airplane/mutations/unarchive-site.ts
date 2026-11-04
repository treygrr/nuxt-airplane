export default defineMutationHandler('UnarchiveSite', {
  describe: async ({ db, variables }) => `Unarchive ${await siteName(db, variables.id)}`,
  apply: ({ db, variables }) => db.Site.update(variables.id, { archived: false }),
  refetch: ['GetSites'],
})
