// Inventory: what one site holds, a page at a time, by product name. A
// site's items are walked to the end in the background like the catalog, so
// the whole of a site can be counted offline.

import { connection, decodeCursor, listingKey } from '../../lib/airplane'

type SiteItemRow = NuxtAirplaneStores['SiteItem']

const byName = (a: SiteItemRow, b: SiteItemRow) => a.productName.localeCompare(b.productName) || a.variantName.localeCompare(b.variantName)

export default defineQueryHandler('GetSiteItems', {
  async store({ db, variables }, data) {
    await db.SiteItem.bulkPut(data.siteItems.edges.map(e => e.node))
    await db.Listing.put({ key: listingKey('siteItems', { siteId: variables.siteId, search: variables.search }), totalCount: data.siteItems.totalCount })
  },
  async read({ db, variables }) {
    const { siteId, first = 50, after, search } = variables
    const q = search?.trim().toLowerCase()
    const rows = (await db.SiteItem.where('siteId').equals(siteId).toArray())
      .filter(i => !q || i.productName.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
      .sort(byName)
    const known = (await db.Listing.get(listingKey('siteItems', { siteId, search })))?.totalCount ?? 0
    return { siteItems: connection(rows, decodeCursor(after), first ?? 50, Math.max(known, rows.length)) }
  },
  prefetch: {
    next: (data, variables) => (!variables.search && data.siteItems.pageInfo.hasNextPage
      ? { ...variables, first: 200, after: data.siteItems.pageInfo.endCursor }
      : null),
  },
})
