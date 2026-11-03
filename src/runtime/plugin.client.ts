import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { documents, documentsHash } from '#nuxt-airplane/documents'
import { handlers } from '#nuxt-airplane/handlers'
import { createAirplaneClient } from './client'
import {
  HANDLER_KIND,
  type HandlerKind,
  type MutationHandlers,
  type AirplaneRuntimeConfig,
  type AirplaneStores,
  type OperationDocument,
  type QueryHandlers,
} from './types'

/** Sorts the default exports of the handler files by what they declare. */
function collect(exports: unknown[]) {
  const mutationHandlers: MutationHandlers = {}
  const queryHandlers: QueryHandlers = {}
  const stores: AirplaneStores = { stores: {} }
  for (const item of exports) {
    if (item === undefined) continue
    const kind = item && typeof item === 'object' ? (item as Record<symbol, HandlerKind | undefined>)[HANDLER_KIND] : undefined
    if (!kind) {
      if (import.meta.dev) console.warn('[nuxt-airplane] Ignoring a default export in the handlers directory that was not created with defineMutationHandler(s), defineQueryHandler(s) or defineAirplaneStores.')
      continue
    }
    if (kind === 'queries') Object.assign(queryHandlers, item)
    else if (kind === 'stores') {
      const def = item as AirplaneStores
      Object.assign(stores.stores, def.stores)
      stores.version = Math.max(stores.version ?? 1, def.version ?? 1)
    }
    else Object.assign(mutationHandlers, item)
  }
  return { mutationHandlers, queryHandlers, stores }
}

export default defineNuxtPlugin({
  name: 'nuxt-airplane',
  setup() {
    const config = useRuntimeConfig().public.airplane as AirplaneRuntimeConfig
    const airplane = createAirplaneClient({
      ...config,
      documents: documents as Record<string, OperationDocument>,
      documentsHash,
      ...collect(handlers),
    })
    return { provide: { airplane } }
  },
})
