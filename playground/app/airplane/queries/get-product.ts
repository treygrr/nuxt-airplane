// One product. Every product page visited leaves a fetch record behind,
// which is what eviction drops first when storage runs low.

import { putProducts } from '../../lib/airplane'

export default defineQueryHandler('GetProduct', {
  store: async ({ db }, data) => {
    if (data.product) await putProducts(db, [data.product])
  },
  read: async ({ db, variables }) => ({ product: (await db.Product.get(variables.id)) ?? null }),
})
