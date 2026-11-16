export default defineMutationHandler('CancelOrder', {
  async describe({ db, variables }) {
    return `Cancel order ${(await db.Order.get(variables.id))?.number ?? variables.id}`
  },
  apply: ({ db, variables }) => db.Order.update(variables.id, { status: 'CANCELLED' }),
  reconcile: ({ db }, result) => db.Order.put(result.cancelOrder),
  // The stock comes back.
  refetch: ['GetOrders', 'GetOrder', 'GetProduct', 'GetProducts'],
})
