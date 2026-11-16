// Tapping + five times queues one change, not five: a later quantity for
// the same line replaces the one still waiting.

export default defineMutationHandler('SetCartLineQuantity', {
  async describe({ db, variables }) {
    const line = await db.CartLine.get(variables.lineId)
    return `Set ${line?.productName ?? 'a cart line'} to ${variables.quantity}`
  },
  apply: ({ db, variables }) => db.CartLine.update(variables.lineId, { quantity: variables.quantity }),
  merge: (earlier, later) => earlier.lineId === later.lineId && later,
  reconcile: ({ db }, result) => db.CartLine.update(result.setCartLineQuantity.id, result.setCartLineQuantity),
  // The totals are the server's to work out (tax, shipping, coupons), and
  // they live in a table no line change touches: name them, or they go stale.
  refetch: ['GetCart', 'GetOrderSummary'],
})
