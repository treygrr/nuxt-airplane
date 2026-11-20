// Handlers as an app writes them, with no cast: every line has to compile
// against the types generated from `ops.gql`. Type-checked by codegen.test.
import { hasFields } from '../../../src/runtime/hasFields'
import type { AirplaneDexie, MutationResult, QueryResult } from '../../../src/runtime/types'

declare const db: AirplaneDexie
declare const sites: QueryResult<'GetSites'>
declare const site: QueryResult<'GetSite'>
declare const items: QueryResult<'GetItems'>
declare const search: QueryResult<'Search'>
declare const renamed: MutationResult<'RenameSite'>
declare const created: MutationResult<'CreateSite'>

// Writing: what `store`, `apply` and `reconcile` do.
export async function writes() {
  // A list from a response.
  await db.Site.bulkPut(sites.sites)
  // A detail with nested entities.
  if (site.site) await db.Site.put(site.site)
  // The nodes of a connection, each with a reference to its site.
  await db.Item.bulkPut(items.items.edges.map(e => e.node))
  // A mutation's result, a few fields of the row: an update.
  await db.Site.update(renamed.renameSite.id, renamed.renameSite)
  // A mutation's result with the whole fragment.
  await db.Site.put(created.createSite)
  // Merged with the row that is there.
  const existing = await db.Site.get('s1')
  if (existing) await db.Site.put({ ...existing, ...renamed.renameSite })
  // Rebuilt.
  if (site.site) await db.Site.put({ ...site.site, items: [] })
  // Normalised: the items go to their own table and are left off the site.
  if (site.site) {
    const { items: children, ...row } = site.site
    await db.Site.put(row)
    await db.Item.bulkPut(children)
  }
  // A child that points back at its parent.
  const parent = site.site
  if (parent) await db.Item.bulkPut(parent.items.map(item => ({ ...item, site: parent })))
  // The members of a union, each to its table.
  for (const hit of search.search) {
    if (hit.__typename === 'Site') await db.Site.put(hit)
    else await db.Item.put(hit)
  }
  // A row an `apply` makes.
  await db.Site.put({ id: 'tmp', name: 'x', archived: false })
  // Updates, on two types that point at each other.
  await db.Site.update('s1', { name: 'y' })
  await db.Item.update('i1', { onHand: 3 })
  await db.Site.where('id').equals('s1').modify({ archived: true })
}

// Reading: a row may lack what another query did not store, so `read` checks.
export async function readSites(): Promise<QueryResult<'GetSites'>> {
  return { sites: (await db.Site.toArray()).filter(s => hasFields(s, 'archived', 'owner')) }
}

export async function readSite(): Promise<QueryResult<'GetSite'>> {
  const row = await db.Site.get('s1')
  return { site: hasFields(row, 'archived', 'owner', 'createdAt', 'address', 'items') ? row : null }
}

export async function readItems(): Promise<QueryResult<'GetItems'>> {
  const rows = (await db.Item.toArray()).filter(i => hasFields(i, 'sku', 'onHand', 'status', 'site'))
  return { items: { edges: rows.map(node => ({ cursor: node.id, node })), pageInfo: { hasNextPage: false, endCursor: null }, totalCount: rows.length } }
}

export async function readSearch(): Promise<QueryResult<'Search'>> {
  const found = (await db.Site.toArray()).map(s => ({ __typename: 'Site' as const, ...s }))
  const things = (await db.Item.toArray()).filter(i => hasFields(i, 'sku')).map(i => ({ __typename: 'Item' as const, ...i }))
  return { search: [...found, ...things] }
}

// Without the check, a row that may lack a field the query needs is still an error.
export async function unchecked(): Promise<QueryResult<'GetSites'>> {
  // @ts-expect-error `archived` may be missing
  return { sites: (await db.Site.toArray()).filter(s => hasFields(s, 'owner')) }
}
