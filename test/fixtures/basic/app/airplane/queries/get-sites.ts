export default defineQueryHandler('GetSites', {
  store: ({ db }, data) => db.sites.bulkPut(data.sites.map(s => ({ ...s, archived: s.archived ? 1 : 0 }))),
  read: async ({ db }) => ({ sites: (await db.sites.toArray()).map(s => ({ ...s, archived: s.archived === 1 })) }),
})
