export default defineMutationHandler('DeleteSite', {
  async describe({ db, variables }) {
    return `Delete ${(await db.Site.get(variables.id))?.name ?? 'a site'}`
  },
  async apply({ db, variables }) {
    await db.SiteItem.where('siteId').equals(variables.id).delete()
    await db.Site.delete(variables.id)
  },
})
