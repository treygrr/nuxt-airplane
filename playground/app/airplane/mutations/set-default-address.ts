export default defineMutationHandler('SetDefaultAddress', {
  async describe({ db, variables }) {
    return `Ship to ${(await db.Address.get(variables.id))?.line1 ?? 'an address'} by default`
  },
  apply: ({ db, variables }) => db.Address.toCollection().modify(address => void (address.isDefault = address.id === variables.id)),
  merge: (_earlier, later) => later,
})
