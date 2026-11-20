import { HANDLER_KIND, type Locals, type LocalsTag, type MutationHandler, type MutationHandlers, type MutationName } from '../types'

/**
 * Each handler typed by its key, with the local variables its own `local`
 * declares. The tag of a spread `define*` result may come along.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type EachMutationHandler<T> = { [N in keyof T]: N extends MutationName ? MutationHandler<N, T[N] extends Locals ? T[N] : {}> : N extends keyof LocalsTag ? unknown : never }

/**
 * Declare how queued mutations touch the local data. Files under `airplane/`
 * (the handlers directory) that default-export one of these are picked up automatically.
 */
export function defineMutationHandlers<T>(handlers: EachMutationHandler<T>): MutationHandlers & LocalsTag<unknown, T> {
  return Object.defineProperty(handlers as MutationHandlers, HANDLER_KIND, { value: 'mutations' })
}
