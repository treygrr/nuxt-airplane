export default defineMutationHandler('RemoveCoupon', {
  describe: 'Remove the coupon',
  apply: ({ db }) => db.Cart.toCollection().modify({ coupon: null }),
  reconcile: ({ db }, result) => db.Cart.put(result.removeCoupon),
  // The totals are the server's to work out (tax, shipping, coupons), and
  // they live in a table no line change touches: name them, or they go stale.
  refetch: ['GetCart', 'GetOrderSummary'],
})
