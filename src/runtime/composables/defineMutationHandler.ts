import { HANDLER_KIND, type Locals, type LocalsTag, type MutationHandler, type MutationHandlers, type MutationName } from '../types'

/**
 * Declare the handler of a single mutation, typed by its document name. Handy
 * for one file per mutation; the results can be spread into `defineMutationHandlers`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function defineMutationHandler<N extends MutationName, L extends Locals = {}>(name: N, handler: MutationHandler<N, L>): MutationHandlers & LocalsTag<unknown, { [K in N]: L }> {
  return Object.defineProperty({ [name]: handler } as MutationHandlers, HANDLER_KIND, { value: 'mutations' })
}
