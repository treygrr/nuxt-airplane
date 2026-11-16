// Pieces the handlers in app/airplane share. Kept outside that directory:
// every file in it is imported for its default export (FINDINGS.md, 4).

import type { AirplaneDexie } from '#nuxt-airplane'

type Products = { id: string, variants: { id: string }[] }[]

/** Stores products as the response has them, and their variants on their own for lookup by id. */
export async function putProducts(db: AirplaneDexie, products: Products) {
  await db.Product.bulkPut(products as never)
  await db.Variant.bulkPut(products.flatMap(p => p.variants) as never)
}

/**
 * Lists the server answers in full: what the table holds afterwards is
 * exactly the response, so a row removed elsewhere goes here too.
 */
export async function replaceAll<T>(table: { clear: () => Promise<void>, bulkPut: (rows: T[]) => Promise<unknown> }, rows: T[]) {
  await table.clear()
  await table.bulkPut(rows)
}

// The server's cursors are offsets, encoded. Reading a page from the tables
// offline means reading the same offset.
export const encodeCursor = (offset: number) => btoa(`o:${offset}`)
export function decodeCursor(cursor: string | null | undefined) {
  if (!cursor) return 0
  const n = Number(atob(cursor).slice(2))
  return Number.isInteger(n) && n >= 0 ? n : 0
}

/** A page of `rows` shaped like the server's connections. */
export function connection<T>(rows: T[], offset: number, first: number, totalCount: number) {
  const slice = rows.slice(offset, offset + first)
  const end = offset + slice.length
  return {
    edges: slice.map((node, i) => ({ cursor: encodeCursor(offset + i + 1), node })),
    pageInfo: { hasNextPage: end < totalCount, endCursor: slice.length ? encodeCursor(end) : null },
    totalCount,
  }
}

/**
 * The key a listing's total is kept under. The server knows how many there
 * are in all; the tables may hold only the pages seen so far.
 */
export const listingKey = (kind: string, filters: Record<string, unknown>) =>
  `${kind}:${JSON.stringify(Object.entries(filters).filter(([, v]) => v != null && v !== '').sort())}`

export const now = () => new Date().toISOString()

/** Cents as dollars, for descriptions in the pending list. */
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
