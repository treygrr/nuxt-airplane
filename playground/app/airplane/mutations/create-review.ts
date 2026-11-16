import { now } from '../../lib/airplane'

export default defineMutationHandler('CreateReview', {
  async describe({ db, variables }) {
    return `Review ${(await db.Product.get(variables.productId))?.name ?? 'a product'}: ${variables.rating} stars`
  },
  async apply({ db, variables, tempId }) {
    const me = await db.Customer.toCollection().first()
    await db.Review.put({ id: tempId(), ...variables, authorName: me?.name ?? 'You', createdAt: now(), mine: true })
  },
  async reconcile({ db, tempIds, resolve }, result) {
    await resolve(tempIds[0]!, result.createReview.id)
    await db.Review.put(result.createReview)
  },
  // A review changes the product's rating, which only the server works out.
  refetch: ['GetProduct', 'GetReviews', 'GetMyReviews'],
})
