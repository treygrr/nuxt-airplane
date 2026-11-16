// Inventory: what the restock carts hold. Asked for every site, the response
// replaces what is kept; for one site, it replaces that site's lines.

import { replaceAll } from '../../lib/airplane'

export default defineQueryHandler('GetSiteCartLines', {
  async store({ db, variables }, data) {
    if (!variables?.siteId) return replaceAll(db.SiteCartLine, data.siteCartLines)
    await db.SiteCartLine.where('siteId').equals(variables.siteId).delete()
    await db.SiteCartLine.bulkPut(data.siteCartLines)
  },
  async read({ db, variables }) {
    const lines = variables?.siteId
      ? await db.SiteCartLine.where('siteId').equals(variables.siteId).sortBy('addedAt')
      : await db.SiteCartLine.orderBy('addedAt').toArray()
    return { siteCartLines: lines }
  },
})
