export default defineMutationHandler('UnarchiveSite', {
  async describe({ db, variables }) {
    return `Unarchive ${(await db.Site.get(variables.id))?.name ?? 'a site'}`
  },
  apply: ({ db, variables }) => db.Site.update(variables.id, { archived: false }),
  reconcile: ({ db }, result) => db.Site.put(result.unarchiveSite),
  // A site's stock is the shop's stock: the catalog's numbers change too.
  refetch: ['GetSites', 'GetSite', 'GetSiteItems', 'GetProduct', 'GetProducts'],
})
