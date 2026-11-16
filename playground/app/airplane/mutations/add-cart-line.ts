// A new cart line, under a placeholder id until the server names it. Edits
// queued against the placeholder (a quantity, a removal) wait for it.

import { money, now } from '../../lib/airplane'

export default defineMutationHandler('AddCartLine', {
  async describe({ db, variables }) {
    const variant = await db.Variant.get(variables.variantId)
    const product = variant && await db.Product.get(variant.productId)
    return `Add ${variables.quantity} × ${product?.name ?? 'an item'}${variant ? ` (${variant.name}, ${money(variant.price)})` : ''}`
  },
  async apply({ db, variables, tempId }) {
    const variant = await db.Variant.get(variables.variantId)
    const product = variant && await db.Product.get(variant.productId)
    if (!variant || !product) throw new Error(`Variant ${variables.variantId} is not stored`)
    const cart = await db.Cart.toCollection().first()
    await db.CartLine.put({
      id: tempId(),
      cartId: cart?.id ?? '',
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      imageUrl: product.imageUrl,
      unitPrice: variant.price,
      quantity: variables.quantity,
      addedAt: now(),
    })
  },
  async reconcile({ db, tempIds, resolve }, result) {
    await resolve(tempIds[0]!, result.addCartLine.id)
    await db.CartLine.put(result.addCartLine)
  },
  // The totals are the server's to work out (tax, shipping, coupons), and
  // they live in a table no line change touches: name them, or they go stale.
  refetch: ['GetCart', 'GetOrderSummary'],
})
