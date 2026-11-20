// The same handlers under codegen's `nonOptionalTypename: true`, where the
// module asks for `__typename` everywhere: rows carry it, required, and
// every line still compiles with no cast. Type-checked by codegen.test.
import type { ItemRow, SiteCardFragment, SiteRow } from '#types'
import { hasFields } from '../../../src/runtime/hasFields'
import type { AirplaneDexie, MutationResult, QueryHandler, QueryResult } from '../../../src/runtime/types'

declare const db: AirplaneDexie
declare const sites: QueryResult<'GetSites'>
declare const site: QueryResult<'GetSite'>
declare const items: QueryResult<'GetItems'>
declare const found: QueryResult<'Search'>
declare const renamed: MutationResult<'RenameSite'>
declare const created: MutationResult<'CreateSite'>

export async function writes() {
  await db.Site.bulkPut(sites.sites)
  if (site.site) await db.Site.put(site.site)
  await db.Item.bulkPut(items.items.edges.map(e => e.node))
  await db.Site.update(renamed.renameSite.id, renamed.renameSite)
  await db.Site.put(created.createSite)
  const existing = await db.Site.get('s1')
  if (existing) await db.Site.put({ ...existing, ...renamed.renameSite })
  if (site.site) {
    const { items: children, ...row } = site.site
    await db.Site.put(row)
    await db.Item.bulkPut(children)
  }
  const parent = site.site
  if (parent) await db.Item.bulkPut(parent.items.map(item => ({ ...item, site: parent })))
  for (const hit of found.search) {
    if (hit.__typename === 'Site') await db.Site.put(hit)
    else await db.Item.put(hit)
  }
  // A row an `apply` makes says what it is, as one from the server does.
  await db.Site.put({ __typename: 'Site', id: 'tmp', name: 'x', archived: false })
  await db.Site.update('s1', { name: 'y' })
}

// `read` returns rows as they are, and leaves the root's `__typename` to the client.
export const getSites: QueryHandler<'GetSites'> = {
  read: async ({ db }) => ({ sites: (await db.Site.toArray()).filter(s => hasFields(s, 'archived', 'owner')) }),
}

export const search: QueryHandler<'Search'> = {
  read: async ({ db }) => ({ search: [...await db.Site.toArray(), ...(await db.Item.toArray()).filter(i => hasFields(i, 'sku'))] }),
}

// Returning it as well is fine; returning another one is not.
export const getSite: QueryHandler<'GetSite'> = {
  read: async ({ db }) => {
    const row = await db.Site.get('s1')
    return { __typename: 'Query', site: hasFields(row, 'archived', 'owner', 'createdAt', 'address', 'items') ? row : null }
  },
}

export const me: QueryHandler<'Me'> = {
  // @ts-expect-error the root is a `Query`
  read: () => ({ __typename: 'Mutation', me: null }),
}

// A row narrows on its `__typename`, and so do the objects in it.
export function describe(row: SiteRow | ItemRow): string {
  if (row.__typename === 'Site') return row.owner?.__typename === 'User' ? row.owner.name : row.name
  return row.site?.__typename === 'Site' ? row.site.name : row.name
}

// A row is the fragment it was stored from, once it holds the fragment's fields.
export async function card(): Promise<SiteCardFragment | undefined> {
  const row = await db.Site.get('s1')
  return hasFields(row, 'archived', 'owner') ? row : undefined
}

// The fragment needs `__typename`, and nothing asked a row without it.
export function bare(): SiteCardFragment {
  // @ts-expect-error `__typename` is missing
  return { id: 's1', name: 'x', archived: false, owner: null }
}
