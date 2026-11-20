import { HANDLER_KIND, type Locals, type LocalsTag, type QueryHandler, type QueryHandlers, type QueryName } from '../types'

/**
 * Each handler typed by its key, with the local variables its own `local`
 * declares. The tag of a spread `define*` result may come along.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type EachQueryHandler<T> = { [N in keyof T]: N extends QueryName ? QueryHandler<N, T[N] extends Locals ? T[N] : {}> : N extends keyof LocalsTag ? unknown : never }

/**
 * Declare how query responses are stored in, and read back from, your own
 * tables. Queries without a handler are cached as-is.
 */
export function defineQueryHandlers<T>(handlers: EachQueryHandler<T>): QueryHandlers & LocalsTag<T> {
  return Object.defineProperty(handlers as QueryHandlers, HANDLER_KIND, { value: 'queries' })
}
