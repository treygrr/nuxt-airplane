// useOnlineQuery against a real client and a mocked server: what is sent,
// when, and what is kept. Rendering on the server is covered in basic.test.
import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { createAirplaneClient, type AirplaneClient } from '../src/runtime/client'
import { queryKey } from '../src/runtime/request'
import { GraphQLRequestError, OfflineError, type MutationHandlers, type OperationDocument } from '../src/runtime/types'

/** What `useNuxtApp()` returns in these tests: the client, and a page payload. */
const app = {
  $airplane: undefined as AirplaneClient | undefined,
  isHydrating: false,
  payload: { serverRendered: false, data: {} as Record<string, unknown> },
}
vi.mock('#app', () => ({ useNuxtApp: () => app }))

const { useOnlineQuery } = await import('../src/runtime/composables/useOnlineQuery')

const documents: Record<string, OperationDocument> = {
  Search: { name: 'Search', kind: 'query', source: 'query Search($term: String!) { search(term: $term) }', variables: ['term'] },
  Touch: { name: 'Touch', kind: 'mutation', source: 'mutation Touch { touch }', variables: [] },
}

let n = 0
/** A server that answers `Search` with the term, after `delay(term)` ms, or with `fail(term)`. */
interface Setup {
  delay?: (term: string) => number
  fail?: (term: string) => Response | undefined
  mutationHandlers?: MutationHandlers
}
function setup({ delay = () => 0, fail = () => undefined, mutationHandlers = {} }: Setup = {}) {
  const terms: string[] = []
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as { query: string, variables?: { term: string } }
    if (body.query.startsWith('mutation')) return Response.json({ data: { touch: true } })
    const term = body.variables!.term
    terms.push(term)
    await new Promise(r => setTimeout(r, delay(term)))
    return fail(term) ?? Response.json({ data: { search: `result:${term}` } })
  })
  const client = createAirplaneClient({
    endpoint: 'http://api.test/graphql',
    dbName: `online-${++n}`,
    documentsHash: 'h',
    documents,
    mutationHandlers,
    queryHandlers: {},
    stores: { stores: {} },
    request: { fetch: fetch as unknown as typeof globalThis.fetch },
  })
  app.$airplane = client
  return { client, terms }
}

async function until(check: () => boolean, what: string) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > 3000) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(r => setTimeout(r, 5))
  }
}
const settle = () => new Promise(r => setTimeout(r, 30))

const scopes: ReturnType<typeof effectScope>[] = []
function run<T>(fn: () => T): T {
  const scope = effectScope()
  scopes.push(scope)
  return scope.run(fn)!
}
afterEach(() => {
  scopes.splice(0).forEach(s => s.stop())
  app.isHydrating = false
  app.payload = { serverRendered: false, data: {} }
})

type Q = ReturnType<typeof useOnlineQuery>
const query = (variables: unknown, options?: Parameters<typeof useOnlineQuery>[2]) =>
  run(() => useOnlineQuery('Search' as never, variables as never, options)) as Q & { data: { value: { search: string } | null } }

describe('useOnlineQuery', () => {
  it('fetches once for variables rebuilt each time from reactive props, as long as they are the same', async () => {
    const { terms } = setup()
    const props = reactive({ term: 'drill', tick: 0 })
    const q = query(() => ({ term: props.term }))
    await until(() => !!q.data.value, 'the answer')
    for (let i = 0; i < 5; i++) {
      props.tick++
      await nextTick()
    }
    await settle()
    expect(terms).toEqual(['drill'])
    expect(q.data.value).toEqual({ search: 'result:drill' })
    expect(q.updatedAt.value).toBeTypeOf('number')
  })

  it('sends nothing while not enabled, keeps the last answer, and fetches once enabled', async () => {
    const { terms } = setup()
    const term = ref('d')
    const q = query(() => ({ term: term.value }), { enabled: () => term.value.length >= 2 })
    await settle()
    expect(terms).toEqual([])
    expect(q.fetching.value).toBe(false)
    term.value = 'dr'
    await until(() => q.data.value?.search === 'result:dr', 'the answer once enabled')
    term.value = 'd'
    await settle()
    expect(terms).toEqual(['dr'])
    expect(q.data.value).toEqual({ search: 'result:dr' })
  })

  it('shows the latest request\'s answer, not a slower earlier one', async () => {
    const { terms } = setup({ delay: term => (term === 'slow' ? 80 : 5) })
    const term = ref('slow')
    const q = query(() => ({ term: term.value }))
    await until(() => terms.length === 1, 'the first request')
    term.value = 'fast'
    await until(() => q.data.value?.search === 'result:fast', 'the newer answer')
    await new Promise(r => setTimeout(r, 120))
    expect(q.data.value).toEqual({ search: 'result:fast' })
    expect(q.fetching.value).toBe(false)
  })

  it('keeps the last answer through an error, and clears the error with the next answer', async () => {
    const { terms } = setup({ fail: term => (term === 'bad' ? Response.json({ errors: [{ message: 'no' }] }) : undefined) })
    const term = ref('good')
    const q = query(() => ({ term: term.value }))
    await until(() => !!q.data.value, 'the answer')
    term.value = 'bad'
    await until(() => !!q.error.value, 'the error')
    expect(q.error.value).toBeInstanceOf(GraphQLRequestError)
    expect(q.data.value).toEqual({ search: 'result:good' })
    term.value = 'again'
    await until(() => q.data.value?.search === 'result:again', 'the next answer')
    expect(q.error.value).toBeNull()
    expect(terms).toEqual(['good', 'bad', 'again'])
  })

  it('offline, sends nothing and says so; back online, it asks', async () => {
    const { client, terms } = setup()
    client.goOffline()
    const q = query({ term: 'x' })
    await settle()
    expect(terms).toEqual([])
    expect(q.error.value).toBeInstanceOf(OfflineError)
    expect(q.fetching.value).toBe(false)
    client.goOnline()
    await until(() => !!q.data.value, 'the answer on reconnect')
    expect(terms).toEqual(['x'])
  })

  it('with refetchOnReconnect: false, waits for its next change instead', async () => {
    const { client, terms } = setup()
    client.goOffline()
    const q = query({ term: 'x' }, { refetchOnReconnect: false })
    await settle()
    client.goOnline()
    await settle()
    expect(terms).toEqual([])
    await q.refresh()
    expect(terms).toEqual(['x'])
  })

  it('asks again on reconnect after a network failure, but not after the server answered with errors', async () => {
    let down = true
    const { client, terms } = setup({
      fail: (term) => {
        if (term === 'rejected') return Response.json({ errors: [{ message: 'no' }] })
        if (down) throw new TypeError('Failed to fetch')
      },
    })
    const rejected = query({ term: 'rejected' })
    const lost = query({ term: 'lost' })
    await until(() => !!rejected.error.value && !!lost.error.value, 'both errors')
    expect(lost.error.value).toBeInstanceOf(TypeError)
    down = false
    client.goOffline()
    await nextTick()
    client.goOnline()
    await until(() => lost.data.value?.search === 'result:lost', 'the lost one asked again')
    await settle()
    expect(terms.filter(t => t === 'rejected')).toHaveLength(1)
    expect(terms.filter(t => t === 'lost')).toHaveLength(2)
  })

  it('a mutation that names it asks it again once synced; one that does not, does not', async () => {
    const { client, terms } = setup({ mutationHandlers: { Touch: { refetch: ['Search'] } } as unknown as MutationHandlers })
    query({ term: 'x' })
    await until(() => terms.length === 1, 'the first answer')
    await client.execute('Touch', undefined)
    await until(() => terms.length === 2, 'the refetch the mutation named')
    expect(terms).toEqual(['x', 'x'])
  })

  it('drops an answer that arrives after it was disposed of', async () => {
    const { terms } = setup({ delay: () => 40 })
    const scope = effectScope()
    const q = scope.run(() => useOnlineQuery('Search' as never, { term: 'gone' } as never))! as Q
    await until(() => terms.length === 1, 'the request')
    scope.stop()
    await new Promise(r => setTimeout(r, 80))
    expect(q.data.value).toBeNull()
  })

  it('hydrating a server render: starts from the answer in the page and sends nothing', async () => {
    const { terms } = setup()
    app.isHydrating = true
    app.payload = { serverRendered: true, data: { [`airplane:${queryKey('Search', { term: 'x' })}`]: { data: { search: 'from server' }, updatedAt: 1 } } }
    const q = query({ term: 'x' })
    expect(q.data.value).toEqual({ search: 'from server' })
    expect(q.fetching.value).toBe(false)
    await settle()
    expect(terms).toEqual([])
  })

  it('hydrating a server render that failed: shows the error and does not retry', async () => {
    const { terms } = setup()
    app.isHydrating = true
    app.payload = { serverRendered: true, data: { [`airplane:${queryKey('Search', { term: 'x' })}`]: { error: { name: 'GraphQLRequestError', message: 'no', status: 200, errors: [{ message: 'no' }] } } } }
    const q = query({ term: 'x' })
    expect(q.error.value).toBeInstanceOf(GraphQLRequestError)
    await settle()
    expect(terms).toEqual([])
  })
})
