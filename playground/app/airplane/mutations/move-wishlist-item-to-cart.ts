// Off the list and into the cart, as one mutation: two tables change, and
// the new cart line waits for its server id like any other.

import { now } from '../../lib/airplane'

export default defineMutationHandler('MoveWishlistItemToCart', {
  async describe({ db, variables }) {
    return `Move ${(await db.WishlistItem.get(variables.itemId))?.productName ?? 'an item'} to the cart`
  },
  async apply({ db, variables, tempId }) {
    const item = await db.WishlistItem.get(variables.itemId)
    const product = item && await db.Product.get(item.productId)
    if (!item || !product) throw new Error(`Wishlist item ${variables.itemId} is not stored`)
    const variant = product.variants.find(v => v.id === item.variantId) ?? product.variants[0]!
    const cart = await db.Cart.toCollection().first()
    await db.WishlistItem.delete(item.id)
    await db.CartLine.put({
      id: tempId(),
      cartId: cart?.id ?? '',
      productId: product.id,
      variantId: variant.id,
      productName: product.name,
      variantName: variant.name,
      imageUrl: product.imageUrl,
      unitPrice: variant.price,
      quantity: variables.quantity ?? 1,
      addedAt: now(),
    })
  },
  async reconcile({ db, tempIds, resolve }, result) {
    await resolve(tempIds[0]!, result.moveWishlistItemToCart.id)
    await db.CartLine.put(result.moveWishlistItemToCart)
  },
  refetch: ['GetCart', 'GetOrderSummary', 'GetWishlists'],
})
