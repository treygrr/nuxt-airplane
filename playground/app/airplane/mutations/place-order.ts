// Sent with \`queue: false\`: the queue drains first, then the order goes out
// and the page waits for the answer. Nothing is applied before the server
// says yes, so there is no \`apply\`.

export default defineMutationHandler('PlaceOrder', {
  async reconcile({ db }, result) {
    await db.Order.put(result.placeOrder)
    await db.CartLine.clear()
    await db.Cart.toCollection().modify({ coupon: null })
  },
  // Stock went down, so the catalog's numbers changed too.
  refetch: ['GetCart', 'GetOrderSummary', 'GetOrders', 'GetProduct', 'GetProducts'],
})
