import { now } from '../../lib/airplane'

export default defineMutationHandler('CreateWishlist', {
  describe: ({ variables }) => `Create the list "${variables.name}"`,
  apply: ({ db, variables, tempId }) => db.Wishlist.put({ id: tempId(), name: variables.name, createdAt: now() }),
  async reconcile({ db, tempIds, resolve }, result) {
    await resolve(tempIds[0]!, result.createWishlist.id)
    await db.Wishlist.put(result.createWishlist)
  },
})
