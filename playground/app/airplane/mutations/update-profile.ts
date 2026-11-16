// Not merged: a first change that fails holds back a later change of the
// same field, so they reach the server in the order made.

export default defineMutationHandler('UpdateProfile', {
  describe: ({ variables }) => `Update ${Object.keys(variables).filter(k => variables[k as keyof typeof variables] != null).join(', ')}`,
  apply: ({ db, variables }) =>
    db.Customer.toCollection().modify(Object.fromEntries(Object.entries(variables).filter(([, v]) => v != null))),
  reconcile: ({ db }, result) => db.Customer.put(result.updateProfile),
})
