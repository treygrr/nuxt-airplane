// The address book, the default first.

import { replaceAll } from '../../lib/airplane'

export default defineQueryHandler('GetAddresses', {
  store: ({ db }, data) => replaceAll(db.Address, data.addresses),
  async read({ db }) {
    const addresses = await db.Address.orderBy('name').toArray()
    return { addresses: addresses.sort((a, b) => Number(b.isDefault) - Number(a.isDefault)) }
  },
})
