export default defineMutationHandler('RemoveCartLine', {
  async describe({ db, variables }) {
    const line = await db.CartLine.get(variables.lineId)
    return `Remove ${line?.productName ?? 'a cart line'} from the cart`
  },
  apply: ({ db, variables }) => db.CartLine.delete(variables.lineId),
  // The totals are the server's to work out (tax, shipping, coupons), and
  // they live in a table no line change touches: name them, or they go stale.
  refetch: ['GetCart', 'GetOrderSummary'],
})
