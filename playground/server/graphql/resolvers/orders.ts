import { catalogChanged, fail, mutation, nextId, store, type RequestContext } from '../../utils/lab'
import { cartLineView, orderStatus, orderView, returnStock, stockOf, takeStock, totals, touchCart } from '../../utils/shop'
import type { Order } from '../../utils/seed'

const findOrder = (id: string) => store().orders.find(o => o.id === id) ?? fail('NOT_FOUND', `No order ${id}`)
const newestFirst = (a: Order, b: Order) => b.placedAt.localeCompare(a.placedAt)

export const orders = {
  Query: {
    orders: () => [...store().orders].sort(newestFirst).map(orderView),
    order: (_: unknown, { id }: { id: string }) => {
      const order = store().orders.find(o => o.id === id)
      return order ? orderView(order) : null
    },
  },
  Mutation: {
    placeOrder: (_: unknown, { addressId, note }: { addressId: string, note?: string | null }, ctx: RequestContext) =>
      mutation(ctx, 'placeOrder', 'Cart', () => {
        const data = store()
        const lines = data.cart.lines.map(cartLineView)
        if (!lines.length) fail('EMPTY_CART', 'The cart is empty')
        const address = data.addresses.find(a => a.id === addressId) ?? fail('NOT_FOUND', `No address ${addressId}`)
        // Check every line before taking any stock, so a short line takes nothing.
        for (const line of lines) {
          const left = stockOf(line.variantId)
          if (left < line.quantity) fail('NOT_ENOUGH_STOCK', `Only ${left} of ${line.productName} (${line.variantName}) left`)
        }
        const sum = totals()
        for (const line of lines) takeStock(line.variantId, line.quantity, `${line.productName} (${line.variantName})`)
        const id = nextId('order')
        const order: Order = {
          id,
          number: `TS-${10_400 + data.orders.length}`,
          placedAt: new Date().toISOString(),
          fixedStatus: null,
          note: note ?? '',
          shipTo: [address.line1, address.line2, `${address.city} ${address.region} ${address.postalCode}`].filter(Boolean).join(', '),
          subtotal: sum.subtotal,
          discount: sum.discount,
          shipping: sum.shipping,
          tax: sum.tax,
          total: sum.total,
          lines: lines.map((line, i) => ({ id: `${id}-line-${i + 1}`, orderId: id, productId: line.productId, variantId: line.variantId, productName: line.productName, variantName: line.variantName, unitPrice: line.unitPrice, quantity: line.quantity })),
        }
        data.orders.push(order)
        data.cart.lines = []
        data.cart.couponCode = null
        touchCart()
        catalogChanged()
        return orderView(order)
      }),

    cancelOrder: (_: unknown, { id }: { id: string }, ctx: RequestContext) =>
      mutation(ctx, 'cancelOrder', `Order:${id}`, () => {
        const order = findOrder(id)
        const status = orderStatus(order)
        if (status !== 'PLACED' && status !== 'PACKED') fail('CANNOT_CANCEL', `Order ${order.number} is ${status.toLowerCase()} and can no longer be cancelled`)
        order.fixedStatus = 'CANCELLED'
        for (const line of order.lines) returnStock(line.variantId, line.quantity)
        catalogChanged()
        return orderView(order)
      }),

    notifyBackInStock: (_: unknown, { variantId }: { variantId: string }, ctx: RequestContext) =>
      mutation(ctx, 'notifyBackInStock', null, () => {
        store().backInStock.add(variantId)
        return true
      }),
  },
}
