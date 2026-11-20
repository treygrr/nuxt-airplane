export default defineQueryHandler('GetSites', {
  store: ({ db }, data) => db.sites.bulkPut(data.sites.map(s => ({ ...s, archived: s.archived ? 1 : 0 }))),
  // `QueryResult` is auto-imported as a type: nothing of it reaches the bundles.
  read: async ({ db }): Promise<QueryResult<'GetSites'>> => ({ sites: (await db.sites.toArray()).map(s => ({ ...s, archived: s.archived === 1 })) }),
})
