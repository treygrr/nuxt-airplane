export default defineMutationHandler('RemoveWishlistItem', {
  async describe({ db, variables }) {
    return `Remove ${(await db.WishlistItem.get(variables.itemId))?.productName ?? 'an item'} from its list`
  },
  apply: ({ db, variables }) => db.WishlistItem.delete(variables.itemId),
})
