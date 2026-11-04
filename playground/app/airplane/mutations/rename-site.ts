export default defineMutationHandler('RenameSite', {
  describe: async ({ db, variables }) => `Rename ${await siteName(db, variables.id)} to ${variables.name}`,
  apply: ({ db, variables }) => db.Site.update(variables.id, { name: variables.name }),
  refetch: ['GetSites'],
})
