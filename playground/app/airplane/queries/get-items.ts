// The catalog. Its rows feed the item picker and the `AddSiteItem` handler,
// which names a new entry from `db.Item` before the server has seen it.
export default defineQueryHandler('GetItems', {
  store: ({ db }, data) => db.Item.bulkPut(data.items),
  read: async ({ db }) => ({ items: await db.Item.orderBy('name').toArray() }),
})
