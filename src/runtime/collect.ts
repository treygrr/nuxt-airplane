import {
  HANDLER_KIND,
  type AirplaneRequestOptions,
  type AirplaneStores,
  type HandlerKind,
  type MutationHandlers,
  type QueryHandlers,
} from './types'

/** Sorts the default exports of the handler files by what they declare. */
export function collect(exports: unknown[]) {
  const mutationHandlers: MutationHandlers = {}
  const queryHandlers: QueryHandlers = {}
  const stores: AirplaneStores = { stores: {} }
  const request: AirplaneRequestOptions = {}
  for (const item of exports) {
    if (item === undefined) continue
    const kind = item && typeof item === 'object' ? (item as Record<symbol, HandlerKind | undefined>)[HANDLER_KIND] : undefined
    if (!kind) {
      // Cheap enough to keep in production: the build-time check cannot see through identifiers.
      console.warn('[nuxt-airplane] Ignoring a default export in the handlers directory that was not created with a define* helper (defineMutationHandler(s), defineQueryHandler(s), defineAirplaneStores, defineAirplaneRequest).')
      continue
    }
    if (kind === 'queries') Object.assign(queryHandlers, item)
    else if (kind === 'request') Object.assign(request, item)
    else if (kind === 'stores') {
      const def = item as AirplaneStores
      Object.assign(stores.stores, def.stores)
      stores.version = Math.max(stores.version ?? 1, def.version ?? 1)
    }
    else Object.assign(mutationHandlers, item)
  }
  return { mutationHandlers, queryHandlers, stores, request }
}
