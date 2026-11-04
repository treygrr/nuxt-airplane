// Runtime client against a real Dexie on fake-indexeddb, with a mocked fetch
// standing in for the GraphQL server. Everything the module promises about
// the tables, the outbox, rollback, rebase, prefetch and cache keys is exercised here.
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createAirplaneClient, isTempId, mergeStores, newTempId, substituteTempIds, type AirplaneClient, type AirplaneClientOptions } from '../src/runtime/client'
import type { AirplaneDexie, AirplaneRequestContext, AirplaneRequestOptions, MutationHandlers, OperationDocument, QueryHandlers } from '../src/runtime/types'

// ---------------------------------------------------------------------------
// A tiny in-memory GraphQL "server" behind fetch
// ---------------------------------------------------------------------------

interface Site { id: string, name: string, archived: boolean }

const documents: Record<string, OperationDocument> = {
  GetSites: { name: 'GetSites', kind: 'query', source: 'query GetSites { sites { id name archived } }' },
  GetSite: { name: 'GetSite', kind: 'query', source: 'query GetSite($id: ID!) { site(id: $id) { id name archived } }' },
  RenameSite: { name: 'RenameSite', kind: 'mutation', source: 'mutation RenameSite($id: ID!, $name: String!) { renameSite(id: $id, name: $name) { id name } }' },
  ArchiveSite: { name: 'ArchiveSite', kind: 'mutation', source: 'mutation ArchiveSite($id: ID!) { archiveSite(id: $id) { id archived } }' },
  CreateSite: { name: 'CreateSite', kind: 'mutation', source: 'mutation CreateSite($name: String!) { createSite(name: $name) { id name archived } }' },
  SearchItems: { name: 'SearchItems', kind: 'query', source: 'query SearchItems($after: String) { searchItems(after: $after) { edges { node { id } } pageInfo { hasNextPage endCursor } } }' },
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex')
/** The same documents with the build-time hash persisted queries send. */
const hashedDocuments = Object.fromEntries(Object.entries(documents).map(([name, doc]) => [name, { ...doc, hash: sha256(doc.source) }]))

function createServer() {
  const sites: Site[] = [
    { id: 's1', name: 'North', archived: false },
    { id: 's2', name: 'South', archived: false },
  ]
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `i${i + 1}` }))
  const calls: { op: string, variables: unknown, headers: Headers }[] = []

  const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as { query: string, variables?: Record<string, never> }
    const op = /(?:query|mutation) (\w+)/.exec(body.query)![1]!
    const v = (body.variables ?? {}) as Record<string, string>
    calls.push({ op, variables: body.variables, headers: new Headers(init!.headers) })
    const reply = (data: unknown) => Response.json({ data })
    switch (op) {
      case 'GetSites': return reply({ sites: sites.map(s => ({ ...s })) })
      case 'GetSite': return reply({ site: sites.find(s => s.id === v.id) ?? null })
      case 'RenameSite': {
        if (v.name === 'bad') return Response.json({ errors: [{ message: 'name rejected' }] })
        const site = sites.find(s => s.id === v.id)
        if (!site) return Response.json({ errors: [{ message: `no site ${v.id}` }] })
        site.name = v.name!
        return reply({ renameSite: { id: site.id, name: site.name } })
      }
      case 'ArchiveSite': {
        const site = sites.find(s => s.id === v.id)!
        site.archived = true
        return reply({ archiveSite: { id: site.id, archived: true } })
      }
      case 'CreateSite': {
        const site = { id: `s${sites.length + 1}`, name: v.name!, archived: false }
        sites.push(site)
        return reply({ createSite: { ...site } })
      }
      case 'SearchItems': {
        const start = v.after ? Number(v.after) : 0
        const page = items.slice(start, start + 2)
        const end = start + page.length
        return reply({ searchItems: { edges: page.map(node => ({ node })), pageInfo: { hasNextPage: end < items.length, endCursor: String(end) } } })
      }
    }
    throw new Error(`unknown op ${op}`)
  })

  return { sites, calls, fetch, mutations: () => calls.filter(c => documents[c.op]!.kind === 'mutation') }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let n = 0
type Server = ReturnType<typeof createServer>

/** What the compiled documents declare: `Site` is selected with its id, so it gets a table keyed on it. */
const ENTITIES = { Site: { key: 'id' } }
const sites = (db: AirplaneDexie) => db.table<Site, string>('Site')

/** The query handlers an app writes: a response fills the `Site` table and the query is read back from it. */
const siteQueries = {
  GetSites: {
    store: ({ db }: { db: AirplaneDexie }, data: { sites: Site[] }) => sites(db).bulkPut(data.sites),
    read: async ({ db }: { db: AirplaneDexie }) => ({ sites: await sites(db).toArray() }),
  },
  GetSite: {
    store: ({ db }: { db: AirplaneDexie }, data: { site: Site | null }) => data.site && sites(db).put(data.site),
    read: async ({ db, variables }: { db: AirplaneDexie, variables: { id: string } }) => ({ site: (await sites(db).get(variables.id)) ?? null }),
  },
} as unknown as QueryHandlers

function createClient(server: Server, extra: Partial<AirplaneClientOptions> & { request?: AirplaneRequestOptions } = {}) {
  return createAirplaneClient({
    endpoint: 'http://api.test/graphql',
    dbName: extra.dbName ?? `test-${++n}`,
    documentsHash: 'h1',
    documents,
    entities: ENTITIES,
    mutationHandlers: {},
    queryHandlers: siteQueries,
    stores: { stores: {} },
    ...extra,
    request: { fetch: server.fetch as unknown as typeof fetch, ...extra.request },
  })
}

type Ctx<V> = { db: AirplaneDexie, variables: V }

/** Mutation handlers that edit the `Site` table; every query reading it follows. */
const siteHandlers = {
  RenameSite: {
    describe: ({ variables }: Ctx<{ id: string, name: string }>) => `Rename ${variables.id} to ${variables.name}`,
    apply: ({ db, variables }: Ctx<{ id: string, name: string }>) => sites(db).update(variables.id, { name: variables.name }),
  },
  ArchiveSite: {
    apply: ({ db, variables }: Ctx<{ id: string }>) => sites(db).update(variables.id, { archived: true }),
  },
} as unknown as MutationHandlers

/** Create with a placeholder id; `resolve` re-keys the row to the server's id. */
const createHandlers = {
  ...siteHandlers,
  CreateSite: {
    apply: ({ db, variables, tempId }: Ctx<{ name: string }> & { tempId: () => string }) =>
      sites(db).put({ id: tempId(), name: variables.name, archived: false }),
    reconcile: ({ tempIds, resolve }: { tempIds: string[], resolve: (t: string, id: string) => Promise<void> }, result: { createSite: Site }) =>
      resolve(tempIds[0]!, result.createSite.id),
  },
} as unknown as MutationHandlers

async function until(check: () => boolean | Promise<boolean>, what = 'condition', timeout = 3000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await check()) return
    await new Promise(r => setTimeout(r, 10))
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/**
 * Puts an APQ layer in front of the fake server: a hash-only request is
 * answered from the documents it has seen, else with PersistedQueryNotFound.
 * Returns what each request carried.
 */
function withApq(support = true) {
  const impl = server.fetch.getMockImplementation()!
  const known = new Map<string, string>()
  const sent: { query: boolean, hash: boolean }[] = []
  server.fetch.mockImplementation(async (url, init) => {
    const body = JSON.parse(init!.body as string) as { query?: string, variables?: unknown, extensions?: { persistedQuery?: { sha256Hash: string } } }
    const hash = body.extensions?.persistedQuery?.sha256Hash
    sent.push({ query: !!body.query, hash: !!hash })
    if (hash && !support) return Response.json({ errors: [{ message: 'PersistedQueryNotSupported', extensions: { code: 'PERSISTED_QUERY_NOT_SUPPORTED' } }] })
    let query = body.query
    if (!query && hash) {
      query = known.get(hash)
      if (!query) return Response.json({ errors: [{ message: 'PersistedQueryNotFound', extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' } }] })
    }
    if (hash && body.query) known.set(hash, body.query)
    return impl(url, { ...init, body: JSON.stringify({ query, variables: body.variables }) })
  })
  return sent
}

/** Fails every request for `op` with a network error until the returned function is called. */
function cutNetworkFor(op: string) {
  const impl = server.fetch.getMockImplementation()!
  let down = true
  server.fetch.mockImplementation(async (url, init) => {
    if (down && (init!.body as string).includes(`mutation ${op}`)) throw new TypeError('Failed to fetch')
    return impl(url, init)
  })
  return () => (down = false)
}

/** The live data of a query, as `useQuery` would see it. */
function watchData(client: AirplaneClient, name: string, variables?: unknown) {
  const { snapshot } = client.watchQuery(name, variables)
  return <T = unknown>() => snapshot.value.data as T
}

/** The `Site` table, in id order: what GetSites reads back. */
async function cachedSites(client: AirplaneClient) {
  return sites(client.db).orderBy('id').toArray()
}

let server: Server
beforeEach(() => {
  server = createServer()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** A minimal Web Locks API: one queue per name, callbacks run one at a time. */
function fakeLocks() {
  const tails = new Map<string, Promise<void>>()
  return {
    async request(name: string, optionsOrCallback: unknown, maybeCallback?: (lock: { name: string }) => Promise<unknown>) {
      const callback = (typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback) as (lock: { name: string }) => Promise<unknown>
      const previous = tails.get(name) ?? Promise.resolve()
      let release!: () => void
      const mine = new Promise<void>((resolve) => {
        release = resolve
      })
      tails.set(name, previous.then(() => mine))
      await previous
      try {
        return await callback({ name })
      }
      finally {
        release()
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

describe('queries', () => {
  it('stores a response through the handler and serves the query from the tables', async () => {
    const client = createClient(server)
    const data = await client.fetchQuery<{ sites: Site[] }>('GetSites', undefined)
    expect(data.sites).toHaveLength(2)
    expect(await sites(client.db).count()).toBe(2)
    // The fetch record carries no data: the tables hold it.
    expect((await client.db.queries.toArray())[0]).toEqual({ key: expect.any(String), document: 'GetSites', variables: undefined, updatedAt: expect.any(Number) })

    const { snapshot, unsubscribe } = client.watchQuery('GetSites', undefined)
    await until(() => snapshot.value.cached, 'fetch record')
    expect((snapshot.value.data as { sites: Site[] }).sites[0]!.name).toBe('North')
    expect(snapshot.value.updatedAt).toBeTypeOf('number')
    unsubscribe()
  })

  it('keeps a fetch record per variables and sends them to the server', async () => {
    const client = createClient(server)
    await client.fetchQuery('GetSite', { id: 's1' })
    await client.fetchQuery('GetSite', { id: 's2' })
    expect(await client.db.queries.where('document').equals('GetSite').count()).toBe(2)
    expect(server.calls.map(c => c.variables)).toEqual([{ id: 's1' }, { id: 's2' }])
  })

  it('reads a query from rows another query stored', async () => {
    const readOnly = { GetSite: { read: (siteQueries as never as Record<string, { read: unknown }>).GetSite!.read } } as unknown as QueryHandlers
    const client = createClient(server, { queryHandlers: { ...siteQueries, ...readOnly } })
    await client.fetchQuery('GetSites', undefined)
    const site = watchData(client, 'GetSite', { id: 's2' })
    await until(() => site<{ site: Site } | null>()?.site?.name === 'South', 'read from the Site table')
  })

  it('serves a query without a handler from the network and keeps nothing', async () => {
    const client = createClient(server, { queryHandlers: {} })
    expect(client.readable('GetSites')).toBe(false)
    const data = await client.fetchQuery<{ sites: Site[] }>('GetSites', undefined)
    expect(data.sites).toHaveLength(2)
    expect(await client.db.queries.count()).toBe(0)
    expect(await sites(client.db).count()).toBe(0)
    const { snapshot, unsubscribe } = client.watchQuery('GetSites', undefined)
    await new Promise(r => setTimeout(r, 20))
    expect(snapshot.value).toEqual({ data: null, updatedAt: null, cached: false })
    unsubscribe()
  })

  it('rejects a response without data and stores nothing', async () => {
    server.fetch.mockResolvedValueOnce(Response.json({}))
    const client = createClient(server)
    await expect(client.fetchQuery('GetSites', undefined)).rejects.toThrow(/no data/)
    expect(await client.db.queries.count()).toBe(0)
    expect(await sites(client.db).count()).toBe(0)
  })

  it('aborts hung requests after the timeout', async () => {
    server.fetch.mockImplementationOnce((_url, init) =>
      new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))))
    const client = createClient(server, { request: { timeout: 50 } })
    await expect(client.fetchQuery('GetSites', undefined)).rejects.toMatchObject({ name: 'TimeoutError' })
    // The client is not wedged: the next request goes through.
    await expect(client.fetchQuery('GetSites', undefined)).resolves.toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

describe('request headers', () => {
  it('merges static and per-request headers, computed at send time', async () => {
    let token = 'first'
    const headers = vi.fn((_ctx: AirplaneRequestContext) => ({ Authorization: `Bearer ${token}` }))
    const client = createClient(server, { headers: { 'x-api-key': 'k' }, request: { headers } })

    await client.fetchQuery('GetSites', undefined)
    token = 'second'
    await client.fetchQuery('GetSites', undefined)

    expect(headers).toHaveBeenCalledTimes(2)
    expect(headers.mock.calls[0]![0]).toMatchObject({ document: 'GetSites', kind: 'query' })
    expect(server.calls.map(c => c.headers.get('authorization'))).toEqual(['Bearer first', 'Bearer second'])
    expect(server.calls[0]!.headers.get('x-api-key')).toBe('k')
    expect(server.calls[0]!.headers.get('content-type')).toBe('application/json')
  })

  it('calls onResponse with every response', async () => {
    const onResponse = vi.fn()
    const client = createClient(server, { request: { onResponse } })
    await client.fetchQuery('GetSites', undefined)
    expect(onResponse).toHaveBeenCalledTimes(1)
    expect(onResponse.mock.calls[0]![0]).toBeInstanceOf(Response)
    expect(onResponse.mock.calls[0]![1]).toMatchObject({ document: 'GetSites' })
  })
})

// ---------------------------------------------------------------------------
// Mutations / outbox
// ---------------------------------------------------------------------------

describe('mutations', () => {
  it('applies optimistically, describes, syncs and refetches', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)

    const row = await client.enqueue('RenameSite', { id: 's1', name: 'Nord' })
    expect(row.description).toBe('Rename s1 to Nord')
    // Visible locally before the server has answered.
    expect((await cachedSites(client))[0]!.name).toBe('Nord')

    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[0]!.name).toBe('Nord')
    expect(server.mutations().map(c => c.op)).toEqual(['RenameSite'])
  })

  it('humanizes the document name when there is no describe', async () => {
    const client = createClient(server)
    client.goOffline()
    const row = await client.enqueue('ArchiveSite', { id: 's1' })
    expect(row.description).toBe('Archive site')
  })

  it('holds mutations while offline and sends them in order on goOnline', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()

    await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    await client.enqueue('ArchiveSite', { id: 's2' })
    await new Promise(r => setTimeout(r, 50))
    expect(server.mutations()).toHaveLength(0)
    expect(client.state.pending).toHaveLength(2)
    expect(client.synced.value).toBe(false)

    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => c.op)).toEqual(['RenameSite', 'ArchiveSite'])
    expect(server.sites).toMatchObject([{ name: 'A' }, { archived: true }])
  })

  it('parks server-rejected mutations as failed, then retries them', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)

    const row = await client.enqueue('RenameSite', { id: 's1', name: 'bad' })
    await until(async () => (await client.db.mutations.get(row.id))?.status === 'failed', 'failed status')
    expect((await client.db.mutations.get(row.id))?.error).toBe('name rejected')

    // Fix the input on the row and retry: the server accepts it now.
    await client.db.mutations.update(row.id, { variables: { id: 's1', name: 'good' } })
    await client.retry(row.id)
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[0]!.name).toBe('good')
  })

  it('leaves the queue intact on network errors and resumes later', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    server.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))

    const row = await client.enqueue('RenameSite', { id: 's1', name: 'Later' })
    await until(() => client.state.lastError !== null, 'network error recorded')
    expect((await client.db.mutations.get(row.id))?.status).toBe('pending')

    await client.sync()
    expect(await client.db.mutations.count()).toBe(0)
    expect(server.sites[0]!.name).toBe('Later')
  })

  it('sends a mutation queued while a batch is being sent', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)

    // Hold the first request so the second mutation is queued mid-batch.
    let release!: () => void
    const gate = new Promise<void>(r => (release = r))
    const impl = server.fetch.getMockImplementation()!
    server.fetch.mockImplementationOnce(async (...args) => {
      await gate
      return impl(...args)
    })
    await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    await until(() => client.state.syncing, 'batch to start')
    await client.enqueue('ArchiveSite', { id: 's2' })
    release()

    // No other trigger: the loop itself must pick up the new row.
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => c.op)).toEqual(['RenameSite', 'ArchiveSite'])
  })

  it('drops the row if apply throws', async () => {
    const client = createClient(server, {
      mutationHandlers: { ArchiveSite: { apply: () => { throw new Error('boom') } } } as unknown as MutationHandlers,
    })
    await expect(client.enqueue('ArchiveSite', { id: 's1' })).rejects.toThrow('boom')
    expect(await client.db.mutations.count()).toBe(0)
  })

  it('refuses to enqueue a query document', async () => {
    const client = createClient(server)
    await expect(client.enqueue('GetSites', undefined)).rejects.toThrow(/not a mutation/)
  })
})

// ---------------------------------------------------------------------------
// Ordered delivery
// ---------------------------------------------------------------------------

describe('ordered delivery', () => {
  async function failFirst(client: AirplaneClient) {
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const a = await client.enqueue('RenameSite', { id: 's1', name: 'bad' })
    const b = await client.enqueue('ArchiveSite', { id: 's2' })
    client.goOnline()
    await until(async () => (await client.db.mutations.get(a.id))?.status === 'failed', 'first mutation to fail')
    return { a, b }
  }

  it('holds back the mutations queued after a failed one until it is rolled back', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    const { a, b } = await failFirst(client)
    await new Promise(r => setTimeout(r, 50))
    expect(server.mutations().map(c => c.op)).toEqual(['RenameSite'])
    expect((await client.db.mutations.get(b.id))?.status).toBe('pending')
    await until(() => client.state.blocked === 1, 'blocked count')

    await client.rollback(a.id)
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[1]!.archived).toBe(true)
    expect(client.state.blocked).toBe(0)
  })

  it('retry sends the failed mutation and the ones behind it, in order', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    const { a } = await failFirst(client)
    await client.db.mutations.update(a.id, { variables: { id: 's1', name: 'good' } })
    await client.retry(a.id)
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => c.op)).toEqual(['RenameSite', 'RenameSite', 'ArchiveSite'])
    expect(server.sites).toMatchObject([{ name: 'good' }, { archived: true }])
  })

  it('keeps sending past a failed mutation with stopOnFailure: false', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers, stopOnFailure: false })
    const { a, b } = await failFirst(client)
    await until(async () => (await client.db.mutations.get(b.id)) === undefined, 'second mutation to sync')
    expect((await client.db.mutations.get(a.id))?.status).toBe('failed')
    expect(server.sites[1]!.archived).toBe(true)
    expect(client.state.blocked).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Cross-tab sync lock
// ---------------------------------------------------------------------------

describe('cross-tab sync lock', () => {
  it('waits while another tab holds the lock, then sends what is still queued', async () => {
    const locks = fakeLocks()
    vi.stubGlobal('navigator', { onLine: true, locks })
    const dbName = `test-lock-${++n}`
    // Another tab is mid-sync and holds the lock.
    let releaseOtherTab!: () => void
    void locks.request(`nuxt-airplane:sync:${dbName}`, () => new Promise<void>((resolve) => {
      releaseOtherTab = resolve
    }))

    const client = createClient(server, { dbName, mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    const row = await client.enqueue('RenameSite', { id: 's1', name: 'Locked' })
    await new Promise(r => setTimeout(r, 80))
    expect(server.mutations()).toHaveLength(0)
    expect((await client.db.mutations.get(row.id))?.status).toBe('pending')

    releaseOtherTab()
    await until(async () => (await client.db.mutations.count()) === 0, 'queued mutation to be sent after the lock is released')
    expect(server.mutations().map(c => c.op)).toEqual(['RenameSite'])
  })

  it('sends each mutation exactly once when two tabs sync the same outbox', async () => {
    const locks = fakeLocks()
    vi.stubGlobal('navigator', { onLine: true, locks })
    const dbName = `test-tabs-${++n}`
    const tabA = createClient(server, { dbName, mutationHandlers: siteHandlers })
    const tabB = createClient(server, { dbName, mutationHandlers: siteHandlers })
    await tabA.fetchQuery('GetSites', undefined)

    await Promise.all([
      tabA.enqueue('RenameSite', { id: 's1', name: 'From A' }),
      tabB.enqueue('ArchiveSite', { id: 's2' }),
    ])
    await until(async () => (await tabA.db.mutations.count()) === 0, 'outbox to drain')
    await Promise.all([tabA.sync(), tabB.sync()])

    expect(server.mutations().map(c => c.op).sort()).toEqual(['ArchiveSite', 'RenameSite'])
    expect(server.sites).toMatchObject([{ name: 'From A' }, { archived: true }])
  })

  it('syncs without the Web Locks API', async () => {
    vi.stubGlobal('navigator', { onLine: true })
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[0]!.archived).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Rollback and rebase
// ---------------------------------------------------------------------------

describe('rollback', () => {
  it('undoes a mutation and replays the later ones on top', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()

    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'Renamed' })
    await client.enqueue('ArchiveSite', { id: 's1' })
    expect((await cachedSites(client))[0]).toMatchObject({ name: 'Renamed', archived: true })

    await client.rollback(rename.id)
    expect((await cachedSites(client))[0]).toMatchObject({ name: 'North', archived: true })
    expect(await client.db.mutations.count()).toBe(1)
  })

  it('uses the revert hook when provided', async () => {
    const revert = vi.fn()
    const client = createClient(server, {
      mutationHandlers: { ...siteHandlers, ArchiveSite: { ...(siteHandlers as never as Record<string, object>).ArchiveSite, revert } } as unknown as MutationHandlers,
    })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const row = await client.enqueue('ArchiveSite', { id: 's1' })
    await client.rollback(row.id)
    expect(revert).toHaveBeenCalledTimes(1)
    expect(await client.db.mutations.count()).toBe(0)
  })

  it('re-applies pending mutations when fresh server data arrives', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'Local' })

    // A refetch lands with the server's (older) state.
    await client.fetchQuery('GetSites', undefined)
    expect((await cachedSites(client))[0]!.name).toBe('Local')
  })
})

// ---------------------------------------------------------------------------
// Inferred tables
// ---------------------------------------------------------------------------

describe('inferred tables', () => {
  it('merges the inferred tables with the user stores', () => {
    const entities = { Site: { key: 'id' }, Item: { key: 'id' } }
    expect(mergeStores(entities, {})).toEqual({ Site: '&id', Item: '&id' })
    expect(mergeStores(entities, { Item: 'name, &id', drafts: '++id, body' }))
      .toEqual({ Site: '&id', Item: '&id, name', drafts: '++id, body' })
  })

  it('opens a table per entity, keyed on its id', async () => {
    const client = createClient(server, { stores: { stores: { Site: 'name' } } })
    await client.ready
    expect(client.db.tables.map(t => t.name).sort()).toEqual(['Site', 'meta', 'mutations', 'queries'])
    expect(sites(client.db).schema.primKey.keyPath).toBe('id')
    expect(sites(client.db).schema.indexes.map(i => i.name)).toEqual(['name'])
  })

  it('re-keys a row created under a temp id once the server has named it', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    expect(isTempId(tmp)).toBe(true)

    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(await sites(client.db).get(tmp)).toBeUndefined()
    expect(await sites(client.db).get('s3')).toMatchObject({ name: 'West' })
  })
})

// ---------------------------------------------------------------------------
// Persisted queries
// ---------------------------------------------------------------------------

describe('persisted queries', () => {
  it('sends the hash first and the text only once the server asks for it', async () => {
    const sent = withApq()
    const client = createClient(server, { documents: hashedDocuments, persistedQueries: 'automatic' })
    await client.fetchQuery('GetSites', undefined)
    await client.fetchQuery('GetSites', undefined)
    expect(sent).toEqual([
      { hash: true, query: false }, // miss
      { hash: true, query: true }, // registers the text
      { hash: true, query: false }, // known from now on
    ])
    expect(await cachedSites(client)).toHaveLength(2)
  })

  it('falls back to full documents for the session when the server does not support it', async () => {
    const sent = withApq(false)
    const client = createClient(server, { documents: hashedDocuments, persistedQueries: 'automatic' })
    await client.fetchQuery('GetSites', undefined)
    await client.fetchQuery('GetSite', { id: 's1' })
    expect(sent).toEqual([
      { hash: true, query: false },
      { hash: false, query: true },
      { hash: false, query: true },
    ])
  })

  it('never sends the text in manifest mode and surfaces an unknown hash as an error', async () => {
    const sent = withApq()
    const client = createClient(server, { documents: hashedDocuments, persistedQueries: 'manifest' })
    await expect(client.fetchQuery('GetSites', undefined)).rejects.toThrow('PersistedQueryNotFound')
    expect(sent).toEqual([{ hash: true, query: false }])
    expect(await client.db.queries.count()).toBe(0)
  })

  it('sends the text when a document has no hash, and when the option is off', async () => {
    const sent = withApq()
    const unhashed = createClient(server, { persistedQueries: 'automatic' })
    await unhashed.fetchQuery('GetSites', undefined)
    const off = createClient(server, { documents: hashedDocuments })
    await off.fetchQuery('GetSites', undefined)
    expect(sent).toEqual([{ hash: false, query: true }, { hash: false, query: true }])
  })

  it('applies to mutations sent from the outbox', async () => {
    const sent = withApq()
    const client = createClient(server, { documents: hashedDocuments, persistedQueries: 'automatic', mutationHandlers: siteHandlers })
    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[0]!.archived).toBe(true)
    expect(sent.slice(0, 2)).toEqual([{ hash: true, query: false }, { hash: true, query: true }])
  })
})

// ---------------------------------------------------------------------------
// Temp ids: create offline, edit before sync
// ---------------------------------------------------------------------------

describe('temp ids', () => {
  it('mints a tmp- uuid and finds it anywhere in the variables', () => {
    const id = newTempId()
    expect(isTempId(id)).toBe(true)
    expect(isTempId('tmp-1700000000000')).toBe(false)
    const { value, replaced, unresolved } = substituteTempIds({ id, nested: { ids: [id, 'x'] }, other: newTempId() }, { [id]: 's9' })
    expect(replaced).toBe(true)
    expect(value).toMatchObject({ id: 's9', nested: { ids: ['s9', 'x'] } })
    expect(unresolved).toHaveLength(1)
  })

  it('sends a queued edit of a row created offline with the server id', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()

    await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    expect(isTempId(tmp)).toBe(true)
    await client.enqueue('RenameSite', { id: tmp, name: 'West 2' })
    expect((await cachedSites(client)).find(s => s.id === tmp)!.name).toBe('West 2')

    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => [c.op, c.variables])).toEqual([
      ['CreateSite', { name: 'West' }],
      ['RenameSite', { id: 's3', name: 'West 2' }],
    ])
    expect(server.sites[2]).toMatchObject({ id: 's3', name: 'West 2' })
    expect((await cachedSites(client)).find(s => s.id === 's3')!.name).toBe('West 2')

    // The mapping outlives the outbox: a component may still hold the temp id.
    await client.enqueue('ArchiveSite', { id: tmp })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain again')
    expect(server.mutations().at(-1)).toMatchObject({ op: 'ArchiveSite', variables: { id: 's3' } })
  })

  it('caps the map at the newest 1000 resolutions', async () => {
    const handlers = { ArchiveSite: { reconcile: ({ resolve }: never) => (resolve as (t: string, i: string) => Promise<void>)('tmp-new', 'sX') } } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: handlers })
    await client.ready
    const full = Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`tmp-${i}`, `s${i}`]))
    await client.db.meta.put({ key: 'tempIds', value: JSON.stringify(full) })

    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    const ids = JSON.parse((await client.db.meta.get('tempIds'))!.value) as Record<string, string>
    expect(Object.keys(ids)).toHaveLength(1000)
    expect(ids['tmp-0']).toBeUndefined()
    expect(ids['tmp-1']).toBeUndefined()
    expect(ids['tmp-2']).toBe('s2')
    expect(ids['tmp-new']).toBe('sX')
  })

  it('keeps the same temp id when apply is re-run on fresh server data', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const row = await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id

    await client.fetchQuery('GetSites', undefined) // rebase
    const sites = (await cachedSites(client)).filter(s => s.name === 'West')
    expect(sites.map(s => s.id)).toEqual([tmp])
    expect((await client.db.mutations.get(row.id))?.tempIds).toEqual([tmp])
  })

  it('keeps the edit visible after the create is reconciled and the query refetched', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    await client.enqueue('RenameSite', { id: tmp, name: 'West 2' })

    // The rename hits a network error right after the create was accepted,
    // then a refetch lands: the rename must be re-applied on the real id.
    cutNetworkFor('RenameSite')
    client.goOnline()
    await until(() => client.state.lastError !== null, 'network error')
    expect(await client.db.mutations.count()).toBe(1)
    expect((await client.db.mutations.toArray())[0]!.variables).toEqual({ id: 's3', name: 'West 2' })

    await client.fetchQuery('GetSites', undefined)
    expect((await cachedSites(client)).find(s => s.id === 's3')!.name).toBe('West 2')
  })

  it('remembers resolved ids across a reload', async () => {
    const dbName = `test-reload-${++n}`
    const client = createClient(server, { dbName, mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    await client.enqueue('RenameSite', { id: tmp, name: 'West 2' })

    // Only the create gets through before the "tab" closes. Resolution happens
    // in reconcile, before the rewrite of the next row, so the map must be on disk.
    const restore = cutNetworkFor('RenameSite')
    client.goOnline()
    await until(() => client.state.lastError !== null, 'network error')
    client.db.close()
    restore()

    const reopened = createClient(server, { dbName, mutationHandlers: createHandlers })
    await until(async () => (await reopened.db.mutations.count()) === 0, 'outbox to drain after reload')
    expect(server.mutations().at(-1)).toMatchObject({ op: 'RenameSite', variables: { id: 's3', name: 'West 2' } })
  })

  it('fails a mutation that still carries an unresolved temp id instead of sending it', async () => {
    const noResolve = {
      ...createHandlers,
      CreateSite: { apply: (createHandlers as never as Record<string, { apply: unknown }>).CreateSite!.apply },
    } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: noResolve })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    const rename = await client.enqueue('RenameSite', { id: tmp, name: 'West 2' })

    client.goOnline()
    await until(async () => (await client.db.mutations.get(rename.id))?.status === 'failed', 'failed status')
    expect((await client.db.mutations.get(rename.id))?.error).toMatch(/temp id .* did not call resolve/)
    expect(server.mutations().map(c => c.op)).toEqual(['CreateSite'])
  })
})

// ---------------------------------------------------------------------------
// Direct mutations
// ---------------------------------------------------------------------------

describe('execute', () => {
  it('sends now, returns the server data, reconciles and refetches', async () => {
    const reconcile = vi.fn()
    const client = createClient(server, {
      mutationHandlers: { RenameSite: { reconcile, refetch: ['GetSites'] } } as unknown as MutationHandlers,
    })
    await client.fetchQuery('GetSites', undefined)
    const refresh = vi.fn(async () => {})
    client.active.set('GetSites:x', refresh)

    const result = await client.execute<{ renameSite: Site }>('RenameSite', { id: 's1', name: 'Direct' })
    expect(result.renameSite).toMatchObject({ id: 's1', name: 'Direct' })
    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ variables: { id: 's1', name: 'Direct' } }), result)
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(await client.db.mutations.count()).toBe(0)
  })

  it('rejects while offline and on server errors, and refuses queries', async () => {
    const client = createClient(server)
    client.goOffline()
    await expect(client.execute('RenameSite', { id: 's1', name: 'x' })).rejects.toThrow(/offline/)
    client.goOnline()
    await expect(client.execute('RenameSite', { id: 's1', name: 'bad' })).rejects.toThrow('name rejected')
    await expect(client.execute('GetSites', undefined)).rejects.toThrow(/not a mutation/)
  })

  it('drains the outbox first and rewrites temp ids', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id

    // Back online without kicking the loop: execute must send the create itself.
    client.state.forcedOffline = false
    const result = await client.execute<{ renameSite: Site }>('RenameSite', { id: tmp, name: 'West 2' })
    expect(result.renameSite).toMatchObject({ id: 's3', name: 'West 2' })
    expect(server.mutations().map(c => [c.op, c.variables])).toEqual([
      ['CreateSite', { name: 'West' }],
      ['RenameSite', { id: 's3', name: 'West 2' }],
    ])
  })
})

// ---------------------------------------------------------------------------
// Query handlers, stores, undo log on user tables
// ---------------------------------------------------------------------------

describe('query handlers and stores', () => {
  const stores = { stores: { sites: '&id, archived' } }
  const queryHandlers = {
    GetSites: {
      store: ({ db }: { db: { sites: { bulkPut: (rows: Site[]) => Promise<unknown> } } }, data: { sites: Site[] }) => db.sites.bulkPut(data.sites),
      read: async ({ db }: { db: { sites: { toArray: () => Promise<Site[]> } } }) => ({ sites: await db.sites.toArray() }),
    },
  } as unknown as QueryHandlers
  const mutationHandlers = {
    RenameSite: {
      apply: ({ db, variables }: { db: { sites: { update: (k: string, c: object) => Promise<number> } }, variables: { id: string, name: string } }) =>
        db.sites.update(variables.id, { name: variables.name }),
    },
  } as unknown as MutationHandlers

  it('stores through the handler, reads live from the table, and undoes table writes', async () => {
    const client = createClient(server, { stores, queryHandlers, mutationHandlers })
    await client.fetchQuery('GetSites', undefined)

    const table = client.db.table<Site>('sites')
    expect(await table.count()).toBe(2)

    const { snapshot, unsubscribe } = client.watchQuery('GetSites', undefined)
    await until(() => snapshot.value.cached, 'read snapshot')

    client.goOffline()
    const row = await client.enqueue('RenameSite', { id: 's1', name: 'Tabled' })
    await until(() => (snapshot.value.data as { sites: Site[] }).sites[0]!.name === 'Tabled', 'live read to update')
    expect((await client.db.mutations.get(row.id))?.undo).toMatchObject([{ table: 'sites', key: 's1', before: { name: 'North' } }])

    await client.rollback(row.id)
    expect((await table.get('s1'))!.name).toBe('North')
    unsubscribe()
  })

  it('clear() empties user tables too, clearCache() keeps the outbox', async () => {
    const client = createClient(server, { stores, queryHandlers, mutationHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'X' })

    await client.clearCache()
    expect(await client.db.table('sites').count()).toBe(0)
    expect(await client.db.queries.count()).toBe(0)
    expect(await client.db.mutations.count()).toBe(1)

    await client.clear()
    expect(await client.db.mutations.count()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Prefetch
// ---------------------------------------------------------------------------

describe('prefetch', () => {
  type Page = { searchItems: { edges: { node: { id: string } }[], pageInfo: { hasNextPage: boolean, endCursor: string } } }
  const stores = { stores: { items: '&id' } }
  const queryHandlers = {
    SearchItems: {
      prefetch: {
        next: (data: Page, variables: object) =>
          data.searchItems.pageInfo.hasNextPage ? { ...variables, after: data.searchItems.pageInfo.endCursor } : null,
      },
      store: ({ db }: { db: AirplaneDexie }, data: Page) => db.table('items').bulkPut(data.searchItems.edges.map(e => e.node)),
    },
  } as unknown as QueryHandlers

  it('walks every page after the first fetch', async () => {
    const client = createClient(server, { stores, queryHandlers })
    await client.fetchQuery('SearchItems', {})
    await until(async () => (await client.db.queries.where('document').equals('SearchItems').count()) === 3, 'all pages fetched')
    expect(server.calls.filter(c => c.op === 'SearchItems').map(c => c.variables)).toEqual([{}, { after: '2' }, { after: '4' }])
    await until(() => client.state.prefetching === 0, 'prefetch to finish')
    expect(await client.db.table('items').count()).toBe(5)
  })

  it('respects when() and maxPages', async () => {
    const base = (queryHandlers as never as Record<string, { prefetch: object }>).SearchItems!.prefetch
    const gated = { SearchItems: { prefetch: { ...base, when: () => false } } } as unknown as QueryHandlers
    const client = createClient(server, { stores, queryHandlers: gated })
    await client.fetchQuery('SearchItems', {})
    await new Promise(r => setTimeout(r, 50))
    expect(server.calls.filter(c => c.op === 'SearchItems')).toHaveLength(1)

    const capped = { SearchItems: { prefetch: { ...base, maxPages: 1 } } } as unknown as QueryHandlers
    const client2 = createClient(server, { stores, queryHandlers: capped })
    server.calls.length = 0
    await client2.fetchQuery('SearchItems', {})
    await until(() => client2.state.prefetching === 0 && server.calls.length === 2, 'one extra page')
  })
})

// ---------------------------------------------------------------------------
// Cache key and startup recovery
// ---------------------------------------------------------------------------

describe('startup', () => {
  it('clears cached data but keeps the outbox when the cache key changes', async () => {
    const dbName = `test-key-${++n}`
    const a = createClient(server, { dbName, cacheKey: 'deploy-1', mutationHandlers: siteHandlers })
    await a.fetchQuery('GetSites', undefined)
    a.goOffline()
    await a.enqueue('RenameSite', { id: 's1', name: 'Pending' })
    expect(await a.db.queries.count()).toBe(1)
    expect((await a.db.meta.get('cacheKey'))?.value).toBe('deploy-1:h1')

    const b = createClient(server, { dbName, cacheKey: 'deploy-2', mutationHandlers: siteHandlers })
    b.goOffline()
    await b.ready
    expect(await b.db.queries.count()).toBe(0)
    expect(await b.db.mutations.count()).toBe(1)
    expect((await b.db.meta.get('cacheKey'))?.value).toBe('deploy-2:h1')
  })

  it('leaves the cache alone when the key is unchanged', async () => {
    const dbName = `test-key-${++n}`
    const a = createClient(server, { dbName, cacheKey: 'same' })
    await a.fetchQuery('GetSites', undefined)
    const b = createClient(server, { dbName, cacheKey: 'same' })
    await b.ready
    expect(await b.db.queries.count()).toBe(1)
  })

  it('re-queues rows left in syncing by a closed tab', async () => {
    const dbName = `test-stuck-${++n}`
    const a = createClient(server, { dbName })
    await a.ready
    await a.db.mutations.add({ document: 'ArchiveSite', variables: { id: 's2' }, description: 'stuck', status: 'syncing', createdAt: Date.now() - 1000 } as never)

    const b = createClient(server, { dbName })
    await until(async () => (await b.db.mutations.count()) === 0, 'stuck row to sync')
    expect(server.sites[1]!.archived).toBe(true)
  })
})
