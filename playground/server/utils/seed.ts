// The starting data for both sides of the app, generated from a fixed seed:
// every run, and every test, starts from the same catalog. Only the product
// count changes, from a few thousand for everyday use to tens of thousands
// for the stress runs.
//
// The shop sells product variants. Inventory management keeps them in sites
// (warehouses), and a variant's stock is what the active sites hold of it, so
// a change on one side shows on the other.

/** Products in the default catalog: quick to load in dev. */
export const DEFAULT_PRODUCTS = 2000
/** Products in the stress catalog: what prefetch, eviction and the worker are for. */
export const STRESS_PRODUCTS = 50_000

export interface Category { id: string, name: string, slug: string, parentId: string | null }
export interface Variant { id: string, productId: string, name: string, sku: string, price: number }
/** A warehouse. `items` is what it holds: on-hand count by variant id. */
export interface Site { id: string, name: string, archived: boolean, createdAt: string, items: Map<string, number> }
export interface Product {
  id: string
  name: string
  brand: string
  description: string
  categoryId: string
  createdAt: string
  variants: Variant[]
}
export interface Review { id: string, productId: string, authorName: string, rating: number, title: string, body: string, createdAt: string, mine: boolean }
export interface CartLine { id: string, variantId: string, quantity: number, addedAt: string }
export interface WishlistItem { id: string, wishlistId: string, productId: string, variantId: string | null, note: string, addedAt: string }
export interface Wishlist { id: string, name: string, createdAt: string, items: WishlistItem[] }
export interface Address { id: string, name: string, line1: string, line2: string, city: string, region: string, postalCode: string, country: string, isDefault: boolean }
export interface OrderLine { id: string, orderId: string, productId: string, variantId: string, productName: string, variantName: string, unitPrice: number, quantity: number }
export interface Order {
  id: string
  number: string
  placedAt: string
  /** Set when cancelled, or for history seeded as delivered. Otherwise the status follows the clock. */
  fixedStatus: 'CANCELLED' | 'DELIVERED' | null
  note: string
  shipTo: string
  subtotal: number
  discount: number
  shipping: number
  tax: number
  total: number
  lines: OrderLine[]
}
export interface Coupon { id: string, code: string, description: string, percentOff: number, minimumSubtotal: number, expired: boolean }
export interface Customer { id: string, name: string, email: string, phone: string, marketingOptIn: boolean }

/** A small, fast, seedable generator (mulberry32): the same seed gives the same sequence. */
export function random(seed: number) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min
  const pick = <T>(list: readonly T[]) => list[Math.floor(next() * list.length)]!
  return { next, int, pick }
}

const CATEGORIES: [string, string[]][] = [
  ['Power Tools', ['Drills', 'Saws', 'Sanders', 'Grinders', 'Batteries']],
  ['Hand Tools', ['Hammers', 'Screwdrivers', 'Wrenches', 'Pliers', 'Chisels']],
  ['Fasteners', ['Screws', 'Nails', 'Bolts', 'Anchors']],
  ['Measuring', ['Tape Measures', 'Levels', 'Squares', 'Laser Tools']],
  ['Safety', ['Gloves', 'Eyewear', 'Hearing', 'Respirators']],
  ['Lighting', ['Flashlights', 'Work Lights', 'Headlamps']],
  ['Storage', ['Tool Boxes', 'Bags', 'Organizers', 'Shelving']],
  ['Outdoor', ['Shovels', 'Rakes', 'Pruners', 'Hoses']],
]

/** What a product in each subcategory is called, before the brand and model. */
const NOUNS: Record<string, string[]> = {
  'Drills': ['Drill Driver', 'Hammer Drill', 'Impact Driver', 'Right-Angle Drill'],
  'Saws': ['Circular Saw', 'Jigsaw', 'Reciprocating Saw', 'Miter Saw'],
  'Sanders': ['Orbital Sander', 'Belt Sander', 'Detail Sander'],
  'Grinders': ['Angle Grinder', 'Bench Grinder', 'Die Grinder'],
  'Batteries': ['Battery Pack', 'Fast Charger', 'Battery Starter Kit'],
  'Hammers': ['Claw Hammer', 'Framing Hammer', 'Sledgehammer', 'Mallet'],
  'Screwdrivers': ['Screwdriver Set', 'Precision Screwdriver', 'Ratcheting Screwdriver'],
  'Wrenches': ['Adjustable Wrench', 'Socket Set', 'Combination Wrench Set', 'Torque Wrench'],
  'Pliers': ['Needle-Nose Pliers', 'Locking Pliers', 'Wire Strippers', 'Tongue-and-Groove Pliers'],
  'Chisels': ['Wood Chisel Set', 'Cold Chisel', 'Mortise Chisel'],
  'Screws': ['Deck Screws', 'Drywall Screws', 'Wood Screws', 'Machine Screws'],
  'Nails': ['Framing Nails', 'Finish Nails', 'Roofing Nails'],
  'Bolts': ['Carriage Bolts', 'Hex Bolts', 'Lag Bolts'],
  'Anchors': ['Drywall Anchors', 'Concrete Anchors', 'Toggle Bolts'],
  'Tape Measures': ['Tape Measure', 'Long Tape', 'Pocket Tape'],
  'Levels': ['Torpedo Level', 'Box Level', 'Post Level'],
  'Squares': ['Speed Square', 'Framing Square', 'Try Square'],
  'Laser Tools': ['Laser Level', 'Laser Distance Meter', 'Line Laser'],
  'Gloves': ['Work Gloves', 'Cut-Resistant Gloves', 'Nitrile Gloves'],
  'Eyewear': ['Safety Glasses', 'Goggles', 'Face Shield'],
  'Hearing': ['Ear Muffs', 'Ear Plugs'],
  'Respirators': ['Dust Mask', 'Half-Face Respirator'],
  'Flashlights': ['Flashlight', 'Penlight', 'Tactical Light'],
  'Work Lights': ['LED Work Light', 'Clamp Light', 'Tripod Light'],
  'Headlamps': ['Headlamp', 'Rechargeable Headlamp'],
  'Tool Boxes': ['Tool Box', 'Rolling Tool Chest', 'Tool Tote'],
  'Bags': ['Tool Bag', 'Tool Backpack', 'Bucket Organizer'],
  'Organizers': ['Parts Organizer', 'Drawer Organizer', 'Bit Case'],
  'Shelving': ['Garage Shelf', 'Wall Rack', 'Pegboard Kit'],
  'Shovels': ['Round Shovel', 'Square Shovel', 'Trenching Shovel'],
  'Rakes': ['Leaf Rake', 'Bow Rake', 'Shrub Rake'],
  'Pruners': ['Bypass Pruner', 'Loppers', 'Hedge Shears'],
  'Hoses': ['Garden Hose', 'Hose Reel', 'Spray Nozzle'],
}

const SITES = ['North Warehouse', 'South Depot', 'East Yard', 'West Storage', 'Downtown Store']
const BRANDS = ['Ironclad', 'Northfield', 'Kestrel', 'Bramble & Co', 'Torque Works', 'Granite', 'Sparrow', 'Halvard', 'Redline', 'Copperleaf', 'Atlas Forge', 'Wexley']
const QUALITIES = ['', 'Pro', 'Compact', 'Heavy-Duty', 'Lightweight', 'Contractor', 'Precision', 'Cordless', 'Max', 'Classic']
const PACKS = [['Single'], ['Single', '2-Pack'], ['Small', 'Medium', 'Large'], ['Bare Tool', 'Kit with Battery', 'Kit with 2 Batteries'], ['25 ft', '35 ft'], ['100 ct', '250 ct', '1000 ct']]
const REVIEWERS = ['Sam K.', 'Priya N.', 'Diego R.', 'Ana M.', 'Chris T.', 'Jordan L.', 'Mei W.', 'Tomás G.', 'Ruth A.', 'Kofi B.', 'Lena S.', 'Owen P.']
const REVIEW_TITLES = [['Broke in a week', 'Not worth it'], ['Disappointing', 'Does the job, barely'], ['Fine for the price', 'Okay'], ['Solid', 'Good value'], ['Excellent', 'Best one I have owned']]

const slug = (text: string) => text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
const iso = (msAgo: number) => new Date(EPOCH - msAgo).toISOString()
/** A fixed "now" for seeded dates, so they are the same on every run. */
const EPOCH = Date.UTC(2026, 9, 1)
const DAY = 24 * 60 * 60 * 1000

export interface Seed {
  categories: Category[]
  products: Product[]
  sites: Site[]
  reviews: Review[]
  coupons: Coupon[]
  customer: Customer
  addresses: Address[]
  wishlists: Wishlist[]
  orders: Order[]
  cart: { id: string, lines: CartLine[], couponCode: string | null, updatedAt: string }
  /** Variants the customer asked to hear about. */
  backInStock: Set<string>
}

export function createSeed(productCount = DEFAULT_PRODUCTS): Seed {
  const r = random(42)

  const categories: Category[] = []
  const leaves: Category[] = []
  CATEGORIES.forEach(([name, children], i) => {
    const parent = { id: `cat-${i + 1}`, name, slug: slug(name), parentId: null }
    categories.push(parent)
    children.forEach((child, j) => {
      const leaf = { id: `cat-${i + 1}-${j + 1}`, name: child, slug: slug(child), parentId: parent.id }
      categories.push(leaf)
      leaves.push(leaf)
    })
  })

  const products: Product[] = []
  for (let n = 1; n <= productCount; n++) {
    const category = leaves[n % leaves.length]!
    const brand = r.pick(BRANDS)
    const quality = r.pick(QUALITIES)
    const noun = r.pick(NOUNS[category.name]!)
    const model = `${String.fromCharCode(65 + r.int(0, 25))}${r.int(100, 999)}`
    const name = [brand, quality, noun, model].filter(Boolean).join(' ')
    const id = `p-${n}`
    const base = r.int(4, 400) * 100 - 1
    const options = r.pick(PACKS)
    products.push({
      id,
      name,
      brand,
      categoryId: category.id,
      description: `The ${name} is a ${quality ? `${quality.toLowerCase()} ` : ''}${noun.toLowerCase()} from ${brand}, built for ${category.name.toLowerCase()} work around the shop and on the job.`,
      createdAt: iso(r.int(0, 720) * DAY),
      variants: options.map((option, k) => ({
        id: `${id}-v${k + 1}`,
        productId: id,
        name: option,
        sku: `${brand.slice(0, 3).toUpperCase()}-${model}-${k + 1}`,
        price: base + k * Math.max(100, Math.round(base * 0.4 / 100) * 100),
      })),
    })
  }

  // Each variant is kept at one or two sites; about one in twelve is at none,
  // and so out of stock.
  const sites: Site[] = SITES.map((name, i) => ({ id: `site-${i + 1}`, name, archived: false, createdAt: iso((400 - i * 30) * DAY), items: new Map() }))
  for (const product of products) {
    for (const variant of product.variants) {
      if (r.next() < 0.08) continue
      const first = r.int(0, sites.length - 1)
      sites[first]!.items.set(variant.id, r.int(1, 60))
      if (r.next() < 0.4) sites[(first + r.int(1, sites.length - 1)) % sites.length]!.items.set(variant.id, r.int(1, 40))
    }
  }

  // Reviews for the first few thousand products only, so a stress catalog stays light.
  const reviews: Review[] = []
  for (const product of products.slice(0, 3000)) {
    const count = r.int(0, 6)
    for (let k = 0; k < count; k++) {
      const rating = Math.min(5, Math.max(1, Math.round(3.6 + (r.next() - 0.4) * 3)))
      reviews.push({
        id: `r-${reviews.length + 1}`,
        productId: product.id,
        authorName: r.pick(REVIEWERS),
        rating,
        title: r.pick(REVIEW_TITLES[rating - 1]!),
        body: `I used the ${product.name.split(' ').slice(-2).join(' ')} for ${r.pick(['a deck build', 'a kitchen remodel', 'weekend projects', 'daily work', 'a fence', 'the garage'])}. ${rating >= 4 ? 'It held up well.' : rating === 3 ? 'It is all right.' : 'I would not buy it again.'}`,
        createdAt: iso(r.int(0, 400) * DAY),
        mine: false,
      })
    }
  }

  const coupons: Coupon[] = [
    { id: 'coupon-save10', code: 'SAVE10', description: '10% off any order', percentOff: 10, minimumSubtotal: 0, expired: false },
    { id: 'coupon-tools20', code: 'TOOLS20', description: '20% off orders over $50', percentOff: 20, minimumSubtotal: 5000, expired: false },
    { id: 'coupon-spring5', code: 'SPRING5', description: '5% off, expired in May', percentOff: 5, minimumSubtotal: 0, expired: true },
  ]

  const customer: Customer = { id: 'customer-1', name: 'Alex Rivera', email: 'alex@example.com', phone: '555-0142', marketingOptIn: false }

  const addresses: Address[] = [
    { id: 'address-1', name: 'Alex Rivera', line1: '18 Larch Street', line2: '', city: 'Portland', region: 'OR', postalCode: '97211', country: 'US', isDefault: true },
    { id: 'address-2', name: 'Rivera Builds (shop)', line1: '400 Industrial Way', line2: 'Unit 7', city: 'Portland', region: 'OR', postalCode: '97217', country: 'US', isDefault: false },
  ]

  const wishlists: Wishlist[] = [{
    id: 'wishlist-1',
    name: 'Shop upgrades',
    createdAt: iso(40 * DAY),
    items: [3, 17, 42].filter(n => n <= products.length).map((n, k) => ({
      id: `wishlist-item-${k + 1}`,
      wishlistId: 'wishlist-1',
      productId: `p-${n}`,
      variantId: null,
      note: k === 0 ? 'Wait for a sale' : '',
      addedAt: iso((30 - k) * DAY),
    })),
  }]

  const orders: Order[] = []
  for (let k = 0; k < 12; k++) {
    const id = `order-${k + 1}`
    const lines: OrderLine[] = []
    for (let l = 0; l < r.int(1, 5); l++) {
      const product = products[r.int(0, Math.min(products.length, 500) - 1)]!
      const variant = r.pick(product.variants)
      lines.push({ id: `${id}-line-${l + 1}`, orderId: id, productId: product.id, variantId: variant.id, productName: product.name, variantName: variant.name, unitPrice: variant.price, quantity: r.int(1, 3) })
    }
    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0)
    const shipping = subtotal >= FREE_SHIPPING ? 0 : SHIPPING
    const tax = Math.round(subtotal * TAX_RATE)
    orders.push({
      id,
      number: `TS-${10_400 + k}`,
      placedAt: iso((12 - k) * 21 * DAY),
      fixedStatus: k === 4 ? 'CANCELLED' : 'DELIVERED',
      note: '',
      shipTo: '18 Larch Street, Portland OR 97211',
      subtotal,
      discount: 0,
      shipping,
      tax,
      total: subtotal + shipping + tax,
      lines,
    })
  }

  return {
    categories,
    products,
    sites,
    reviews,
    coupons,
    customer,
    addresses,
    wishlists,
    orders,
    cart: { id: 'cart-1', lines: [], couponCode: null, updatedAt: iso(0) },
    backInStock: new Set(),
  }
}

/** Orders at or above this subtotal ship free. */
export const FREE_SHIPPING = 10_000
export const SHIPPING = 999
export const TAX_RATE = 0.0825
