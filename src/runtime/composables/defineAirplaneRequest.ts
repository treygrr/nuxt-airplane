import { HANDLER_KIND, type AirplaneRequestOptions } from '../types'

/**
 * Configure how requests reach the GraphQL endpoint: auth headers, credentials,
 * a custom fetch, a response hook. Default-export it from a file under the
 * handlers directory. Several files are merged, last one wins per option.
 */
export function defineAirplaneRequest(options: AirplaneRequestOptions): AirplaneRequestOptions {
  return Object.defineProperty(options, HANDLER_KIND, { value: 'request' })
}
