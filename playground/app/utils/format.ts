// Display helpers, auto-imported in components.

const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** Cents as dollars: 1299 → "$12.99". */
export const formatMoney = (cents: number) => dollars.format(cents / 100)

/** A date as "Nov 15, 2026". */
export const formatDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
