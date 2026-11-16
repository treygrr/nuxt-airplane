// The catalog. Every page is kept, and with the "keep catalog offline"
// setting on, the whole of it is fetched in the background after the first
// page, so browsing, searching and sorting work offline.
//
// `read` answers any filter and sort from the tables, also ones the server
// was never asked: a search typed offline finds what is stored.

import { connection, decodeCursor, listingKey, putProducts } from '../../lib/airplane'

type ProductRow = NuxtAirplaneStores['Product']
type Sort = 'NAME' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING' | 'NEWEST'

const byName = (a: ProductRow, b: ProductRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
const ORDER: Record<Sort, (a: ProductRow, b: ProductRow) => number> = {
  NAME: byName,
  PRICE_ASC: (a, b) => a.price - b.price || byName(a, b),
  PRICE_DESC: (a, b) => b.price - a.price || byName(a, b),
  RATING: (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount || byName(a, b),
  NEWEST: (a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b),
}

/** Pages the background walk asks for: larger than a screenful, fewer round trips. */
const PREFETCH_PAGE = 200

/** The "keep catalog offline" setting, kept in this browser. */
export const OFFLINE_CATALOG_KEY = 'toolshed:offline-catalog'

export default defineQueryHandler('GetProducts', {
  async store({ db, variables }, data) {
    await putProducts(db, data.products.edges.map(e => e.node))
    const { categoryId, search, inStockOnly } = variables ?? {}
    await db.Listing.put({ key: listingKey('products', { categoryId, search, inStockOnly }), totalCount: data.products.totalCount })
  },

  async read({ db, variables }) {
    const { first = 24, after, categoryId, search, sort = 'NAME', inStockOnly } = variables ?? {}
    let rows: ProductRow[]
    if (categoryId) {
      const children = await db.Category.where('parentId').equals(categoryId).primaryKeys()
      rows = await db.Product.where('categoryId').anyOf([categoryId, ...children]).toArray()
    }
    else rows = await db.Product.toArray()
    const q = search?.trim().toLowerCase()
    if (q) rows = rows.filter(p => p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
    if (inStockOnly) rows = rows.filter(p => p.variants.some(v => v.stock > 0))
    rows.sort(ORDER[sort ?? 'NAME'])
    // The server's count when it has said, or what the tables hold.
    const known = (await db.Listing.get(listingKey('products', { categoryId, search, inStockOnly })))?.totalCount ?? 0
    return { products: connection(rows, decodeCursor(after), first ?? 24, Math.max(known, rows.length)) }
  },

  prefetch: {
    // Only the whole catalog is walked, not every search or filter on it.
    next: (data, variables) => {
      const { search, categoryId, inStockOnly } = variables ?? {}
      if (search || categoryId || inStockOnly || !data.products.pageInfo.hasNextPage) return null
      return { ...variables, first: PREFETCH_PAGE, after: data.products.pageInfo.endCursor }
    },
    when: () => {
      try {
        return localStorage.getItem(OFFLINE_CATALOG_KEY) !== 'off'
      }
      catch {
        return true
      }
    },
  },
})
