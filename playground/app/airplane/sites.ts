// Each mutation is a plain write to the tables from `stores.ts`. Every write
// made in `apply` is recorded, so rollback needs no `revert` here. `describe`
// runs before `apply`, so it still sees the old name on a rename or delete.

import type { AirplaneDexie } from '#nuxt-airplane'

async function siteName(db: AirplaneDexie, id: string) {
  return (await db.sites.get(id))?.name ?? id
}

async function itemName(db: AirplaneDexie, id: string) {
  return (await db.items.get(id))?.name ?? id
}

export default defineMutationHandlers({
  ArchiveSite: {
    describe: async ({ db, variables }) => `Archive ${await siteName(db, variables.id)}`,
    apply: ({ db, variables }) => db.sites.update(variables.id, { archived: true }),
    refetch: ['GetSites'],
  },

  UnarchiveSite: {
    describe: async ({ db, variables }) => `Unarchive ${await siteName(db, variables.id)}`,
    apply: ({ db, variables }) => db.sites.update(variables.id, { archived: false }),
    refetch: ['GetSites'],
  },

  RenameSite: {
    describe: async ({ db, variables }) => `Rename ${await siteName(db, variables.id)} to ${variables.name}`,
    apply: ({ db, variables }) => db.sites.update(variables.id, { name: variables.name }),
    refetch: ['GetSites'],
  },

  DeleteSite: {
    describe: async ({ db, variables }) => `Delete ${await siteName(db, variables.id)}`,
    async apply({ db, variables }) {
      await db.sites.delete(variables.id)
      await db.siteItems.where('siteId').equals(variables.id).delete()
    },
    refetch: ['GetSites'],
  },

  AddSiteItem: {
    describe: async ({ db, variables }) => `Add ${await itemName(db, variables.itemId)} to ${await siteName(db, variables.siteId)}`,
    apply: ({ db, variables }) =>
      db.siteItems.put({ siteId: variables.siteId, itemId: variables.itemId, onHand: variables.onHand ?? 0 }),
    refetch: ['GetSites'],
  },

  RemoveSiteItem: {
    describe: async ({ db, variables }) => `Remove ${await itemName(db, variables.itemId)} from ${await siteName(db, variables.siteId)}`,
    apply: ({ db, variables }) => db.siteItems.delete([variables.siteId, variables.itemId]),
    refetch: ['GetSites'],
  },

  UpdateSiteItemOnHand: {
    describe: async ({ db, variables }) => `Set ${await itemName(db, variables.itemId)} at ${await siteName(db, variables.siteId)} to ${variables.onHand}`,
    apply: ({ db, variables }) =>
      db.siteItems.update([variables.siteId, variables.itemId], { onHand: variables.onHand }),
    refetch: ['GetSites'],
  },
})
