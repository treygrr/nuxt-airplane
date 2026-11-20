// A GraphQL endpoint for server-side rendering to reach: it answers GetSites
// with what the request carried, so the test can see which headers arrived.
// It speaks automatic persisted queries, as the fixture's config asks.
import { requests } from '../requests'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ query?: string, extensions?: { persistedQuery?: unknown } }>(event)
  if (!body.query) return { errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] }
  requests.count++
  const seen = `auth=${getHeader(event, 'x-airplane-token') ?? 'none'};cookie=${getCookie(event, 'visitor') ?? 'none'}`
  return { data: { sites: [{ id: 's1', name: seen, archived: false }] } }
})
