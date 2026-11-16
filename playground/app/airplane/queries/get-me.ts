export default defineQueryHandler('GetMe', {
  store: ({ db }, data) => db.Customer.put(data.me),
  read: async ({ db }) => {
    const me = await db.Customer.toCollection().first()
    return me ? { me } : null
  },
})
