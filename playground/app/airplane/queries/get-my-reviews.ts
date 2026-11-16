// The customer's own reviews. `mine` is a boolean, which IndexedDB cannot
// index, so it is filtered here.

export default defineQueryHandler('GetMyReviews', {
  async store({ db }, data) {
    const ids = new Set(data.myReviews.map(r => r.id))
    await db.Review.filter(r => r.mine && !ids.has(r.id)).delete()
    await db.Review.bulkPut(data.myReviews)
  },
  async read({ db }) {
    const reviews = await db.Review.filter(r => r.mine).toArray()
    return { myReviews: reviews.sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  },
})
