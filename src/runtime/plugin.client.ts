import { defineNuxtPlugin, useRuntimeConfig } from '#app'
import { documents } from '#nuxt-offline/documents'
import { handlers } from '#nuxt-offline/handlers'
import { createOfflineClient } from './client'
import type { OfflineRuntimeConfig } from './types'

export default defineNuxtPlugin({
  name: 'nuxt-offline',
  setup() {
    const config = useRuntimeConfig().public.offline as OfflineRuntimeConfig
    const offline = createOfflineClient({ ...config, documents, handlers })
    return { provide: { offline } }
  },
})
