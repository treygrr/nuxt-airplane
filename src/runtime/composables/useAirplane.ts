import { useNuxtApp } from '#app'
import type { AirplaneClient } from '../client'

/** The airplane client behind every composable. Only available in the browser. */
export function useAirplane(): AirplaneClient | undefined {
  return useNuxtApp().$airplane as AirplaneClient | undefined
}
