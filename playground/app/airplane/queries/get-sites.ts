// Inventory: the sites. Asked for without filters, the response is every
// site, and replaces what is kept; filtered, it only adds.

import { replaceAll } from '../../lib/airplane'

export default defineQueryHandler('GetSites', {
  async store({ db, variables }, data) {
    if (variables?.archived == null && !variables?.search) await replaceAll(db.Site, data.sites)
    else await db.Site.bulkPut(data.sites)
  },
  async read({ db, variables }) {
    const { archived, search } = variables ?? {}
    const q = search?.trim().toLowerCase()
    const sites = (await db.Site.orderBy('createdAt').toArray())
      .filter(s => archived == null || s.archived === archived)
      .filter(s => !q || s.name.toLowerCase().includes(q))
    return { sites }
  },
})
