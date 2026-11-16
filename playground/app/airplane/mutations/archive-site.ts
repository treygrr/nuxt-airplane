export default defineMutationHandler('ArchiveSite', {
  async describe({ db, variables }) {
    return `Archive ${(await db.Site.get(variables.id))?.name ?? 'a site'}`
  },
  apply: ({ db, variables }) => db.Site.update(variables.id, { archived: true }),
  reconcile: ({ db }, result) => db.Site.put(result.archiveSite),
  // A site's stock is the shop's stock: the catalog's numbers change too.
  refetch: ['GetSites', 'GetSite', 'GetSiteItems', 'GetProduct', 'GetProducts'],
})
