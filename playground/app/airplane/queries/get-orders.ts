// Order history, newest first. An order's status moves on by itself on the
// server, so a mounted order list goes stale until it is refetched.

import { replaceAll } from '../../lib/airplane'

export default defineQueryHandler('GetOrders', {
  store: ({ db }, data) => replaceAll(db.Order, data.orders),
  read: async ({ db }) => ({ orders: await db.Order.orderBy('placedAt').reverse().toArray() }),
})
