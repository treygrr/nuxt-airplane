// Lookups and views shared by the resolvers. A view is a plain object built
// when it is asked for, so the answer a mutation gives is a snapshot: what
// the idempotency cache hands back to a retry is what the first attempt saw.

import { catalogStamp, fail, store } from './lab'
import { FREE_SHIPPING, SHIPPING, TAX_RATE, type Order, type Product, type Site, type Variant } from './seed'

// ---------------------------------------------------------------------------
// Indexes, rebuilt when the catalog is reseeded or changes
// ---------------------------------------------------------------------------

let indexed: { data: ReturnType<typeof store>, stamp: number } | undefined
let products = new Map<string, Product>()
let variants = new Map<string, { product: Product, variant: Variant }>()
let ratings = new Map<string, { sum: number, count: number }>()

function index() {
  const data = store()
  if (indexed?.data === data && indexed.stamp === catalogStamp()) return
  products = new Map(data.products.map(p => [p.id, p]))
  variants = new Map(data.products.flatMap(product => product.variants.map(variant => [variant.id, { product, variant }])))
  ratings = new Map()
  for (const review of data.reviews) {
    const r = ratings.get(review.productId) ?? { sum: 0, count: 0 }
    r.sum += review.rating
    r.count++
    ratings.set(review.productId, r)
  }
  indexed = { data, stamp: catalogStamp() }
}

export function findProduct(id: string) {
  index()
  return products.get(id)
}

export function findVariant(id: string) {
  index()
  return variants.get(id) ?? fail('NOT_FOUND', `No variant ${id}`)
}

export const imageUrl = (productId: string) => `/img/p/${productId}.svg`

// ---------------------------------------------------------------------------
// Stock: what the active sites hold
// ---------------------------------------------------------------------------

export function stockOf(variantId: string) {
  let total = 0
  for (const site of store().sites) {
    if (!site.archived) total += site.items.get(variantId) ?? 0
  }
  return total
}

/** Takes units from the active sites, the fullest first. Fails, taking nothing, when they do not hold enough. */
export function takeStock(variantId: string, quantity: number, name: string) {
  if (stockOf(variantId) < quantity) fail('NOT_ENOUGH_STOCK', `Only ${stockOf(variantId)} of ${name} left`)
  const sites = store().sites.filter(s => !s.archived && (s.items.get(variantId) ?? 0) > 0)
    .sort((a, b) => b.items.get(variantId)! - a.items.get(variantId)!)
  let left = quantity
  for (const site of sites) {
    const take = Math.min(left, site.items.get(variantId)!)
    site.items.set(variantId, site.items.get(variantId)! - take)
    left -= take
    if (!left) break
  }
}

/** Puts units back at the first active site that holds the variant, or the first active site. */
export function returnStock(variantId: string, quantity: number) {
  const active = store().sites.filter(s => !s.archived)
  const site = active.find(s => s.items.has(variantId)) ?? active[0]
  if (site) site.items.set(variantId, (site.items.get(variantId) ?? 0) + quantity)
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export const variantView = (v: Variant) => ({ ...v, stock: stockOf(v.id) })

export function productView(p: Product) {
  index()
  const r = ratings.get(p.id)
  return {
    id: p.id,
    name: p.name,
    brand: p.brand,
    description: p.description,
    categoryId: p.categoryId,
    price: Math.min(...p.variants.map(v => v.price)),
    rating: r ? Math.round((r.sum / r.count) * 10) / 10 : 0,
    reviewCount: r?.count ?? 0,
    imageUrl: imageUrl(p.id),
    createdAt: p.createdAt,
    variants: p.variants.map(variantView),
  }
}

export function siteView(site: Site) {
  let units = 0
  for (const n of site.items.values()) units += n
  return { id: site.id, name: site.name, archived: site.archived, createdAt: site.createdAt, itemCount: site.items.size, unitCount: units }
}

export const siteItemId = (siteId: string, variantId: string) => `${siteId}~${variantId}`

export function siteItemView(siteId: string, variantId: string, onHand: number) {
  const { product, variant } = findVariant(variantId)
  return { id: siteItemId(siteId, variantId), siteId, variantId, productId: product.id, productName: product.name, variantName: variant.name, sku: variant.sku, onHand }
}

export function cartLineView(line: { id: string, variantId: string, quantity: number, addedAt: string }) {
  const { product, variant } = findVariant(line.variantId)
  return {
    id: line.id,
    cartId: store().cart.id,
    productId: product.id,
    variantId: variant.id,
    productName: product.name,
    variantName: variant.name,
    imageUrl: imageUrl(product.id),
    unitPrice: variant.price,
    quantity: line.quantity,
    addedAt: line.addedAt,
  }
}

export function couponView(code: string | null) {
  const coupon = code ? store().coupons.find(c => c.code === code) : undefined
  if (!coupon) return null
  const { expired: _expired, ...view } = coupon
  return view
}

export function cartView() {
  const { cart } = store()
  return { id: cart.id, lines: cart.lines.map(cartLineView), coupon: couponView(cart.couponCode), updatedAt: cart.updatedAt }
}

/** What the cart comes to: subtotal, the coupon's discount, shipping, tax. */
export function totals() {
  const { cart } = store()
  const lines = cart.lines.map(cartLineView)
  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
  const coupon = couponView(cart.couponCode)
  const discount = coupon && subtotal >= coupon.minimumSubtotal ? Math.round((subtotal * coupon.percentOff) / 100) : 0
  const taxable = subtotal - discount
  const shipping = subtotal === 0 || taxable >= FREE_SHIPPING ? 0 : SHIPPING
  const tax = Math.round(taxable * TAX_RATE)
  return { itemCount: lines.reduce((n, line) => n + line.quantity, 0), subtotal, discount, shipping, tax, total: taxable + shipping + tax }
}

export const summaryView = () => ({ id: store().cart.id, ...totals() })

/** An order's status follows the clock from when it was placed, unless it was cancelled. */
export function orderStatus(order: Order, now = Date.now()) {
  if (order.fixedStatus) return order.fixedStatus
  const seconds = (now - Date.parse(order.placedAt)) / 1000
  if (seconds < 30) return 'PLACED'
  if (seconds < 90) return 'PACKED'
  if (seconds < 180) return 'SHIPPED'
  return 'DELIVERED'
}

export function orderView(order: Order) {
  const { fixedStatus: _fixed, ...rest } = order
  return { ...rest, status: orderStatus(order), lines: order.lines.map(line => ({ ...line })) }
}

export const touchCart = () => void (store().cart.updatedAt = new Date().toISOString())

/** An offset cursor: opaque to the client, and stable while the list is. */
export const encodeCursor = (offset: number) => Buffer.from(`o:${offset}`).toString('base64')
export function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return 0
  const offset = Number(Buffer.from(cursor, 'base64').toString().slice(2))
  return Number.isInteger(offset) && offset >= 0 ? offset : fail('BAD_USER_INPUT', 'Invalid cursor')
}

export function paginate<T>(all: T[], first: number | null | undefined, after: string | null | undefined, max = 500) {
  const size = first ?? 24
  if (size < 1 || size > max) fail('BAD_USER_INPUT', `first must be between 1 and ${max}`)
  const start = decodeCursor(after)
  const slice = all.slice(start, start + size)
  const end = start + slice.length
  return {
    edges: slice.map((node, i) => ({ cursor: encodeCursor(start + i + 1), node })),
    pageInfo: { hasNextPage: end < all.length, endCursor: slice.length ? encodeCursor(end) : null },
    totalCount: all.length,
  }
}
