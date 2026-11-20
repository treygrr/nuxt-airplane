// The database's shape in Dexie's `stores()` syntax: the module's own
// tables, and how the inferred tables and the app's own declarations come
// together. Free of Dexie, so the build can write the schema out too.

import type { EntityInfo } from './types'

/** The module's own tables. */
export const MODULE_STORES = {
  queries: '&key, document, updatedAt',
  // Past the queue's order, the indexes answer what queuing and sending ask of
  // it without reading it all: the rows a mutation changed, what it created
  // and wrote, the placeholders it minted, and whether it changed nothing.
  mutations: '++id, status, createdAt, document, unkeyed, *rows, *creates, *writes, *tempIds',
  meta: '&key',
  base: '[table+key]',
}

/**
 * The inferred tables, keyed on their id, with what `defineAirplaneStores`
 * adds: indexes for an inferred table (its key is implied), or a table of
 * the app's own.
 */
export function mergeStores(entities: Record<string, EntityInfo>, user: Record<string, string>) {
  const stores: Record<string, string> = {}
  for (const [name, { key }] of Object.entries(entities)) stores[name] = `&${key}`
  for (const [name, spec] of Object.entries(user)) {
    const entity = entities[name]
    if (!entity) {
      stores[name] = spec
      continue
    }
    const extra = spec.split(',').map(s => s.trim()).filter(s => s && s.replace(/^[&+*]+/, '') !== entity.key)
    stores[name] = [`&${entity.key}`, ...extra].join(', ')
  }
  return stores
}
