import { HANDLER_KIND, type MutationHandler, type MutationHandlers, type MutationName } from '../types'

/**
 * Declare the handler of a single mutation, typed by its document name. Handy
 * for one file per mutation; the results can be spread into `defineMutationHandlers`.
 */
export function defineMutationHandler<N extends MutationName>(name: N, handler: MutationHandler<N>): MutationHandlers {
  return Object.defineProperty({ [name]: handler } as MutationHandlers, HANDLER_KIND, { value: 'mutations' })
}
