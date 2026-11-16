export default defineMutationHandler('ClearCart', {
  describe: 'Empty the cart',
  async apply({ db }) {
    await db.CartLine.clear()
    await db.Cart.toCollection().modify({ coupon: null })
  },
  // The totals are the server's to work out (tax, shipping, coupons), and
  // they live in a table no line change touches: name them, or they go stale.
  refetch: ['GetCart', 'GetOrderSummary'],
})
