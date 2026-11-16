export default defineMutationHandler('DeleteWishlist', {
  async describe({ db, variables }) {
    return `Delete the list "${(await db.Wishlist.get(variables.id))?.name ?? variables.id}"`
  },
  async apply({ db, variables }) {
    await db.WishlistItem.where('wishlistId').equals(variables.id).delete()
    await db.Wishlist.delete(variables.id)
  },
})
