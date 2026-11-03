// How each query is written into the tables from `stores.ts` and read back
// out. `read` runs inside Dexie's liveQuery, so the tables it touches are
// observed and the data stays live.

export default defineQueryHandlers({
  GetSites: {
    async store({ db }, data) {
      // The list is authoritative: replace what we had.
      await db.sites.clear()
      await db.siteItems.clear()
      await db.sites.bulkPut(data.sites.map(({ id, name, archived }) => ({ id, name, archived })))
      await db.siteItems.bulkPut(data.sites.flatMap(site =>
        site.items.map(item => ({ siteId: site.id, itemId: item.id, onHand: item.onHand }))))
      await db.items.bulkPut(data.sites.flatMap(site => site.items.map(({ id, name }) => ({ id, name }))))
    },
    async read({ db }) {
      const [sites, siteItems, items] = await Promise.all([
        db.sites.toArray(),
        db.siteItems.toArray(),
        db.items.toArray(),
      ])
      const names = new Map(items.map(i => [i.id, i.name]))
      return {
        sites: sites.map(site => ({
          ...site,
          items: siteItems
            .filter(si => si.siteId === site.id)
            .map(si => ({ id: si.itemId, name: names.get(si.itemId) ?? si.itemId, onHand: si.onHand })),
        })),
      }
    },
  },

  GetItems: {
    store: ({ db }, data) => db.items.bulkPut(data.items),
    read: async ({ db }) => ({ items: await db.items.toArray() }),
  },
})
