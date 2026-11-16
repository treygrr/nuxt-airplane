// A small query that many components mount at once (navigation, filters,
// breadcrumbs): their requests share one in flight.

export default defineQueryHandler('GetCategories', {
  store: ({ db }, data) => db.Category.bulkPut(data.categories),
  read: async ({ db }) => ({ categories: await db.Category.toArray() }),
})
