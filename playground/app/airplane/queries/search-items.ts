// A Relay-style connection, paginated locally. The server's cursors are a
// base64 of `name\u0000id`, so `read` can apply the same keyset pagination to
// the local `items` table: pages that were fetched come back identical, and
// offline you can keep paging through whatever is cached.

import type { ItemRow } from '../stores'

const encodeCursor = (item: ItemRow) => btoa(`${item.name}\u0000${item.id}`)
const decodeCursor = (cursor: string) => {
  const [name = '', id = ''] = atob(cursor).split('\u0000')
  return { id, name }
}
const compareItems = (a: ItemRow, b: ItemRow) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

export default defineQueryHandler('SearchItems', {
  // A page is a subset of a subset: upsert only, never delete.
  store: ({ db }, data) => db.items.bulkPut(data.searchItems.edges.map(e => e.node)),

  async read({ db, variables }) {
    const { query, first, after } = variables ?? {}
    const limit = first ?? 20
    const q = query?.trim().toLowerCase()

    // Sorted by the `name` index, then the same filter and cursor logic as the server.
    const matches = (await db.items.orderBy('name').toArray())
      .filter(i => !q || i.name.toLowerCase().includes(q))
      .sort(compareItems)
    const start = after ? matches.findIndex(i => compareItems(i, decodeCursor(after)) > 0) : 0
    const page = start === -1 ? [] : matches.slice(start, start + limit)
    const edges = page.map(node => ({ cursor: encodeCursor(node), node }))

    return {
      searchItems: {
        edges,
        totalCount: matches.length,
        pageInfo: {
          hasNextPage: start !== -1 && start + limit < matches.length,
          endCursor: edges.at(-1)?.cursor ?? null,
        },
      },
    }
  },
})
