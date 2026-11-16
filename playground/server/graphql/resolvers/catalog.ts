import { catalogStamp, store } from '../../utils/lab'
import { findProduct, paginate, productView, stockOf } from '../../utils/shop'
import type { Product } from '../../utils/seed'

type Sort = 'NAME' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING' | 'NEWEST'
interface ListArgs { first?: number | null, after?: string | null, categoryId?: string | null, search?: string | null, sort?: Sort | null, inStockOnly?: boolean | null }

/**
 * Filtered and sorted listings, by their arguments. Prefetching a whole
 * catalog asks for the same listing hundreds of times, one page after the
 * other: it is sorted once.
 */
const listings = new Map<string, ReturnType<typeof productView>[]>()

function listing({ categoryId, search, sort, inStockOnly }: ListArgs) {
  const key = JSON.stringify([catalogStamp(), store().products.length, categoryId, search?.trim().toLowerCase(), sort, inStockOnly])
  const cached = listings.get(key)
  if (cached) return cached

  const { categories, products } = store()
  const inCategory = categoryId ? new Set([categoryId, ...categories.filter(c => c.parentId === categoryId).map(c => c.id)]) : null
  const q = search?.trim().toLowerCase()
  const matches = (p: Product) => (!inCategory || inCategory.has(p.categoryId))
    && (!q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q))
    && (!inStockOnly || p.variants.some(v => stockOf(v.id) > 0))
  const views = products.filter(matches).map(productView)
  const byName = (a: { name: string, id: string }, b: { name: string, id: string }) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
  const order: Record<Sort, (a: ReturnType<typeof productView>, b: ReturnType<typeof productView>) => number> = {
    NAME: byName,
    PRICE_ASC: (a, b) => a.price - b.price || byName(a, b),
    PRICE_DESC: (a, b) => b.price - a.price || byName(a, b),
    RATING: (a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount || byName(a, b),
    NEWEST: (a, b) => b.createdAt.localeCompare(a.createdAt) || byName(a, b),
  }
  views.sort(order[sort ?? 'NAME'])

  if (listings.size > 50) listings.delete(listings.keys().next().value!)
  listings.set(key, views)
  return views
}

export const catalog = {
  Query: {
    categories: () => {
      const { categories, products } = store()
      const counts = new Map<string, number>()
      for (const p of products) counts.set(p.categoryId, (counts.get(p.categoryId) ?? 0) + 1)
      return categories.map(c => ({
        ...c,
        productCount: c.parentId ? counts.get(c.id) ?? 0 : categories.filter(child => child.parentId === c.id).reduce((n, child) => n + (counts.get(child.id) ?? 0), 0),
      }))
    },
    products: (_: unknown, args: ListArgs) => paginate(listing(args), args.first, args.after),
    featuredProducts: () => listing({ sort: 'RATING' }).filter(p => p.reviewCount >= 3).slice(0, 12),
    product: (_: unknown, { id }: { id: string }) => {
      const product = findProduct(id)
      return product ? productView(product) : null
    },
    searchSuggestions: (_: unknown, { query }: { query: string }) => {
      const q = query.trim().toLowerCase()
      if (q.length < 2) return []
      const names = new Set<string>()
      for (const p of store().products) {
        if (p.name.toLowerCase().includes(q)) names.add(p.name)
        if (names.size >= 8) break
      }
      return [...names]
    },
  },
}
