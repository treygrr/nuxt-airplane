// No `apply`: nothing the client keeps changes. The module cannot tell what
// such a mutation touches, so it sends it on its own, after everything
// queued before it, and refetches every mounted query once it is through.

export default defineMutationHandler('NotifyBackInStock', {
  async describe({ db, variables }) {
    const variant = await db.Variant.get(variables.variantId)
    const product = variant && await db.Product.get(variant.productId)
    return `Tell me when ${product?.name ?? 'it'} is back`
  },
})
