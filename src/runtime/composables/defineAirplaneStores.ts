import { HANDLER_KIND, type AirplaneStores } from '../types'

/**
 * Add tables to the module's Dexie database, in Dexie's `stores()` syntax.
 * Augment the global `NuxtAirplaneStores` interface to type their rows.
 */
export function defineAirplaneStores(stores: Record<string, string>, options: { version?: number } = {}): AirplaneStores {
  return Object.defineProperty({ stores, version: options.version }, HANDLER_KIND, { value: 'stores' })
}
