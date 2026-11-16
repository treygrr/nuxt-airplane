export default defineMutationHandler('RenameSite', {
  async describe({ db, variables }) {
    return `Rename ${(await db.Site.get(variables.id))?.name ?? 'a site'} to ${variables.name}`
  },
  apply: ({ db, variables }) => db.Site.update(variables.id, { name: variables.name }),
  merge: (earlier, later) => earlier.id === later.id && later,
  reconcile: ({ db }, result) => db.Site.put(result.renameSite),
})
