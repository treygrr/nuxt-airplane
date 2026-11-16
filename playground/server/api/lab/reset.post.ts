// Starts over: fresh data (of `products` products, or the same number), calm
// settings, zeroed counters.
import { reset } from '../../utils/lab'
import { STRESS_PRODUCTS } from '../../utils/seed'

export default defineEventHandler(async (event) => {
  const { products, stress } = (await readBody<{ products?: number, stress?: boolean }>(event)) ?? {}
  reset({ products: stress ? STRESS_PRODUCTS : products })
  return { ok: true }
})
