// The home page's picks: the best rated with a few reviews, by the same rule
// as the server, so the tables can answer it offline.

import { putProducts } from '../../lib/airplane'

export default defineQueryHandler('GetFeaturedProducts', {
  store: ({ db }, data) => putProducts(db, data.featuredProducts),
  read: async ({ db }) => ({
    featuredProducts: await db.Product.orderBy('rating').reverse().filter(p => p.reviewCount >= 3).limit(12).toArray(),
  }),
})
