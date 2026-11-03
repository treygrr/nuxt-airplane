import { HANDLER_KIND, type OfflineStores } from '../types'

/**
 * Add tables to the module's Dexie database, in Dexie's `stores()` syntax.
 * Augment the global `NuxtOfflineStores` interface to type their rows.
 */
export function defineOfflineStores(stores: Record<string, string>, options: { version?: number } = {}): OfflineStores {
  return Object.defineProperty({ stores, version: options.version }, HANDLER_KIND, { value: 'stores' })
}
