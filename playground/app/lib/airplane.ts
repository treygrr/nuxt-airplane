// Pieces the handlers in app/airplane share.

import type { AirplaneDexie } from '#nuxt-airplane'

/** Stores products as the response has them, and their variants on their own for lookup by id. */
export async function putProducts(db: AirplaneDexie, products: NuxtAirplaneStores['Product'][]) {
  await db.Product.bulkPut(products)
  await db.Variant.bulkPut(products.flatMap(p => p.variants))
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

/**
 * A page shaped like the server's connections: `rows` from `offset`, or,
 * when `at` is given, `rows` already are the page and start at `at`.
 */
export function connection<T>(rows: T[], offset: number, first: number, totalCount: number, at?: number) {
  const slice = at === undefined ? rows.slice(offset, offset + first) : rows
  const start = at ?? offset
  const end = start + slice.length
  return {
    edges: slice.map((node, i) => ({ cursor: encodeCursor(start + i + 1), node })),
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

/** Where the "keep the catalog offline" setting is kept in this browser. */
export const OFFLINE_CATALOG_KEY = 'toolshed:offline-catalog'

export const now = () => new Date().toISOString()

/** Cents as dollars, for descriptions in the pending list. */
export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
