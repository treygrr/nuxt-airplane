// GetSites needs no handler to work offline: its response is split into the
// `Site` and `SiteItem` tables and read back from them. A `read` of its own
// buys one thing: a filter the server has never seen (a search typed while
// offline) still works, because it runs against the tables, not against the
// responses that were fetched. The rows are written for it all the same.

export default defineQueryHandler('GetSites', {
  async read({ db, variables }) {
    const { archived, search } = variables ?? {}
    const q = search?.trim().toLowerCase()
    const sites = (await db.Site.toArray())
      .filter(s => archived == null || s.archived === archived)
      .filter(s => !q || s.name.toLowerCase().includes(q))
    return {
      sites: await Promise.all(sites.map(async site => ({
        ...site,
        archived: site.archived ?? false,
        items: (await db.SiteItem.bulkGet((site.items ?? []).map(ref => ref.id)))
          .filter(item => item !== undefined),
      }))),
    }
  },
})
