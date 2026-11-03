// One file per query; the module imports each file in this folder directly.
// `store` writes the response into the tables from `../stores.ts`, `read`
// builds it back with the same filter. `read` runs inside Dexie's liveQuery,
// so the tables it touches are observed and the data stays live.

export default defineQueryHandler('GetSites', {
  async store({ db, variables }, data) {
    const { archived, search } = variables ?? {}

    // A filtered response is a subset, so only replace the rows it covers.
    // A search result cannot say what to delete outside its scope: upsert only.
    if (search == null) {
      const stale = archived == null
        ? db.sites.toCollection()
        : db.sites.where('archived').equals(archived ? 1 : 0)
      const ids = await stale.primaryKeys()
      await db.sites.bulkDelete(ids)
      await db.siteItems.where('siteId').anyOf(ids).delete()
    }

    await db.sites.bulkPut(data.sites.map(({ id, name, archived }) => ({ id, name, archived: archived ? 1 : 0 })))
    await db.siteItems.bulkPut(data.sites.flatMap(site =>
      site.items.map(item => ({ siteId: site.id, itemId: item.id, onHand: item.onHand }))))
    await db.items.bulkPut(data.sites.flatMap(site => site.items.map(({ id, name }) => ({ id, name }))))
  },

  async read({ db, variables }) {
    const { archived, search } = variables ?? {}

    // The same filter, against the tables: indexed where possible, JS for the rest.
    let query = archived == null
      ? db.sites.toCollection()
      : db.sites.where('archived').equals(archived ? 1 : 0)
    if (search) {
      const q = search.trim().toLowerCase()
      query = query.filter(s => s.name.toLowerCase().includes(q))
    }

    const [sites, siteItems, items] = await Promise.all([
      query.toArray(),
      db.siteItems.toArray(),
      db.items.toArray(),
    ])
    const names = new Map(items.map(i => [i.id, i.name]))
    return {
      sites: sites.map(site => ({
        ...site,
        archived: site.archived === 1,
        items: siteItems
          .filter(si => si.siteId === site.id)
          .map(si => ({ id: si.itemId, name: names.get(si.itemId) ?? si.itemId, onHand: si.onHand })),
      })),
    }
  },
})
