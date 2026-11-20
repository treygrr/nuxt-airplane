// The catalog: every query about categories, products and reviews goes
// through here, so each has one home.

import type { MaybeRefOrGetter } from 'vue'

export type ProductSort = 'NAME' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING' | 'NEWEST'

/** Every category, with helpers for the two-level tree. */
export function useCategories() {
  const query = useAirplaneQuery('GetCategories')
  const all = computed(() => query.data.value?.categories ?? [])
  const top = computed(() => all.value.filter(c => !c.parentId))
  const childrenOf = (id: string) => all.value.filter(c => c.parentId === id)
  const byId = (id: string) => all.value.find(c => c.id === id)
  return { ...query, all, top, childrenOf, byId }
}

export interface ProductFilters {
  categoryId?: string | null
  search?: string | null
  sort?: ProductSort
  inStockOnly?: boolean | null
  /** How many from the start: "load more" asks for more. */
  first: number
}

export function useProducts(filters: MaybeRefOrGetter<ProductFilters>) {
  const query = useAirplaneQuery('GetProducts', () => {
    const { categoryId, search, sort, inStockOnly, first } = toValue(filters)
    return { first, categoryId: categoryId || null, search: search?.trim() || null, sort: sort ?? 'NAME', inStockOnly: inStockOnly || null }
  })
  const products = computed(() => query.data.value?.products.edges.map(e => e.node) ?? [])
  const total = computed(() => query.data.value?.products.totalCount ?? 0)
  return { ...query, products, total }
}

export function useFeaturedProducts() {
  const query = useAirplaneQuery('GetFeaturedProducts')
  return { ...query, products: computed(() => query.data.value?.featuredProducts ?? []) }
}

export function useProduct(id: MaybeRefOrGetter<string>) {
  const query = useAirplaneQuery('GetProduct', () => ({ id: toValue(id) }))
  return { ...query, product: computed(() => query.data.value?.product ?? null) }
}

/**
 * Name completions from the server, an online query: never kept, asked for
 * only once two characters are typed, and offline there are none, which the
 * search box does without.
 */
export function useSearchSuggestions(text: MaybeRefOrGetter<string>) {
  const term = computed(() => toValue(text).trim())
  const query = useOnlineQuery('GetSearchSuggestions', () => ({ query: term.value }), { enabled: () => term.value.length >= 2 })
  return computed(() => (term.value.length >= 2 ? query.data.value?.searchSuggestions ?? [] : []))
}

export function useReviews(productId: MaybeRefOrGetter<string>) {
  const query = useAirplaneQuery('GetReviews', () => ({ productId: toValue(productId) }))
  return {
    ...query,
    reviews: computed(() => query.data.value?.reviews ?? []),
    create: useMutation('CreateReview'),
    update: useMutation('UpdateReview'),
    remove: useMutation('DeleteReview'),
  }
}

export function useBackInStock() {
  return useMutation('NotifyBackInStock')
}
