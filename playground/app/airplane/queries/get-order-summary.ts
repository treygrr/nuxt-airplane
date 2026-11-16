// What the cart comes to, kept in a table of its own. No cart mutation
// changes it locally: tax, shipping and discounts are the server's to work
// out. So each one names this query in its `refetch` list; the default
// would not refetch it, since they change other tables.

export default defineQueryHandler('GetOrderSummary', {
  store: ({ db }, data) => db.OrderSummary.put(data.orderSummary),
  read: async ({ db }) => {
    const orderSummary = await db.OrderSummary.toCollection().first()
    return orderSummary ? { orderSummary } : null
  },
})
