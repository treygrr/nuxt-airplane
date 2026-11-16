export default defineMutationHandler('DeleteReview', {
  describe: 'Delete a review',
  apply: ({ db, variables }) => db.Review.delete(variables.id),
  // A review changes the product's rating, which only the server works out.
  refetch: ['GetProduct', 'GetReviews', 'GetMyReviews'],
})
