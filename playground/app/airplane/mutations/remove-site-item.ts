export default defineMutationHandler('RemoveSiteItem', {
  async describe({ db, variables }) {
    const site = await db.Site.get(variables.siteId)
    const item = site?.items.find(item => item.id === variables.itemId)
    return `Remove ${item?.name ?? variables.itemId} from ${site?.name ?? variables.siteId}`
  },
  apply: ({ db, variables }) => db.Site.update(variables.siteId, (site) => {
    site.items = site.items.filter(item => item.id !== variables.itemId)
  }),
  refetch: ['GetSites'],
})
