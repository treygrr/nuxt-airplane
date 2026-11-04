// A row created offline gets a placeholder id from `tempId()`. The user can
// rename it or add items to it before the create has reached the server;
// those mutations carry the placeholder, and the module replaces it with the
// server's id before sending them, once `reconcile` has called `resolve`.
export default defineMutationHandler('CreateSite', {
  describe: ({ variables }) => `Create ${variables.name}`,
  apply: ({ db, variables, tempId }) =>
    db.sites.put({ id: tempId(), name: variables.name, archived: 0 }),
  async reconcile({ db, tempIds, resolve }, result) {
    const [tmp] = tempIds
    if (!tmp) return
    const { id } = result.createSite
    await db.transaction('rw', db.sites, db.siteItems, async () => {
      const local = await db.sites.get(tmp)
      if (local) {
        await db.sites.delete(tmp)
        await db.sites.put({ ...local, id })
      }
      // Items added to the site while it was still a placeholder.
      const items = await db.siteItems.where('siteId').equals(tmp).toArray()
      await db.siteItems.where('siteId').equals(tmp).delete()
      await db.siteItems.bulkPut(items.map(item => ({ ...item, siteId: id })))
    })
    await resolve(tmp, id)
  },
  refetch: ['GetSites'],
})
