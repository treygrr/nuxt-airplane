// The playground keeps query responses normalized in its own tables instead
// of as cached blobs. Mutations then write to one table and every query that
// reads it updates on its own.

export interface SiteRow {
  id: string
  name: string
  /** IndexedDB cannot index booleans, so it is stored as 0 | 1. */
  archived: 0 | 1
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
  interface NuxtAirplaneStores {
    sites: SiteRow
    items: ItemRow
    siteItems: SiteItemRow
  }
}

export default defineAirplaneStores({
  sites: '&id, name, archived',
  items: '&id, name',
  siteItems: '[siteId+itemId], siteId, itemId',
})
