// The cart and its lines. Lines are rows of their own, so changes to two
// lines are changes to two rows: they can be sent side by side, and a
// refetch while one is pending leaves it showing on top of the new data.

import { replaceAll } from '../../lib/airplane'

export default defineQueryHandler('GetCart', {
  async store({ db }, data) {
    const { lines, ...cart } = data.cart
    await db.Cart.put(cart)
    await replaceAll(db.CartLine, lines)
  },
  async read({ db }) {
    const cart = await db.Cart.toCollection().first()
    if (!cart) return null
    return { cart: { ...cart, lines: await db.CartLine.orderBy('addedAt').toArray() } }
  },
})
