// Orders: the history, one order, placing and cancelling. Placing an order
// is sent at once (`queue: false`): the queue drains first so the server
// has every change to the cart, and the page waits for the answer.

import type { MaybeRefOrGetter } from 'vue'

export type OrderStatus = NuxtAirplaneStores['Order']['status']

export function useOrders() {
  const query = useQuery('GetOrders')
  return { ...query, orders: computed(() => query.data.value?.orders ?? []) }
}

export function useOrder(id: MaybeRefOrGetter<string>) {
  const query = useQuery('GetOrder', () => ({ id: toValue(id) }))
  return { ...query, order: computed(() => query.data.value?.order ?? null) }
}

export function usePlaceOrder() {
  return useMutation('PlaceOrder', { queue: false })
}

export function useCancelOrder() {
  return useMutation('CancelOrder')
}

/** How each status reads, and what a shopper may still do. */
export const ORDER_STATUS: Record<OrderStatus, { label: string, color: string, step: number }> = {
  PLACED: { label: 'Placed', color: 'info', step: 1 },
  PACKED: { label: 'Packed', color: 'info', step: 2 },
  SHIPPED: { label: 'Shipped', color: 'primary', step: 3 },
  DELIVERED: { label: 'Delivered', color: 'success', step: 4 },
  CANCELLED: { label: 'Cancelled', color: 'error', step: 0 },
}

export const cancellable = (status: OrderStatus) => status === 'PLACED' || status === 'PACKED'
