// Inventory management: every query and mutation about sites and what they
// hold goes through here, so each has one home.

import type { MaybeRefOrGetter } from 'vue'

export function useSites(filters: MaybeRefOrGetter<{ archived?: boolean | null, search?: string | null }>) {
  return useQuery('GetSites', () => toValue(filters))
}

export function useSite(id: MaybeRefOrGetter<string>) {
  return useQuery('GetSite', () => ({ id: toValue(id) }))
}

/** A site's items, `first` of them from the start: "load more" asks for more. */
export function useSiteItems(vars: MaybeRefOrGetter<{ siteId: string, search?: string | null, first: number }>) {
  return useQuery('GetSiteItems', () => toValue(vars))
}

export function useInventory() {
  return {
    createSite: useMutation('CreateSite'),
    renameSite: useMutation('RenameSite'),
    archiveSite: useMutation('ArchiveSite'),
    unarchiveSite: useMutation('UnarchiveSite'),
    deleteSite: useMutation('DeleteSite'),
    addItem: useMutation('AddSiteItem'),
    setOnHand: useMutation('UpdateSiteItemOnHand'),
    removeItem: useMutation('RemoveSiteItem'),
  }
}
