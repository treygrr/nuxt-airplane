// Lists and their items, each in a table of its own.

import { replaceAll } from '../../lib/airplane'

export default defineQueryHandler('GetWishlists', {
  async store({ db }, data) {
    await replaceAll(db.Wishlist, data.wishlists.map(({ items: _items, ...list }) => list))
    await replaceAll(db.WishlistItem, data.wishlists.flatMap(list => list.items))
  },
  async read({ db }) {
    const lists = await db.Wishlist.orderBy('createdAt').toArray()
    const items = await db.WishlistItem.orderBy('addedAt').toArray()
    return { wishlists: lists.map(list => ({ ...list, items: items.filter(i => i.wishlistId === list.id) })) }
  },
})
