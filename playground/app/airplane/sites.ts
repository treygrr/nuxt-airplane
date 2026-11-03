// Each mutation is a plain write to the tables from `stores.ts`. Every write
// made in `apply` is recorded, so rollback needs no `revert` here.

export default defineMutationHandlers({
  ArchiveSite: {
    apply: ({ db, variables }) => db.sites.update(variables.id, { archived: true }),
    refetch: ['GetSites'],
  },

  UnarchiveSite: {
    apply: ({ db, variables }) => db.sites.update(variables.id, { archived: false }),
    refetch: ['GetSites'],
  },

  RenameSite: {
    apply: ({ db, variables }) => db.sites.update(variables.id, { name: variables.name }),
    refetch: ['GetSites'],
  },

  DeleteSite: {
    async apply({ db, variables }) {
      await db.sites.delete(variables.id)
      await db.siteItems.where('siteId').equals(variables.id).delete()
    },
    refetch: ['GetSites'],
  },

  AddSiteItem: {
    apply: ({ db, variables }) =>
      db.siteItems.put({ siteId: variables.siteId, itemId: variables.itemId, onHand: variables.onHand ?? 0 }),
    refetch: ['GetSites'],
  },

  RemoveSiteItem: {
    apply: ({ db, variables }) => db.siteItems.delete([variables.siteId, variables.itemId]),
    refetch: ['GetSites'],
  },

  UpdateSiteItemOnHand: {
    apply: ({ db, variables }) =>
      db.siteItems.update([variables.siteId, variables.itemId], { onHand: variables.onHand }),
    refetch: ['GetSites'],
  },
})
