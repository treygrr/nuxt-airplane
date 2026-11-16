export default defineQueryHandler('GetOrder', {
  store: async ({ db }, data) => {
    if (data.order) await db.Order.put(data.order)
  },
  read: async ({ db, variables }) => ({ order: (await db.Order.get(variables.id)) ?? null }),
})
