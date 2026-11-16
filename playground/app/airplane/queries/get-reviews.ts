// A product's reviews, newest first. The response is all of them, so it
// replaces what is kept for that product.

export default defineQueryHandler('GetReviews', {
  async store({ db, variables }, data) {
    await db.Review.where('productId').equals(variables.productId).delete()
    await db.Review.bulkPut(data.reviews)
  },
  async read({ db, variables }) {
    const reviews = await db.Review.where('productId').equals(variables.productId).toArray()
    return { reviews: reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  },
})
