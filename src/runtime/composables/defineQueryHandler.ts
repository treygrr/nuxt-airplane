import { HANDLER_KIND, type QueryHandler, type QueryHandlers, type QueryName } from '../types'

/**
 * Declare the handler of a single query, typed by its document name. Handy
 * for one file per query; the results can be spread into `defineQueryHandlers`.
 */
export function defineQueryHandler<N extends QueryName>(name: N, handler: QueryHandler<N>): QueryHandlers {
  return Object.defineProperty({ [name]: handler } as QueryHandlers, HANDLER_KIND, { value: 'queries' })
}
