// The request layer on its own: what both the browser and server-side rendering send with.
import { describe, expect, it, vi } from 'vitest'
import { createRequester, type RequesterMemo } from '../src/runtime/request'
import { GraphQLRequestError, type OperationDocument } from '../src/runtime/types'

const documents: Record<string, OperationDocument> = {
  GetSites: { name: 'GetSites', kind: 'query', source: 'query GetSites { sites { id } }', hash: 'abc' },
}

describe('createRequester', () => {
  it('hands fetch the headers as a plain object, so a fetch that spreads them keeps them', async () => {
    let seen: Record<string, string> = {}
    // As Nitro's in-process fetch does: `{ ...forwarded, ...init.headers }`.
    const spreading = vi.fn(async (_url: string, init?: RequestInit) => {
      seen = { ...(init!.headers as Record<string, string>) }
      return Response.json({ data: { sites: [] } })
    })
    const send = createRequester({
      endpoint: '/api/graphql',
      headers: { 'x-static': '1' },
      documents,
      request: { headers: () => ({ Authorization: 'Bearer t' }) },
      fetch: spreading as unknown as typeof fetch,
    })
    await send('GetSites', undefined)
    expect(seen).toEqual({ 'content-type': 'application/json', 'x-static': '1', 'authorization': 'Bearer t' })
  })

  it('says the HTTP status of an answer that is not ok, and keeps GraphQL errors apart', async () => {
    const answers = [new Response('busy', { status: 503, statusText: 'Busy' }), Response.json({ errors: [{ message: 'nope' }] })]
    const send = createRequester({ endpoint: '/g', documents, request: { fetch: (async () => answers.shift()!) as unknown as typeof fetch } })
    await expect(send('GetSites', undefined)).rejects.toMatchObject({ status: 503 })
    await expect(send('GetSites', undefined)).rejects.toBeInstanceOf(GraphQLRequestError)
  })

  it('remembers across requesters sharing a memo that the server takes no persisted queries', async () => {
    const bodies: { query?: string, extensions?: unknown }[] = []
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string)
      bodies.push(body)
      if (!body.query) return Response.json({ errors: [{ message: 'PersistedQueryNotSupported' }] })
      return Response.json({ data: { sites: [] } })
    })
    const memo: RequesterMemo = { persistedUnsupported: false }
    const options = { endpoint: '/g', documents, persistedQueries: 'automatic' as const, request: { fetch: fetch as unknown as typeof globalThis.fetch } }
    await createRequester(options, memo)('GetSites', undefined)
    expect(memo.persistedUnsupported).toBe(true)
    await createRequester(options, memo)('GetSites', undefined)
    // Hash, then text; then text straight away from the second requester.
    expect(bodies.map(b => !!b.query)).toEqual([false, true, true])
  })
})
