import { now } from '../../lib/airplane'

export default defineMutationHandler('AddWishlistItem', {
  async describe({ db, variables }) {
    const product = await db.Product.get(variables.productId)
    const list = await db.Wishlist.get(variables.wishlistId)
    return `Add ${product?.name ?? 'a product'} to "${list?.name ?? 'a list'}"`
  },
  async apply({ db, variables, tempId }) {
    const product = await db.Product.get(variables.productId)
    if (!product) throw new Error(`Product ${variables.productId} is not stored`)
    const variant = product.variants.find(v => v.id === variables.variantId) ?? product.variants[0]
    await db.WishlistItem.put({
      id: tempId(),
      wishlistId: variables.wishlistId,
      productId: product.id,
      variantId: variables.variantId ?? null,
      productName: product.name,
      imageUrl: product.imageUrl,
      price: variant?.price ?? product.price,
      note: variables.note ?? '',
      addedAt: now(),
    })
  },
  async reconcile({ db, tempIds, resolve }, result) {
    await resolve(tempIds[0]!, result.addWishlistItem.id)
    await db.WishlistItem.put(result.addWishlistItem)
  },
})
