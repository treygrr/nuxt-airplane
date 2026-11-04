// A row created offline gets a placeholder id from `tempId()`. The user can
// rename it or add items to it before the create has reached the server;
// those mutations carry the placeholder, and the module replaces it with the
// server's id before sending them, once `reconcile` has called `resolve`.
// `resolve` also re-keys the row itself and the references to it.
export default defineMutationHandler('CreateSite', {
  describe: ({ variables }) => `Create ${variables.name}`,
  apply: ({ db, variables, tempId }) =>
    db.Site.put({ __typename: 'Site', id: tempId(), name: variables.name, archived: false, items: [] }),
  reconcile: ({ tempIds, resolve }, result) => resolve(tempIds[0]!, result.createSite.id),
  refetch: ['GetSites'],
})
