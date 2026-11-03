import { useNuxtApp } from '#app'
import type { OfflineClient } from '../client'

/** The offline client behind every composable. Only available on the client. */
export function useOffline(): OfflineClient | undefined {
  return useNuxtApp().$offline as OfflineClient | undefined
}
