export default defineMutationHandler('ArchiveSite', {
  describe: 'Archive a site',
  apply: ({ db, variables }) => db.sites.update(variables.id, { archived: 1 }),
})
