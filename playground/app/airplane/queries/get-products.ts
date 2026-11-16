// The catalog. Every page is kept, and with the "keep catalog offline"
// setting on, the whole of it is fetched in the background after the first
// page, so browsing, searching and sorting work offline.
//
// `read` answers any filter and sort from the tables, also ones the server
// was never asked: a search typed offline finds what is stored.

import { OFFLINE_CATALOG_KEY, connection, decodeCursor, listingKey, putProducts } from '../../lib/airplane'

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

export default defineQueryHandler('GetProducts', {
  async store({ db, variables }, data) {
    await putProducts(db, data.products.edges.map(e => e.node))
    const { categoryId, search, inStockOnly } = variables ?? {}
    await db.Listing.put({ key: listingKey('products', { categoryId, search, inStockOnly }), totalCount: data.products.totalCount })
  },

  async read({ db, variables }) {
    const { first = 24, after, categoryId, search, sort = 'NAME', inStockOnly } = variables ?? {}
    const offset = decodeCursor(after)
    const size = first ?? 24
    const q = search?.trim().toLowerCase()
    const matches = (p: ProductRow) => (!q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
      && (!inStockOnly || p.variants.some(v => v.stock > 0))
    const filtered = !!q || !!inStockOnly
    // The server's count when it has said, or what the tables hold.
    const known = (await db.Listing.get(listingKey('products', { categoryId, search, inStockOnly })))?.totalCount ?? 0

    if (categoryId) {
      // A category is a few thousand products at most: read it and sort it here.
      const children = await db.Category.where('parentId').equals(categoryId).primaryKeys()
      const rows = (await db.Product.where('categoryId').anyOf([categoryId, ...children]).toArray()).filter(matches).sort(ORDER[sort ?? 'NAME'])
      return { products: connection(rows, offset, size, Math.max(known, rows.length)) }
    }

    // The whole catalog: walk an index in the sort order, only as far as the
    // page needs. Loading every product and sorting it would run again on
    // each write to the table, once per page while the catalog is fetched in
    // the background (FINDINGS.md, 7). Ties come out in id order here, which
    // can differ from the server's.
    const ordered = () => {
      switch (sort) {
        case 'PRICE_ASC': return db.Product.orderBy('[price+name]')
        case 'PRICE_DESC': return db.Product.orderBy('[price+name]').reverse()
        case 'RATING': return db.Product.orderBy('rating').reverse()
        case 'NEWEST': return db.Product.orderBy('createdAt').reverse()
        default: return db.Product.orderBy('name')
      }
    }
    if (filtered) {
      // A search or the stock filter has to look at every product: once, in
      // table order, then sort and count what matched.
      const rows = (await db.Product.filter(matches).toArray()).sort(ORDER[sort ?? 'NAME'])
      return { products: connection(rows, offset, size, Math.max(known, rows.length)) }
    }
    const page = await ordered().offset(offset).limit(size).toArray()
    return { products: connection(page, 0, size, known || await db.Product.count(), offset) }
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
