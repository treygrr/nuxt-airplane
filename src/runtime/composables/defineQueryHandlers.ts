import { HANDLER_KIND, type QueryHandlers } from '../types'

/**
 * Declare how query responses are stored in, and read back from, your own
 * tables. Queries without a handler are cached as-is.
 */
export function defineQueryHandlers(handlers: QueryHandlers): QueryHandlers {
  return Object.defineProperty(handlers, HANDLER_KIND, { value: 'queries' })
}
