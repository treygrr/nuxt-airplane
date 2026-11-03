// The playground keeps query responses normalized in its own tables instead
// of as cached blobs. Mutations then write to one table and every query that
// reads it updates on its own.

export interface SiteRow {
  id: string
  name: string
  archived: boolean
}

export interface ItemRow {
  id: string
  name: string
}

export interface SiteItemRow {
  siteId: string
  itemId: string
  onHand: number
}

declare global {
  interface NuxtOfflineStores {
    sites: SiteRow
    items: ItemRow
    siteItems: SiteItemRow
  }
}

export default defineOfflineStores({
  sites: '&id, name, archived',
  items: '&id',
  siteItems: '[siteId+itemId], siteId, itemId',
})
