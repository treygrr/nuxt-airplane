// Inventory management: every query and mutation about sites, what they
// hold and their restock carts goes through here, so each has one home.

import type { MaybeRefOrGetter } from 'vue'
import type { SiteItemSort } from '#shared/siteItemSort'

export function useSites(filters: MaybeRefOrGetter<{ archived?: boolean | null, search?: string | null }>) {
  return useAirplaneQuery('GetSites', () => toValue(filters))
}

export function useSite(id: MaybeRefOrGetter<string>) {
  return useAirplaneQuery('GetSite', () => ({ id: toValue(id) }))
}

/** A page of a site's items: `first` of them, after `after`. `lowStock` is local: it filters what is stored and is never sent. */
export function useSiteItems(vars: MaybeRefOrGetter<{ siteId: string, search?: string | null, first: number, after?: string | null, sort?: SiteItemSort | null, descending?: boolean | null, lowStock?: boolean }>) {
  return useAirplaneQuery('GetSiteItems', () => toValue(vars))
}

/** What the restock carts hold: one site's, or, without a site, every site's. */
export function useSiteCartLines(siteId?: MaybeRefOrGetter<string | null>) {
  const query = useAirplaneQuery('GetSiteCartLines', () => ({ siteId: toValue(siteId) ?? null }))
  const lines = computed(() => query.data.value?.siteCartLines ?? [])
  /** Lines by id, which is the item's id too. */
  const byItem = computed(() => new Map(lines.value.map(line => [line.id, line])))
  return { ...query, lines, byItem }
}

export function useInventory() {
  return {
    createSite: useMutation('CreateSite'),
    renameSite: useMutation('RenameSite'),
    archiveSite: useMutation('ArchiveSite'),
    unarchiveSite: useMutation('UnarchiveSite'),
    deleteSite: useMutation('DeleteSite'),
    setTracking: useMutation('SetSiteInventoryTracking'),
    addItem: useMutation('AddSiteItem'),
    setOnHand: useMutation('UpdateSiteItemOnHand'),
    setLevels: useMutation('UpdateSiteItemLevels'),
    removeItem: useMutation('RemoveSiteItem'),
    addToCart: useMutation('AddSiteCartLine'),
    setCartQuantity: useMutation('SetSiteCartLineQuantity'),
    removeFromCart: useMutation('RemoveSiteCartLine'),
    checkOut: useMutation('CheckOutSiteCart'),
    fillToMax: useMutation('FillSiteCartToMax'),
  }
}
