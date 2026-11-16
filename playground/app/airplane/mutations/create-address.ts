// An address made offline can be made the default before it syncs: that
// mutation carries the placeholder and waits for this one.

export default defineMutationHandler('CreateAddress', {
  describe: ({ variables }) => `Add the address ${variables.input.line1}, ${variables.input.city}`,
  async apply({ db, variables, tempId }) {
    const { line2, ...input } = variables.input
    await db.Address.put({ id: tempId(), ...input, line2: line2 ?? '', isDefault: (await db.Address.count()) === 0 })
  },
  async reconcile({ db, tempIds, resolve }, result) {
    await resolve(tempIds[0]!, result.createAddress.id)
    await db.Address.put(result.createAddress)
  },
})
