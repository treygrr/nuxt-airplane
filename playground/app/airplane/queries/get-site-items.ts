// Inventory: what one site holds, a page at a time, in the order asked for. A
// site's items are walked to the end in the background like the catalog, so
// the whole of a site can be counted offline.

import { siteItemOrder } from '#shared/siteItemSort'
import { connection, decodeCursor, listingKey } from '../../lib/airplane'

export default defineQueryHandler('GetSiteItems', {
  async store({ db, variables }, data) {
    await db.SiteItem.bulkPut(data.siteItems.edges.map(e => e.node))
    await db.Listing.put({ key: listingKey('siteItems', { siteId: variables.siteId, search: variables.search }), totalCount: data.siteItems.totalCount })
  },
  async read({ db, variables }) {
    const { siteId, first = 50, after, search, sort, descending } = variables
    const q = search?.trim().toLowerCase()
    const rows = (await db.SiteItem.where('siteId').equals(siteId).toArray())
      .filter(i => !q || i.productName.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q))
      .sort(siteItemOrder(sort, descending))
    const known = (await db.Listing.get(listingKey('siteItems', { siteId, search })))?.totalCount ?? 0
    return { siteItems: connection(rows, decodeCursor(after), first ?? 50, Math.max(known, rows.length)) }
  },
  prefetch: {
    next: (data, variables) => (!variables.search && data.siteItems.pageInfo.hasNextPage
      ? { ...variables, first: 200, after: data.siteItems.pageInfo.endCursor }
      : null),
  },
})
