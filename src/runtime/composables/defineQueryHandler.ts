import { HANDLER_KIND, type Locals, type LocalsTag, type QueryHandler, type QueryHandlers, type QueryName } from '../types'

/**
 * Declare the handler of a single query, typed by its document name. Handy
 * for one file per query; the results can be spread into `defineQueryHandlers`.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export function defineQueryHandler<N extends QueryName, L extends Locals = {}>(name: N, handler: QueryHandler<N, L>): QueryHandlers & LocalsTag<{ [K in N]: L }> {
  return Object.defineProperty({ [name]: handler } as QueryHandlers, HANDLER_KIND, { value: 'queries' })
}
