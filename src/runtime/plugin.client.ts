import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { documents } from '#nuxt-offline/documents'
import { handlers } from '#nuxt-offline/handlers'
import { createOfflineClient } from './client'
import {
  HANDLER_KIND,
  type HandlerKind,
  type MutationHandlers,
  type OfflineRuntimeConfig,
  type OfflineStores,
  type OperationDocument,
  type QueryHandlers,
} from './types'

/** Sorts the default exports of the handler files by what they declare. */
function collect(exports: unknown[]) {
  const mutationHandlers: MutationHandlers = {}
  const queryHandlers: QueryHandlers = {}
  const stores: OfflineStores = { stores: {} }
  for (const item of exports) {
    if (!item || typeof item !== 'object') continue
    // Untagged objects are mutation handlers, as before `defineQueryHandlers` existed.
    const kind = ((item as Record<symbol, HandlerKind>)[HANDLER_KIND] ?? 'mutations') as HandlerKind
    if (kind === 'queries') Object.assign(queryHandlers, item)
    else if (kind === 'stores') {
      const def = item as OfflineStores
      Object.assign(stores.stores, def.stores)
      stores.version = Math.max(stores.version ?? 1, def.version ?? 1)
    }
    else Object.assign(mutationHandlers, item)
  }
  return { mutationHandlers, queryHandlers, stores }
}

export default defineNuxtPlugin({
  name: 'nuxt-offline',
  setup() {
    const config = useRuntimeConfig().public.offline as OfflineRuntimeConfig
    const offline = createOfflineClient({
      ...config,
      documents: documents as Record<string, OperationDocument>,
      ...collect(handlers),
    })
    return { provide: { offline } }
  },
})
