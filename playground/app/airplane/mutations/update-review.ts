// Edits of one review fold together until it is sent.

export default defineMutationHandler('UpdateReview', {
  describe: 'Edit a review',
  apply: ({ db, variables: { id, ...patch } }) =>
    db.Review.update(id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null))),
  merge: (earlier, later) => earlier.id === later.id && {
    ...earlier,
    ...Object.fromEntries(Object.entries(later).filter(([, v]) => v != null)),
  },
  reconcile: ({ db }, result) => db.Review.put(result.updateReview),
  // A review changes the product's rating, which only the server works out.
  refetch: ['GetProduct', 'GetReviews', 'GetMyReviews'],
})
