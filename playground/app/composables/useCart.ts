// The cart: its lines, what it comes to, and every change to it. The app
// bar, the product page and the cart page all use it; their queries share
// one request in flight.

export function useCart() {
  const cartQuery = useAirplaneQuery('GetCart')
  const summaryQuery = useAirplaneQuery('GetOrderSummary')

  const addLine = useMutation('AddCartLine')
  const setQuantity = useMutation('SetCartLineQuantity')
  const removeLine = useMutation('RemoveCartLine')
  const clear = useMutation('ClearCart')
  const applyCoupon = useMutation('ApplyCoupon')
  const removeCoupon = useMutation('RemoveCoupon')

  const cart = computed(() => cartQuery.data.value?.cart ?? null)
  const lines = computed(() => cart.value?.lines ?? [])
  const count = computed(() => lines.value.reduce((n, line) => n + line.quantity, 0))
  const summary = computed(() => summaryQuery.data.value?.orderSummary ?? null)

  /**
   * Puts a variant in the cart: a new line, or more of the line it already
   * has. The server keeps one line per variant.
   */
  function add(variantId: string, quantity = 1) {
    const line = lines.value.find(l => l.variantId === variantId)
    return line
      ? setQuantity.mutate({ lineId: line.id, quantity: line.quantity + quantity })
      : addLine.mutate({ variantId, quantity })
  }

  return {
    cart,
    lines,
    count,
    summary,
    loading: cartQuery.loading,
    summaryFetching: summaryQuery.fetching,
    add,
    setQuantity,
    removeLine,
    clear,
    applyCoupon,
    removeCoupon,
  }
}
