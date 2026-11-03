import { HANDLER_KIND, type MutationHandlers } from '../types'

/**
 * Declare how queued mutations touch the local data. Files under `airplane/`
 * (the handlers directory) that default-export one of these are picked up automatically.
 */
export function defineMutationHandlers(handlers: MutationHandlers): MutationHandlers {
  return Object.defineProperty(handlers, HANDLER_KIND, { value: 'mutations' })
}
