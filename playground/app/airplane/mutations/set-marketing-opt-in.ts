export default defineMutationHandler('SetMarketingOptIn', {
  describe: ({ variables }) => (variables.optIn ? 'Sign up for emails' : 'Stop emails'),
  apply: ({ db, variables }) => db.Customer.toCollection().modify({ marketingOptIn: variables.optIn }),
  merge: (_earlier, later) => later,
  reconcile: ({ db }, result) => db.Customer.put(result.setMarketingOptIn),
})
