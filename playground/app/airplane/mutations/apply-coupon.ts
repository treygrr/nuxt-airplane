// A code the coupon list knows shows at once. One it does not know is left
// for the server to judge; a rejection there holds nothing else back.

export default defineMutationHandler('ApplyCoupon', {
  describe: ({ variables }) => `Apply code ${variables.code.toUpperCase()}`,
  async apply({ db, variables }) {
    const coupon = await db.Coupon.where('code').equals(variables.code.trim().toUpperCase()).first()
    if (coupon) await db.Cart.toCollection().modify({ coupon })
  },
  reconcile: ({ db }, result) => db.Cart.put(result.applyCoupon),
  // The totals are the server's to work out (tax, shipping, coupons), and
  // they live in a table no line change touches: name them, or they go stale.
  refetch: ['GetCart', 'GetOrderSummary'],
})
