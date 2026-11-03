// One file per mutation. There is no index file in this folder, so the module
// imports each file directly. `describe` runs before `apply`, so it still
// sees the old name on a rename or delete.

export default defineMutationHandler('ArchiveSite', {
  describe: async ({ db, variables }) => `Archive ${await siteName(db, variables.id)}`,
  apply: ({ db, variables }) => db.sites.update(variables.id, { archived: 1 }),
  refetch: ['GetSites'],
})
