export default defineQueryHandler('GetItems', {
  store: ({ db }, data) => db.items.bulkPut(data.items),
  read: async ({ db }) => ({ items: await db.items.toArray() }),
})
