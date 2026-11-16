import { fail, mutation, nextId, store, type RequestContext } from '../../utils/lab'
import { cartLineView, cartView, findVariant, stockOf, summaryView, totals, touchCart } from '../../utils/shop'

/** A cart line, or a rejection the client can show. */
function findLine(id: string) {
  return store().cart.lines.find(l => l.id === id) ?? fail('NOT_FOUND', `No cart line ${id}`)
}

/** The checks every change of quantity goes through: at least one, and no more than the sites hold. */
function checkQuantity(variantId: string, quantity: number) {
  const { product, variant } = findVariant(variantId)
  if (!Number.isInteger(quantity) || quantity < 1) fail('BAD_USER_INPUT', 'Quantity must be at least 1')
  const stock = stockOf(variantId)
  if (stock === 0) fail('OUT_OF_STOCK', `${product.name} (${variant.name}) is out of stock`)
  if (quantity > stock) fail('NOT_ENOUGH_STOCK', `Only ${stock} of ${product.name} (${variant.name}) left`)
}

/** Puts a variant in the cart as a new line. Exported for moving a wishlist item. */
export function addLine(variantId: string, quantity: number) {
  checkQuantity(variantId, quantity)
  const { cart } = store()
  // One line per variant: a second add is a quantity change the client should send as one.
  if (cart.lines.some(l => l.variantId === variantId)) fail('ALREADY_IN_CART', 'That is already in the cart; change its quantity instead')
  const line = { id: nextId('line'), variantId, quantity, addedAt: new Date().toISOString() }
  cart.lines.push(line)
  touchCart()
  return cartLineView(line)
}

export const cart = {
  Query: {
    cart: () => cartView(),
    orderSummary: () => summaryView(),
    coupons: () => store().coupons.filter(c => !c.expired).map(({ expired: _expired, ...c }) => c),
  },
  Mutation: {
    addCartLine: (_: unknown, { variantId, quantity }: { variantId: string, quantity: number }, ctx: RequestContext) =>
      mutation(ctx, 'addCartLine', `CartVariant:${variantId}`, () => addLine(variantId, quantity)),

    setCartLineQuantity: (_: unknown, { lineId, quantity }: { lineId: string, quantity: number }, ctx: RequestContext) =>
      mutation(ctx, 'setCartLineQuantity', `CartLine:${lineId}`, () => {
        const line = findLine(lineId)
        checkQuantity(line.variantId, quantity)
        line.quantity = quantity
        touchCart()
        return cartLineView(line)
      }),

    removeCartLine: (_: unknown, { lineId }: { lineId: string }, ctx: RequestContext) =>
      mutation(ctx, 'removeCartLine', `CartLine:${lineId}`, () => {
        const { cart } = store()
        findLine(lineId)
        cart.lines = cart.lines.filter(l => l.id !== lineId)
        touchCart()
        return lineId
      }),

    clearCart: (_: unknown, __: unknown, ctx: RequestContext) =>
      mutation(ctx, 'clearCart', 'Cart', () => {
        const { cart } = store()
        cart.lines = []
        cart.couponCode = null
        touchCart()
        return cartView()
      }),

    applyCoupon: (_: unknown, { code }: { code: string }, ctx: RequestContext) =>
      mutation(ctx, 'applyCoupon', 'CartCoupon', () => {
        const coupon = store().coupons.find(c => c.code === code.trim().toUpperCase())
        if (!coupon) fail('INVALID_COUPON', `${code} is not a valid code`)
        if (coupon.expired) fail('COUPON_EXPIRED', `${coupon.code} has expired`)
        if (totals().subtotal < coupon.minimumSubtotal) fail('COUPON_MINIMUM', `${coupon.code} needs a subtotal of $${(coupon.minimumSubtotal / 100).toFixed(2)}`)
        store().cart.couponCode = coupon.code
        touchCart()
        return cartView()
      }),

    removeCoupon: (_: unknown, __: unknown, ctx: RequestContext) =>
      mutation(ctx, 'removeCoupon', 'CartCoupon', () => {
        store().cart.couponCode = null
        touchCart()
        return cartView()
      }),
  },
}
