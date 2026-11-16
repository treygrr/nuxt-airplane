export default defineMutationHandler('RenameWishlist', {
  describe: ({ variables }) => `Rename a list to "${variables.name}"`,
  apply: ({ db, variables }) => db.Wishlist.update(variables.id, { name: variables.name }),
  merge: (earlier, later) => earlier.id === later.id && later,
})
