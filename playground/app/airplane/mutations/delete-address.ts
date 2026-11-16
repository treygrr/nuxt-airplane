export default defineMutationHandler('DeleteAddress', {
  async describe({ db, variables }) {
    return `Delete the address ${(await db.Address.get(variables.id))?.line1 ?? variables.id}`
  },
  async apply({ db, variables }) {
    const address = await db.Address.get(variables.id)
    await db.Address.delete(variables.id)
    // The default goes to another address, as on the server.
    const next = address?.isDefault && await db.Address.orderBy('name').first()
    if (next) await db.Address.update(next.id, { isDefault: true })
  },
  // Which address the server makes the default is its to say.
  refetch: ['GetAddresses'],
})
