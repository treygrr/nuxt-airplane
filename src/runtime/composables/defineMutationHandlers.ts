import type { MutationHandlers } from '../types'

/**
 * Declare how queued mutations touch the local cache. Files under
 * `offline/` that export a handler map are picked up automatically.
 */
export function defineMutationHandlers(handlers: MutationHandlers): MutationHandlers {
  return handlers
}
