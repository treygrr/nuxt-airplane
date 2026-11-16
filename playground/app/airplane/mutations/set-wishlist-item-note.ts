// Typed a note at a time: only the last version of a note is sent.

export default defineMutationHandler('SetWishlistItemNote', {
  async describe({ db, variables }) {
    const item = await db.WishlistItem.get(variables.itemId)
    return `Note on ${item?.productName ?? 'a list item'}`
  },
  apply: ({ db, variables }) => db.WishlistItem.update(variables.itemId, { note: variables.note }),
  merge: (earlier, later) => earlier.itemId === later.itemId && later,
})
