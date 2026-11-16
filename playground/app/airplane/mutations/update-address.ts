// Two edits of one address stay two mutations, sent in the order made: the
// server must not see the second before the first.

export default defineMutationHandler('UpdateAddress', {
  async describe({ db, variables }) {
    const address = await db.Address.get(variables.id)
    const fields = Object.keys(variables).filter(k => k !== 'id' && variables[k as keyof typeof variables] != null)
    return `Change ${fields.join(', ')} of ${address?.line1 ?? 'an address'}`
  },
  apply: ({ db, variables: { id, ...patch } }) =>
    db.Address.update(id, Object.fromEntries(Object.entries(patch).filter(([, v]) => v != null))),
  reconcile: ({ db }, result) => db.Address.put(result.updateAddress),
})
