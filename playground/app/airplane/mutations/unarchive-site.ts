export default defineMutationHandler('UnarchiveSite', {
  describe: async ({ db, variables }) => `Unarchive ${await siteName(db, variables.id)}`,
  apply: ({ db, variables }) => db.sites.update(variables.id, { archived: 0 }),
  refetch: ['GetSites'],
})
