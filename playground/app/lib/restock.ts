// Restock quantities and levels, as the inventory pages and carts show them.
// The server holds the same rules and turns down a quantity that breaks them.

export interface OrderRules { boxQuantity?: number | null, minOrderQuantity?: number | null }
export interface Levels { onHand: number, min: number, max: number }

/** The smallest quantity at least `wanted` that may be ordered: no less than the minimum order, in whole boxes. */
export function fitRestock(rules: OrderRules, wanted: number) {
  let quantity = Math.max(1, Math.ceil(wanted), rules.minOrderQuantity ?? 1)
  if (rules.boxQuantity) quantity = Math.ceil(quantity / rules.boxQuantity) * rules.boxQuantity
  return quantity
}

/** What to order to bring an item up to its max, counting what is in the cart already. */
export function suggestedRestock(item: Levels & OrderRules, inCart = 0) {
  return fitRestock(item, item.max - item.onHand - inCart)
}

export type LevelStatus = 'low' | 'ok' | 'over'

/** Below its minimum, between its levels, or above its maximum. */
export function levelStatus(item: Levels): LevelStatus {
  if (item.onHand < item.min) return 'low'
  if (item.onHand > item.max) return 'over'
  return 'ok'
}

export const LEVEL_STATUS: Record<LevelStatus, { title: string, color: string }> = {
  low: { title: 'Below min', color: 'error' },
  ok: { title: 'In range', color: 'success' },
  over: { title: 'Over max', color: 'warning' },
}

/** The ordering rules in words, for a hint under a quantity. */
export function rulesText(rules: OrderRules) {
  return [
    rules.boxQuantity && `Boxes of ${rules.boxQuantity}`,
    rules.minOrderQuantity && `Min order ${rules.minOrderQuantity}`,
  ].filter(Boolean).join(' · ')
}
