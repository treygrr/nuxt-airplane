// Indexes for the inferred tables (the module keys each on its id), and one
// table of the app's own.
//
// Booleans cannot be indexed in IndexedDB: `archived`, `mine` and `isDefault`
// are filtered in the read handlers instead.

declare global {
  interface NuxtAirplaneStores {
    /** How many results a listing has in all, as the server last said. */
    Listing: { key: string, totalCount: number }
  }
}

export default defineAirplaneStores({
  Category: 'parentId',
  Product: 'categoryId, name, price, rating, createdAt, reviewCount, [price+name]',
  Variant: 'productId',
  CartLine: 'addedAt, variantId',
  Coupon: 'code',
  Wishlist: 'createdAt',
  WishlistItem: 'wishlistId, addedAt',
  Address: 'name',
  Order: 'placedAt',
  Review: 'productId, createdAt',
  Site: 'createdAt, name',
  SiteItem: 'siteId, [siteId+productName]',
  Listing: '&key',
})
