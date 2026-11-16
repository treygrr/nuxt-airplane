// The orders a site's items can be listed in. The server and the client's
// offline read sort with the same comparators, so a page is the same rows
// either way.

export type SiteItemSort = 'NAME' | 'SKU' | 'ON_HAND' | 'MIN' | 'MAX' | 'LEVEL'

interface Sortable { productName: string, variantName: string, sku: string, onHand: number, min: number, max: number }

const byName = (a: Sortable, b: Sortable) => a.productName.localeCompare(b.productName) || a.variantName.localeCompare(b.variantName)
/** How full an item is, against its max. One without a max sorts as full. */
const fill = (i: Sortable) => (i.max > 0 ? i.onHand / i.max : Number.POSITIVE_INFINITY)

const ORDER: Record<SiteItemSort, (a: Sortable, b: Sortable) => number> = {
  NAME: byName,
  SKU: (a, b) => a.sku.localeCompare(b.sku),
  ON_HAND: (a, b) => a.onHand - b.onHand,
  MIN: (a, b) => a.min - b.min,
  MAX: (a, b) => a.max - b.max,
  LEVEL: (a, b) => fill(a) - fill(b) || a.onHand - b.onHand,
}

/** A comparator for `sort`, reversed when `descending`. Ties go by name, A to Z. */
export function siteItemOrder(sort: SiteItemSort | null | undefined, descending?: boolean | null) {
  const order = ORDER[sort ?? 'NAME']
  const sign = descending ? -1 : 1
  return (a: Sortable, b: Sortable) => sign * order(a, b) || byName(a, b)
}
