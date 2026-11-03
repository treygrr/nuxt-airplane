// Lookups shared by the handlers in `app/airplane/`. Nuxt auto-imports
// everything exported from `app/utils/`.
import type { AirplaneDexie } from '#nuxt-airplane'

export async function siteName(db: AirplaneDexie, id: string) {
  return (await db.sites.get(id))?.name ?? id
}

export async function itemName(db: AirplaneDexie, id: string) {
  return (await db.items.get(id))?.name ?? id
}
