import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { documents, documentsHash, entities, unusedEntities } from '#nuxt-airplane/documents'
import { handlers } from '#nuxt-airplane/handlers'
import { createWorker } from '#nuxt-airplane/worker'
import { createAirplaneClient } from './client'
import { collect } from './collect'
import { remoteEngine, type Port } from './worker'
import type { AirplaneRuntimeConfig, EntityInfo, OperationDocument } from './types'

export default defineNuxtPlugin({
  name: 'nuxt-airplane',
  setup(nuxtApp) {
    const config = useRuntimeConfig().public.airplane as AirplaneRuntimeConfig
    // With `handlers.worker`, the handlers that write run in a worker and the page asks it for each write.
    // Typed here because the alias resolves to the generated file, where it is `undefined` without the option.
    let worker: Worker | undefined
    try {
      worker = (createWorker as (() => Worker) | undefined)?.()
    }
    catch (error) {
      // No workers here (an old webview, a strict content security policy): the handlers run on the page instead.
      console.warn('[nuxt-airplane] Could not start the worker, running the handlers on the page:', error)
    }
    const remote = worker ? remoteEngine(worker as unknown as Port, { ...config, documents: documents as Record<string, OperationDocument>, documentsHash, entities: entities as Record<string, EntityInfo>, unusedEntities }) : undefined
    const airplane = createAirplaneClient({
      ...config,
      documents: documents as Record<string, OperationDocument>,
      documentsHash,
      entities: entities as Record<string, EntityInfo>,
      unusedEntities,
      ...collect(handlers),
      runWithContext: fn => nuxtApp.runWithContext(fn),
      remote,
    })
    return { provide: { airplane } }
  },
})
