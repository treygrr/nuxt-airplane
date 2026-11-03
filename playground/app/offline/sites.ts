// How each queued mutation shows up in the local cache before the server
// confirms it. `revert` is omitted everywhere: the module snapshots the rows
// `apply` touches and restores them on rollback.

type Sites = NuxtOfflineQueries['GetSites']['result']['sites']
type Site = Sites[number]

function patchSite(sites: Sites, id: string, patch: (site: Site) => void) {
  const site = sites.find(s => s.id === id)
  if (site) patch(site)
}

export default defineMutationHandlers({
  ArchiveSite: {
    apply: ({ cache, variables }) =>
      cache.update('GetSites', data => patchSite(data.sites, variables.id, s => (s.archived = true))),
    refetch: ['GetSites'],
  },

  UnarchiveSite: {
    apply: ({ cache, variables }) =>
      cache.update('GetSites', data => patchSite(data.sites, variables.id, s => (s.archived = false))),
    refetch: ['GetSites'],
  },

  RenameSite: {
    apply: ({ cache, variables }) =>
      cache.update('GetSites', data => patchSite(data.sites, variables.id, s => (s.name = variables.name))),
    refetch: ['GetSites'],
  },

  DeleteSite: {
    apply: ({ cache, variables }) =>
      cache.update('GetSites', data => ({ ...data, sites: data.sites.filter(s => s.id !== variables.id) })),
    refetch: ['GetSites'],
  },

  AddSiteItem: {
    async apply({ cache, variables }) {
      // The item's name lives in the items catalog query, so look it up there.
      const items = await cache.get('GetItems', {})
      const name = items?.items.find(i => i.id === variables.itemId)?.name ?? variables.itemId
      await cache.update('GetSites', data => patchSite(data.sites, variables.siteId, (site) => {
        if (!site.items.some(i => i.id === variables.itemId)) {
          site.items.push({ id: variables.itemId, name, onHand: variables.onHand ?? 0 })
        }
      }))
    },
    refetch: ['GetSites'],
  },

  RemoveSiteItem: {
    apply: ({ cache, variables }) =>
      cache.update('GetSites', data => patchSite(data.sites, variables.siteId, (site) => {
        site.items = site.items.filter(i => i.id !== variables.itemId)
      })),
    refetch: ['GetSites'],
  },

  UpdateSiteItemOnHand: {
    apply: ({ cache, variables }) =>
      cache.update('GetSites', data => patchSite(data.sites, variables.siteId, (site) => {
        const item = site.items.find(i => i.id === variables.itemId)
        if (item) item.onHand = variables.onHand
      })),
    refetch: ['GetSites'],
  },
})
