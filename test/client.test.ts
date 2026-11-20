// Runtime client against a real Dexie on fake-indexeddb, with a mocked fetch
// standing in for the GraphQL server. Everything the module promises about
// the tables, the outbox, rollback, rebase, prefetch and cache keys is exercised here.
import 'fake-indexeddb/auto'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { backoffDelay, createAirplaneClient, offlineKey, parseRetryAfter, queryKey, isTempId, mergeStores, newTempId, substituteTempIds, withDependents, type AirplaneClient, type AirplaneClientOptions } from '../src/runtime/client'
import { describeChanges } from '../src/runtime/db'
import { createEngine, type AirplaneEngineOptions } from '../src/runtime/engine'
import { remoteEngine, serveEngine, type Port } from '../src/runtime/worker'
import type { AirplaneDexie, AirplaneRequestContext, AirplaneRequestOptions, MutationHandlers, OperationDocument, QueryHandlers } from '../src/runtime/types'

// ---------------------------------------------------------------------------
// A tiny in-memory GraphQL "server" behind fetch
// ---------------------------------------------------------------------------

interface Site { id: string, name: string, archived: boolean, items?: { id: string, qty: number }[] }
interface SiteItem { id: string, siteId: string, name: string, qty: number }

const documents: Record<string, OperationDocument> = {
  GetSites: { name: 'GetSites', kind: 'query', source: 'query GetSites { sites { id name archived } }' },
  GetSite: { name: 'GetSite', kind: 'query', source: 'query GetSite($id: ID!) { site(id: $id) { id name archived } }' },
  RenameSite: { name: 'RenameSite', kind: 'mutation', source: 'mutation RenameSite($id: ID!, $name: String!) { renameSite(id: $id, name: $name) { id name } }' },
  ArchiveSite: { name: 'ArchiveSite', kind: 'mutation', source: 'mutation ArchiveSite($id: ID!) { archiveSite(id: $id) { id archived } }' },
  CreateSite: { name: 'CreateSite', kind: 'mutation', source: 'mutation CreateSite($name: String!) { createSite(name: $name) { id name archived } }' },
  AddSiteItem: { name: 'AddSiteItem', kind: 'mutation', source: 'mutation AddSiteItem($siteId: ID!, $name: String!) { addSiteItem(siteId: $siteId, name: $name) { id } }' },
  SetItemQty: { name: 'SetItemQty', kind: 'mutation', source: 'mutation SetItemQty($itemId: ID!, $qty: Int!) { setItemQty(itemId: $itemId, qty: $qty) { id qty } }' },
  SearchItems: { name: 'SearchItems', kind: 'query', source: 'query SearchItems($after: String) { searchItems(after: $after) { edges { node { id } } pageInfo { hasNextPage endCursor } } }' },
  // Results with no id: the signed-in user, and figures per site.
  GetViewer: { name: 'GetViewer', kind: 'query', source: 'query GetViewer { viewer { name role } }' },
  GetSiteStats: { name: 'GetSiteStats', kind: 'query', source: 'query GetSiteStats($siteId: ID!) { siteStats(siteId: $siteId) { siteName itemCount } }' },
  RenameViewer: { name: 'RenameViewer', kind: 'mutation', source: 'mutation RenameViewer($name: String!) { renameViewer(name: $name) { name role } }' },
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
  const siteItems: SiteItem[] = []
  const viewer = { name: 'Ada', role: 'admin' }
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
        if (v.name === 'bad') return Response.json({ errors: [{ message: 'name rejected' }] })
        const site = { id: `s${sites.length + 1}`, name: v.name!, archived: false }
        sites.push(site)
        return reply({ createSite: { ...site } })
      }
      case 'AddSiteItem': {
        if (v.name === 'bad') return Response.json({ errors: [{ message: 'item rejected' }] })
        if (!sites.some(s => s.id === v.siteId)) return Response.json({ errors: [{ message: `no site ${v.siteId}` }] })
        const item = { id: `i${siteItems.length + 1}`, siteId: v.siteId!, name: v.name!, qty: 0 }
        siteItems.push(item)
        return reply({ addSiteItem: { id: item.id } })
      }
      case 'SetItemQty': {
        const item = siteItems.find(i => i.id === v.itemId)
        if (!item) return Response.json({ errors: [{ message: `no item ${v.itemId}` }] })
        item.qty = Number(v.qty)
        return reply({ setItemQty: { id: item.id, qty: item.qty } })
      }
      case 'GetViewer': return reply({ viewer: { ...viewer } })
      case 'GetSiteStats': return reply({ siteStats: { siteName: sites.find(s => s.id === v.siteId)?.name ?? null, itemCount: siteItems.filter(i => i.siteId === v.siteId).length } })
      case 'RenameViewer': {
        if (v.name === 'bad') return Response.json({ errors: [{ message: 'name rejected' }] })
        viewer.name = v.name!
        return reply({ renameViewer: { ...viewer } })
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

  return { sites, siteItems, viewer, calls, fetch, mutations: () => calls.filter(c => documents[c.op]!.kind === 'mutation') }
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

/**
 * A site, an item in it and the item's quantity, each queued offline against
 * the placeholder the previous one minted: a chain of three. `SiteItem` is a
 * second inferred table so the item is re-keyed on resolve too.
 */
const CHAIN_ENTITIES = { Site: { key: 'id' }, SiteItem: { key: 'id' } }
const siteItems = (db: AirplaneDexie) => db.table<SiteItem, string>('SiteItem')
const chainHandlers = {
  ...createHandlers,
  AddSiteItem: {
    apply: ({ db, variables, tempId }: Ctx<{ siteId: string, name: string }> & { tempId: () => string }) =>
      siteItems(db).put({ id: tempId(), siteId: variables.siteId, name: variables.name, qty: 0 }),
    reconcile: ({ tempIds, resolve }: { tempIds: string[], resolve: (t: string, id: string) => Promise<void> }, result: { addSiteItem: { id: string } }) =>
      resolve(tempIds[0]!, result.addSiteItem.id),
  },
  SetItemQty: {
    apply: ({ db, variables }: Ctx<{ itemId: string, qty: number }>) => siteItems(db).update(variables.itemId, { qty: variables.qty }),
  },
} as unknown as MutationHandlers

/**
 * The playground's shape: an item is a catalog entry with a real id, kept on
 * the site row. Nothing is minted, so what links the quantity update to the
 * add is the item the add created on the site.
 */
const nestedHandlers = {
  ...createHandlers,
  AddSiteItem: {
    apply: ({ db, variables }: Ctx<{ siteId: string, name: string }>) =>
      sites(db).update(variables.siteId, (site) => {
        site.items = [...(site.items ?? []), { id: variables.name, qty: 0 }]
      }),
  },
  SetItemQty: {
    apply: ({ db, variables }: Ctx<{ itemId: string, qty: number }>) =>
      sites(db).filter(site => !!site.items?.some(i => i.id === variables.itemId)).modify((site) => {
        site.items = site.items!.map(i => (i.id === variables.itemId ? { ...i, qty: variables.qty } : i))
      }),
  },
} as unknown as MutationHandlers

/** Offline: the three-link chain above, then an unrelated archive of an existing site. */
async function queueChain(client: AirplaneClient, name = 'West') {
  await client.fetchQuery('GetSites', undefined)
  client.goOffline()
  const site = await client.enqueue('CreateSite', { name })
  const tmpSite = (await cachedSites(client)).find(s => s.name === name)!.id
  const item = await client.enqueue('AddSiteItem', { siteId: tmpSite, name: 'Bolt' })
  const tmpItem = (await siteItems(client.db).toArray())[0]!.id
  const qty = await client.enqueue('SetItemQty', { itemId: tmpItem, qty: 3 })
  const other = await client.enqueue('ArchiveSite', { id: 's2' })
  return { site, item, qty, other, tmpSite, tmpItem }
}

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

/** The live data of a query, as `useAirplaneQuery` would see it. */
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
    expect((await client.db.queries.toArray())[0]).toEqual({ key: expect.any(String), document: 'GetSites', variables: undefined, updatedAt: expect.any(Number), rows: [['Site', 's1'], ['Site', 's2']] })

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
    await until(() => client.failed.value.length === 1, 'failed list')
    expect(client.failed.value[0]).toMatchObject({ id: row.id, error: 'name rejected' })

    // Fix the input on the row and retry: the server accepts it now.
    await client.db.mutations.update(row.id, { variables: { id: 's1', name: 'good' } })
    await client.retry(row.id)
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[0]!.name).toBe('good')
    await until(() => client.failed.value.length === 0, 'failed list to empty')
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
// Failure chains
// ---------------------------------------------------------------------------

describe('failure chains', () => {
  const chainClient = () => createClient(server, { entities: CHAIN_ENTITIES, mutationHandlers: chainHandlers })

  it('links a mutation to the queued ones that minted the placeholders it carries', async () => {
    const client = chainClient()
    const { site, item, qty, other } = await queueChain(client)
    const row = (id: number) => client.db.mutations.get(id)
    expect((await row(site.id))?.dependsOn).toEqual([])
    expect((await row(item.id))?.dependsOn).toEqual([site.id])
    expect((await row(qty.id))?.dependsOn).toEqual([item.id])
    expect((await row(other.id))?.dependsOn).toEqual([])
    expect([...withDependents(await client.db.mutations.toArray(), [site.id])]).toEqual([site.id, item.id, qty.id])
    expect([...withDependents(await client.db.mutations.toArray(), [item.id])]).toEqual([item.id, qty.id])
  })

  it('does not link a placeholder that already has a server id', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    await client.enqueue('CreateSite', { name: 'West' })
    await until(async () => (await client.db.mutations.count()) === 0, 'create to sync')
    const tmp = Object.keys(JSON.parse((await client.db.meta.get('tempIds'))!.value) as Record<string, string>)[0]!
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: tmp, name: 'West 2' })
    expect((await client.db.mutations.get(rename.id))?.dependsOn).toEqual([])
  })

  it('sends unrelated mutations past a failed one', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const a = await client.enqueue('RenameSite', { id: 's1', name: 'bad' })
    const b = await client.enqueue('ArchiveSite', { id: 's2' })
    client.goOnline()
    await until(async () => (await client.db.mutations.get(b.id)) === undefined, 'second mutation to sync')
    expect((await client.db.mutations.get(a.id))?.status).toBe('failed')
    expect(server.sites[1]!.archived).toBe(true)
    expect(client.state.blocked).toBe(0)
  })

  it('holds back the chain below a failed create, and nothing else', async () => {
    const client = chainClient()
    const { site, item, qty, other } = await queueChain(client, 'bad')
    client.goOnline()
    await until(async () => (await client.db.mutations.get(other.id)) === undefined, 'unrelated mutation to sync')
    await new Promise(r => setTimeout(r, 50))
    expect(server.mutations().map(c => c.op)).toEqual(['CreateSite', 'ArchiveSite'])
    expect(await client.db.mutations.get(site.id)).toMatchObject({ status: 'failed', error: 'name rejected' })
    // Never attempted: they wait, with no error of their own.
    for (const id of [item.id, qty.id]) {
      const row = (await client.db.mutations.get(id))!
      expect(row.status).toBe('pending')
      expect(row.error).toBeUndefined()
    }
    await until(() => client.state.blocked === 2, 'blocked count')
  })

  it('a retried create releases its chain, in order, with the ids it resolved', async () => {
    const client = chainClient()
    const { site, tmpSite, tmpItem } = await queueChain(client, 'bad')
    client.goOnline()
    await until(async () => (await client.db.mutations.get(site.id))?.status === 'failed', 'create to fail')
    await client.db.mutations.update(site.id, { variables: { name: 'West' } })
    await client.retry(site.id)
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => [c.op, c.variables])).toEqual([
      ['CreateSite', { name: 'bad' }],
      ['ArchiveSite', { id: 's2' }],
      ['CreateSite', { name: 'West' }],
      ['AddSiteItem', { siteId: 's3', name: 'Bolt' }],
      ['SetItemQty', { itemId: 'i1', qty: 3 }],
    ])
    expect(server.siteItems).toEqual([{ id: 'i1', siteId: 's3', name: 'Bolt', qty: 3 }])
    // Each row was re-keyed as its own create resolved.
    expect(await sites(client.db).get(tmpSite)).toBeUndefined()
    expect(await siteItems(client.db).get(tmpItem)).toBeUndefined()
    expect(await siteItems(client.db).get('i1')).toMatchObject({ name: 'Bolt', qty: 3 })
    expect(client.state.blocked).toBe(0)
  })

  it('names what a rollback would drop, and resolves with what it dropped', async () => {
    const client = chainClient()
    const { site, item, qty, other } = await queueChain(client)
    await until(() => client.state.pending.length === 4, 'pending list')
    expect(client.dependents(site.id).map(m => m.id)).toEqual([item.id, qty.id])
    expect(client.dependents(other.id)).toEqual([])
    expect((await client.rollback(item.id)).map(m => m.id)).toEqual([item.id, qty.id])
    expect(await client.rollback(item.id)).toEqual([])
  })

  it('rolls a mutation back with the chain below it, and nothing else', async () => {
    const client = chainClient()
    const { site, other, tmpSite, tmpItem } = await queueChain(client)
    await client.rollback(site.id)
    expect((await client.db.mutations.toArray()).map(m => m.id)).toEqual([other.id])
    expect(await sites(client.db).get(tmpSite)).toBeUndefined()
    expect(await siteItems(client.db).get(tmpItem)).toBeUndefined()
    expect(await sites(client.db).get('s2')).toMatchObject({ archived: true })
  })

  it('rolls back the middle of a chain, keeping what is above it', async () => {
    const client = chainClient()
    const { site, item, other, tmpSite, tmpItem } = await queueChain(client)
    await client.rollback(item.id)
    expect((await client.db.mutations.toArray()).map(m => m.id)).toEqual([site.id, other.id])
    expect(await sites(client.db).get(tmpSite)).toMatchObject({ name: 'West' })
    expect(await siteItems(client.db).get(tmpItem)).toBeUndefined()
  })

  it('rolls back a chain cleanly after a rebase', async () => {
    const client = chainClient()
    const { site, other, tmpSite, tmpItem } = await queueChain(client)
    await client.fetchQuery('GetSites', undefined) // rebase
    expect(await siteItems(client.db).get(tmpItem)).toMatchObject({ qty: 3 })
    await client.rollback(site.id)
    expect(await sites(client.db).get(tmpSite)).toBeUndefined()
    expect(await siteItems(client.db).get(tmpItem)).toBeUndefined()
    expect((await client.db.mutations.toArray()).map(m => m.id)).toEqual([other.id])
  })

  it('links a mutation to the one that created what its apply touches, with no placeholder involved', async () => {
    const client = createClient(server, { mutationHandlers: nestedHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const site = await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    const add = await client.enqueue('AddSiteItem', { siteId: tmp, name: 'Bolt' })
    const qty = await client.enqueue('SetItemQty', { itemId: 'Bolt', qty: 3 })
    const addToS1 = await client.enqueue('AddSiteItem', { siteId: 's1', name: 'Nut' })
    const qtyOnS1 = await client.enqueue('SetItemQty', { itemId: 'Nut', qty: 2 })
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'Renamed' })
    const row = (id: number) => client.db.mutations.get(id)
    expect((await row(site.id))?.creates).toEqual([`Site/${tmp}`])
    expect((await row(add.id))?.creates).toEqual([`Site/${tmp}/items/Bolt`])
    expect((await row(add.id))?.dependsOn).toEqual([site.id])
    // The site and the item on it are both still local: the quantity update needs both.
    expect((await row(qty.id))?.dependsOn).toEqual([site.id, add.id])
    // On an existing site only the add is a dependency, and a rename of that site links to nothing.
    expect((await row(addToS1.id))?.dependsOn).toEqual([])
    expect((await row(qtyOnS1.id))?.dependsOn).toEqual([addToS1.id])
    expect((await row(rename.id))?.dependsOn).toEqual([])
  })

  it('holds back and drops the quantity update with the add it depends on', async () => {
    const client = createClient(server, { mutationHandlers: nestedHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const add = await client.enqueue('AddSiteItem', { siteId: 's1', name: 'bad' })
    const qty = await client.enqueue('SetItemQty', { itemId: 'bad', qty: 2 })
    const other = await client.enqueue('ArchiveSite', { id: 's2' })
    client.goOnline()
    await until(async () => (await client.db.mutations.get(other.id)) === undefined, 'unrelated mutation to sync')
    expect(await client.db.mutations.get(add.id)).toMatchObject({ status: 'failed', error: 'item rejected' })
    expect((await client.db.mutations.get(qty.id))?.status).toBe('pending')
    expect(server.mutations().map(c => c.op)).toEqual(['AddSiteItem', 'ArchiveSite'])
    await client.rollback(add.id)
    expect(await client.db.mutations.count()).toBe(0)
    expect((await sites(client.db).get('s1'))!.items ?? []).toEqual([])
  })

  it('deleting a row does not depend on what was added inside it, unless the row itself is new', async () => {
    const deleting = {
      ...(nestedHandlers as never as Record<string, object>),
      ArchiveSite: { apply: ({ db, variables }: Ctx<{ id: string }>) => sites(db).delete(variables.id) },
    } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: deleting })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const add = await client.enqueue('AddSiteItem', { siteId: 's1', name: 'bad' })
    const remove = await client.enqueue('ArchiveSite', { id: 's1' })
    const create = await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    const removeNew = await client.enqueue('ArchiveSite', { id: tmp })
    expect(remove.dependsOn).toEqual([])
    expect(removeNew.dependsOn).toEqual([create.id])

    // The add is rejected; the delete of the site it was on still goes out.
    await client.rollback(create.id)
    client.goOnline()
    await until(async () => (await client.db.mutations.get(remove.id)) === undefined, 'delete to sync')
    expect(await client.db.mutations.get(add.id)).toMatchObject({ status: 'failed', error: 'item rejected' })
    expect(server.mutations().map(c => c.op)).toEqual(['AddSiteItem', 'ArchiveSite'])
  })

  it('assigning a reference twice is not a chain', async () => {
    const owners = {
      RenameSite: { apply: ({ db, variables }: Ctx<{ id: string, name: string }>) => sites(db).update(variables.id, { owner: { id: variables.name, name: variables.name } } as never) },
    } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: owners })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const first = await client.enqueue('RenameSite', { id: 's1', name: 'bad' })
    const second = await client.enqueue('RenameSite', { id: 's1', name: 'ann' })
    expect(first.creates).toEqual([])
    expect(second.dependsOn).toEqual([])
    client.goOnline()
    await until(async () => (await client.db.mutations.get(second.id)) === undefined, 'second assignment to sync')
    expect((await client.db.mutations.get(first.id))?.status).toBe('failed')
  })

  it('links through a table of your own, by the row the add created', async () => {
    const joinHandlers = {
      ...siteHandlers,
      AddSiteItem: { apply: ({ db, variables }: Ctx<{ siteId: string, name: string }>) => db.table('siteItems').put({ siteId: variables.siteId, itemId: variables.name, qty: 0 }) },
      SetItemQty: { apply: ({ db, variables }: Ctx<{ itemId: string, qty: number }>) => db.table('siteItems').where('itemId').equals(variables.itemId).modify({ qty: variables.qty }) },
    } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: joinHandlers, stores: { stores: { siteItems: '[siteId+itemId], itemId' } } })
    await client.ready
    client.goOffline()
    const add = await client.enqueue('AddSiteItem', { siteId: 's1', name: 'Bolt' })
    const qty = await client.enqueue('SetItemQty', { itemId: 'Bolt', qty: 5 })
    expect((await client.db.mutations.get(add.id))?.creates).toEqual(['siteItems/["s1","Bolt"]'])
    expect((await client.db.mutations.get(qty.id))?.dependsOn).toEqual([add.id])
  })

  it('a failed chain does not stop a direct send, which drains the rest first', async () => {
    const client = chainClient()
    const { site, other } = await queueChain(client, 'bad')
    client.goOnline()
    await until(async () => (await client.db.mutations.get(site.id))?.status === 'failed', 'create to fail')
    await client.execute('RenameSite', { id: 's1', name: 'Direct' })
    expect(server.mutations().map(c => c.op)).toEqual(['CreateSite', 'ArchiveSite', 'RenameSite'])
    expect(await client.db.mutations.get(other.id)).toBeUndefined()
    expect(await client.db.mutations.count()).toBe(3)
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

  it('removes the row a rolled-back create made, after a rebase too', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const create = await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    await client.fetchQuery('GetSites', undefined) // rebase; the row is not in the response
    expect(await sites(client.db).get(tmp)).toMatchObject({ name: 'West' })
    await client.rollback(create.id)
    expect(await sites(client.db).get(tmp)).toBeUndefined()
  })

  it('keeps a pending edit undoable after a response that does not carry its row', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'Renamed' })
    await client.fetchQuery('GetSite', { id: 's2' }) // rebase around a response without s1
    expect((await cachedSites(client))[0]!.name).toBe('Renamed')
    await client.rollback(rename.id)
    expect((await cachedSites(client))[0]!.name).toBe('North')
  })

  it('rebases a pending edit onto the server value and restores that value on rollback', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'Renamed' })
    server.sites[0]!.name = 'North v2'
    await client.fetchQuery('GetSites', undefined)
    expect((await cachedSites(client))[0]!.name).toBe('Renamed')
    await client.rollback(rename.id)
    expect((await cachedSites(client))[0]!.name).toBe('North v2')
  })

  it('keeps the later mutations undoable after one before them is rolled back', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'Renamed' })
    const archive = await client.enqueue('ArchiveSite', { id: 's2' })

    // Replaying the archive on top of the restored data must not record its
    // own effect as the state to restore.
    await client.rollback(rename.id)
    await client.rollback(archive.id)
    expect(await cachedSites(client)).toMatchObject([{ name: 'North', archived: false }, { name: 'South', archived: false }])
    expect(await client.db.mutations.count()).toBe(0)
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
// Queue consistency: the undo logs must stay true to the tables
// ---------------------------------------------------------------------------

describe('queue consistency', () => {
  type Handlers = Record<string, object>

  it('records the key a table generates, so an insert can be taken back and rebased', async () => {
    const handlers = {
      ArchiveSite: {
        apply: async ({ db }: Ctx<{ id: string }>) => {
          await db.table('drafts').add({ body: 'in the row' })
          await db.table('notes').add({ body: 'beside the row' })
        },
      },
    } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: handlers, stores: { stores: { drafts: '++id', notes: '++' } } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const row = await client.enqueue('ArchiveSite', { id: 's1' })
    expect(row.keys).toEqual([['drafts', 1], ['notes', 1]])
    expect(row.creates).toEqual(['drafts/1', 'notes/1'])

    // A response is stored under the queue, which unwinds and re-applies the inserts.
    await client.fetchQuery('GetSites', undefined)
    expect(await client.db.table('drafts').count()).toBe(1)
    expect(await client.db.table('notes').count()).toBe(1)

    await client.rollback(row.id)
    expect(await client.db.table('drafts').count()).toBe(0)
    expect(await client.db.table('notes').count()).toBe(0)
  })

  it('keeps what a synced mutation did when an older failed one on the same row is unwound', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'bad' })
    const archive = await client.enqueue('ArchiveSite', { id: 's1' })
    client.goOnline()
    await until(async () => (await client.db.mutations.get(archive.id)) === undefined && (await client.db.mutations.get(rename.id))?.status === 'failed', 'archive synced, rename failed')
    expect(server.sites[0]).toMatchObject({ name: 'North', archived: true })
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'bad', archived: true })

    // A response that does not carry the row still rebases the failed rename.
    await client.fetchQuery('GetSite', { id: 's2' })
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'bad', archived: true })

    // Rolling the rename back restores what the server has, archive included.
    await client.rollback(rename.id)
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'North', archived: true })
  })

  it('does not bring cleared rows back from the undo logs after a cache bust', async () => {
    const dbName = `test-bust-${++n}`
    const one = createClient(server, { dbName, mutationHandlers: siteHandlers })
    await one.fetchQuery('GetSites', undefined)
    one.goOffline()
    await one.enqueue('RenameSite', { id: 's1', name: 'Local' })
    // Let the live pending list catch up, so nothing is mid-query when the "tab" closes.
    await until(() => one.state.pending.length === 1, 'pending list')
    one.db.close()

    cutNetworkFor('RenameSite') // keep the rename queued in the next session
    const two = createClient(server, { dbName, documentsHash: 'h2', mutationHandlers: siteHandlers })
    await two.ready
    expect(await cachedSites(two)).toEqual([])
    await two.fetchQuery('GetSite', { id: 's2' })
    expect((await cachedSites(two)).map(s => s.id)).toEqual(['s2'])

    // The pending rename shows again once its row is back, and can still be undone.
    await two.fetchQuery('GetSites', undefined)
    expect((await cachedSites(two))[0]).toMatchObject({ id: 's1', name: 'Local' })
    await two.rollback((await two.db.mutations.toArray())[0]!.id)
    expect((await cachedSites(two))[0]).toMatchObject({ id: 's1', name: 'North' })
  })

  /** Notes in a table of the app's own, created under a placeholder and edited before the create syncs. */
  const noteHandlers = (reconcile: object) => ({
    CreateSite: {
      apply: ({ db, variables, tempId }: Ctx<{ name: string }> & { tempId: () => string }) => db.table('notes').put({ id: tempId(), body: variables.name }),
      reconcile,
    },
    RenameSite: { apply: ({ db, variables }: Ctx<{ id: string, name: string }>) => db.table('notes').update(variables.id, { body: variables.name }) },
  }) as unknown as MutationHandlers
  type Reconcile = { db: AirplaneDexie, tempIds: string[], resolve: (t: string, id: string) => Promise<void> }

  it.each([
    ['resolve alone', ({ tempIds, resolve }: Reconcile, result: { createSite: Site }) => resolve(tempIds[0]!, result.createSite.id)],
    ['a reconcile that moves the row itself', async ({ db, tempIds, resolve }: Reconcile, result: { createSite: Site }) => {
      const row = await db.table('notes').get(tempIds[0]!)
      await db.table('notes').delete(tempIds[0]!)
      await db.table('notes').put({ ...row, id: result.createSite.id })
      await resolve(tempIds[0]!, result.createSite.id)
    }],
  ])('re-keys a placeholder row in a table of your own, and its undo logs: %s', async (_, reconcile) => {
    const client = createClient(server, { mutationHandlers: noteHandlers(reconcile), stores: { stores: { notes: 'id' } } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'first' })
    const tmp = (await client.db.table('notes').toArray())[0].id as string
    const edit = await client.enqueue('RenameSite', { id: tmp, name: 'edited' })

    // The create is accepted; the edit stays queued behind a network error.
    cutNetworkFor('RenameSite')
    client.goOnline()
    await until(() => client.state.lastError !== null, 'network error')
    // A sync asked for during that run follows it at once, and a mutation being sent cannot be rolled back: wait it out.
    await client.sync()
    expect(await client.db.table('notes').toArray()).toEqual([{ id: 's3', body: 'edited' }])

    // A rebase must not put a row back under the placeholder.
    await client.fetchQuery('GetSites', undefined)
    expect(await client.db.table('notes').toArray()).toEqual([{ id: 's3', body: 'edited' }])
    await client.rollback(edit.id)
    expect(await client.db.table('notes').toArray()).toEqual([{ id: 's3', body: 'first' }])
  })

  it('stores a response even when a queued mutation cannot be applied on it', async () => {
    const picky = {
      RenameSite: {
        apply: async ({ db, variables }: Ctx<{ id: string, name: string }>) => {
          const row = await sites(db).get(variables.id)
          await sites(db).update(variables.id, { archived: true }) // written before the throw: must be taken back
          if (row?.name === 'Server') throw new Error('cannot rename this')
          await sites(db).update(variables.id, { name: variables.name })
        },
      },
    } as unknown as MutationHandlers
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = createClient(server, { mutationHandlers: picky })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'Local' })
    expect((await cachedSites(client))[0]).toMatchObject({ name: 'Local', archived: true })

    server.sites[0]!.name = 'Server'
    server.sites[1]!.name = 'South 2'
    await client.fetchQuery('GetSites', undefined)
    expect(await cachedSites(client)).toMatchObject([{ name: 'Server', archived: false }, { name: 'South 2' }])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('could not be applied again'), expect.any(Error))
    expect(await client.db.mutations.count()).toBe(1)

    // Once the data lets it through, the change is back and can be undone.
    server.sites[0]!.name = 'North'
    await client.fetchQuery('GetSites', undefined)
    expect((await cachedSites(client))[0]).toMatchObject({ name: 'Local', archived: true })
    await client.rollback((await client.db.mutations.toArray())[0]!.id)
    expect((await cachedSites(client))[0]).toMatchObject({ name: 'North', archived: false })
  })

  it('survives a re-apply that fails inside the database', async () => {
    const adder = {
      ArchiveSite: { apply: ({ db }: Ctx<{ id: string }>) => sites(db).add({ id: 's9', name: 'Mine', archived: false }) },
    } as unknown as MutationHandlers
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = createClient(server, { mutationHandlers: adder })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('ArchiveSite', { id: 's1' })
    expect(await sites(client.db).get('s9')).toMatchObject({ name: 'Mine' })

    // The server now has a row under that key: adding it again is a constraint error.
    server.sites.push({ id: 's9', name: 'Theirs', archived: false })
    await client.fetchQuery('GetSites', undefined)
    expect(await sites(client.db).get('s9')).toMatchObject({ name: 'Theirs' })
    expect((await cachedSites(client)).map(s => s.id)).toEqual(['s1', 's2', 's9'])
  })

  it('puts the queue back when a store handler leaves the transaction', async () => {
    const slow = {
      ...(siteQueries as never as Handlers),
      GetSite: {
        store: async ({ db }: { db: AirplaneDexie }, data: { site: Site }) => {
          await sites(db).put(data.site)
          await new Promise(r => setTimeout(r, 5)) // not a Dexie operation: the transaction commits here
        },
      },
    } as unknown as QueryHandlers
    const client = createClient(server, { queryHandlers: slow, mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'Local' })

    await expect(client.fetchQuery('GetSite', { id: 's2' })).rejects.toThrow()
    expect((await cachedSites(client))[0]!.name).toBe('Local')
    await client.rollback(rename.id)
    expect((await cachedSites(client))[0]!.name).toBe('North')
  })

  it('takes back a clear() of a table whose keys live beside the rows', async () => {
    const clearing = { ArchiveSite: { apply: ({ db }: Ctx<{ id: string }>) => db.table('kv').clear() } } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: clearing, stores: { stores: { kv: '' } } })
    await client.ready
    await client.db.table('kv').bulkPut([{ v: 1 }, { v: 2 }], ['a', 'b'])
    client.goOffline()
    const row = await client.enqueue('ArchiveSite', { id: 's1' })
    expect(await client.db.table('kv').count()).toBe(0)
    await client.rollback(row.id)
    expect(await client.db.table('kv').toArray()).toEqual([{ v: 1 }, { v: 2 }])
  })

  it('does not send a mutation rolled back while the batch was in flight', async () => {
    // One at a time, so the create is still waiting when the archive is on its way.
    const client = createClient(server, { mutationHandlers: createHandlers, request: { concurrency: 1 } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('ArchiveSite', { id: 's2' })
    const create = await client.enqueue('CreateSite', { name: 'West' })
    const impl = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url, init) => {
      if ((init!.body as string).includes('mutation ArchiveSite')) await client.rollback(create.id)
      return impl(url, init)
    })
    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => c.op)).toEqual(['ArchiveSite'])
  })

  it('does not send a mutation again because its reconcile threw', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const throwing = { ArchiveSite: { reconcile: () => Promise.reject(new Error('handler bug')) } } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: throwing })
    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    await client.sync()
    expect(server.mutations().map(c => c.op)).toEqual(['ArchiveSite'])
    expect(client.state.lastError).toBe('handler bug')
  })

  it('does not redirect a server id when a create reaches the server twice', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const create = await client.enqueue('CreateSite', { name: 'West' })
    const tmp = create.tempIds![0]!
    // The first send resolved the placeholder, then the tab closed before the row was removed.
    await client.db.meta.put({ key: 'tempIds', value: JSON.stringify({ [tmp]: 's3' }) })
    await client.db.mutations.update(create.id, { tempIds: ['s3'] })
    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(JSON.parse((await client.db.meta.get('tempIds'))!.value)).toEqual({ [tmp]: 's3' })
  })

  it('queues a variable named like an object member, and drops a mutation whose apply left the transaction', async () => {
    const leaving = {
      ...(siteHandlers as never as Handlers),
      ArchiveSite: { apply: async ({ db, variables }: Ctx<{ id: string }>) => {
        await sites(db).update(variables.id, { archived: true })
        await new Promise(r => setTimeout(r, 5))
        await sites(db).update(variables.id, { name: 'late' })
      } },
    } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: leaving })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    expect((await client.enqueue('RenameSite', { id: 's1', name: 'constructor' })).variables).toEqual({ id: 's1', name: 'constructor' })
    await expect(client.enqueue('ArchiveSite', { id: 's2' })).rejects.toThrow()
    expect((await client.db.mutations.toArray()).map(m => m.document)).toEqual(['RenameSite'])
  })

  it('undoes only what a mutation changed, leaving other writes to the row alone', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'Local' })
    // The app's own write to another field of the same row, outside any mutation.
    await sites(client.db).update('s1', { note: 'mine' } as never)

    await client.fetchQuery('GetSite', { id: 's2' }) // a rebase that does not carry s1
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'Local', note: 'mine' })
    await client.rollback(rename.id)
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'North', note: 'mine' })
  })

  it('sends two edits of the same field in the order they were made', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const first = await client.enqueue('RenameSite', { id: 's1', name: 'bad' })
    const second = await client.enqueue('RenameSite', { id: 's1', name: 'Second' })
    const archive = await client.enqueue('ArchiveSite', { id: 's1' })
    expect(second).toMatchObject({ dependsOn: [], after: [first.id] })
    expect(archive).toMatchObject({ dependsOn: [], after: [] })

    client.goOnline()
    await until(async () => (await client.db.mutations.get(archive.id)) === undefined, 'archive to sync')
    // The second rename waits behind the rejected first; the archive did not.
    expect((await client.db.mutations.get(first.id))?.status).toBe('failed')
    expect((await client.db.mutations.get(second.id))?.status).toBe('pending')
    await until(() => client.state.blocked === 1, 'blocked count')
    expect(server.sites[0]).toMatchObject({ name: 'North', archived: true })

    // Order only: rolling the first back leaves the second, which then goes out.
    expect((await client.rollback(first.id)).map(m => m.id)).toEqual([first.id])
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[0]).toMatchObject({ name: 'Second', archived: true })
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'Second', archived: true })
  })

  it('keeps a dependent that still does something when what it depended on is rolled back', async () => {
    // An upsert: the second save of a new row works with or without the first.
    const saving = {
      CreateSite: { apply: ({ db, variables }: Ctx<{ name: string }>) => sites(db).put({ id: 'n1', name: variables.name, archived: false }) },
    } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: saving })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const first = await client.enqueue('CreateSite', { name: 'bad' })
    const fixed = await client.enqueue('CreateSite', { name: 'Fine' })
    expect(fixed.dependsOn).toEqual([first.id])
    expect(client.dependents(first.id)).toEqual([])
    await until(() => client.state.pending.length === 2, 'pending list')
    expect(client.dependents(first.id).map(m => m.id)).toEqual([fixed.id])

    expect((await client.rollback(first.id)).map(m => m.id)).toEqual([first.id])
    expect(await client.db.mutations.get(fixed.id)).toMatchObject({ dependsOn: [], creates: ['Site/n1'] })
    expect(await sites(client.db).get('n1')).toMatchObject({ name: 'Fine' })
    await client.rollback(fixed.id)
    expect(await sites(client.db).get('n1')).toBeUndefined()
  })

  it('stops the sync on an answer about the session, not the mutation', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers, request: { concurrency: 1 } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    for (const id of ['s1', 's2', 's2']) await client.enqueue('ArchiveSite', { id })
    await client.sync() // let the runs those kicked off finish, so one run is what gets counted
    const impl = server.fetch.getMockImplementation()!
    let expired = true
    server.fetch.mockImplementation(async (url, init) => {
      if (!expired) return impl(url, init)
      server.calls.push({ op: 'ArchiveSite', variables: undefined, headers: new Headers() })
      return Response.json({ errors: [{ message: 'token expired', extensions: { code: 'UNAUTHENTICATED' } }] }, { status: 401 })
    })
    client.goOnline()
    await until(() => client.state.lastError !== null, 'sync to stop')
    expect(client.state.lastError).toBe('token expired')
    expect(server.mutations()).toHaveLength(1)
    expect((await client.db.mutations.toArray()).map(m => m.status)).toEqual(['pending', 'pending', 'pending'])

    expired = false
    await client.sync()
    expect(await client.db.mutations.count()).toBe(0)
  })

  it('lets the app say which answers are about the session', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers, request: { retryLater: error => error.message === 'name rejected' } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'bad' })
    client.goOnline()
    await until(() => client.state.lastError !== null, 'sync to stop')
    expect((await client.db.mutations.get(rename.id))?.status).toBe('pending')
  })

  it('keeps the queue in creation order when the clock steps back', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const now = vi.spyOn(Date, 'now')
    now.mockReturnValue(2_000)
    const first = await client.enqueue('RenameSite', { id: 's1', name: 'One' })
    now.mockReturnValue(1_000)
    const second = await client.enqueue('RenameSite', { id: 's1', name: 'Two' })
    now.mockRestore()
    expect((await client.db.mutations.orderBy('createdAt').toArray()).map(m => m.id)).toEqual([first.id, second.id])
  })
})

// ---------------------------------------------------------------------------
// Two layers: what each operation costs
// ---------------------------------------------------------------------------

describe('two layers', () => {
  /** Site handlers that count how often each mutation's apply runs. */
  function counting() {
    const applied: string[] = []
    const handlers = {
      RenameSite: { apply: ({ db, variables }: Ctx<{ id: string, name: string }>) => (applied.push(`rename ${variables.id}`), sites(db).update(variables.id, { name: variables.name })) },
      ArchiveSite: { apply: ({ db, variables }: Ctx<{ id: string }>) => (applied.push(`archive ${variables.id}`), sites(db).update(variables.id, { archived: true })) },
    } as unknown as MutationHandlers
    return { applied, handlers }
  }

  it('keeps the server version of a row only while the queue changes it', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    expect(await client.db.base.count()).toBe(0)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'Local' })
    await client.enqueue('ArchiveSite', { id: 's1' })
    expect(await client.db.base.toArray()).toEqual([{ table: 'Site', key: 's1', row: { id: 's1', name: 'North', archived: false } }])
    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(await client.db.base.count()).toBe(0)
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'Local', archived: true })
  })

  it('queues a mutation without applying the others again', async () => {
    const { applied, handlers } = counting()
    const client = createClient(server, { mutationHandlers: handlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    await client.enqueue('RenameSite', { id: 's2', name: 'B' })
    await client.enqueue('ArchiveSite', { id: 's1' })
    expect(applied).toEqual(['rename s1', 'rename s2', 'archive s1'])
  })

  it('stores a response that touches no pending row without applying anything again', async () => {
    const { applied, handlers } = counting()
    const client = createClient(server, { mutationHandlers: handlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'Local' })
    applied.length = 0

    server.sites[1]!.name = 'South 2'
    await client.fetchQuery('GetSite', { id: 's2' })
    expect(applied).toEqual([])
    expect(await sites(client.db).get('s2')).toMatchObject({ name: 'South 2' })

    // A response that carries the pending row goes under the queue.
    server.sites[0]!.archived = true
    await client.fetchQuery('GetSite', { id: 's1' })
    expect(applied).toEqual(['rename s1'])
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'Local', archived: true })
    expect(await client.db.base.toArray()).toMatchObject([{ key: 's1', row: { name: 'North', archived: true } }])
  })

  it('acknowledges and rolls back a mutation on its own rows without touching the rest', async () => {
    const { applied, handlers } = counting()
    const client = createClient(server, { mutationHandlers: handlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const one = await client.enqueue('RenameSite', { id: 's1', name: 'One' })
    const two = await client.enqueue('RenameSite', { id: 's2', name: 'bad' })
    applied.length = 0

    await client.rollback(one.id)
    expect(applied).toEqual([])
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'North' })

    const three = await client.enqueue('ArchiveSite', { id: 's1' })
    applied.length = 0
    client.goOnline()
    await until(async () => (await client.db.mutations.get(three.id)) === undefined, 'archive to sync')
    expect(applied).toEqual([])
    expect((await client.db.mutations.get(two.id))?.status).toBe('failed')
    expect(await client.db.base.toArray()).toMatchObject([{ key: 's2', row: { name: 'South' } }])
  })

  it('rolls back correctly while a later mutation on the same row is in flight', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'bad' })
    await client.enqueue('ArchiveSite', { id: 's2' })
    client.goOnline()
    await until(async () => (await client.db.mutations.get(rename.id))?.status === 'failed', 'rename to fail')
    await until(async () => (await client.db.mutations.count()) === 1, 'the rest to sync')
    client.goOffline()
    const archive = await client.enqueue('ArchiveSite', { id: 's1' })
    const impl = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url, init) => {
      if ((init!.body as string).includes('mutation ArchiveSite')) await client.rollback(rename.id)
      return impl(url, init)
    })
    client.goOnline()
    await until(async () => (await client.db.mutations.get(archive.id)) === undefined, 'archive to sync')
    expect(await sites(client.db).get('s1')).toMatchObject({ name: 'North', archived: true })
    expect(await client.db.base.count()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Inferred tables
// ---------------------------------------------------------------------------

describe('merging queued edits', () => {
  /** Two renames of the same site are one rename to the later name. */
  const merging = {
    ...siteHandlers,
    RenameSite: {
      ...(siteHandlers as Record<string, object>).RenameSite,
      merge: (a: { id: string }, b: { id: string }) => (a.id === b.id ? b : null),
    },
  } as unknown as MutationHandlers

  it('folds a later edit of the same thing into the one still waiting', async () => {
    const client = createClient(server, { mutationHandlers: merging })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const first = await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    const other = await client.enqueue('RenameSite', { id: 's2', name: 'Other' })
    const second = await client.enqueue('RenameSite', { id: 's1', name: 'B' })
    const third = await client.enqueue('RenameSite', { id: 's1', name: 'C' })

    expect(second.id).toBe(first.id)
    expect(third).toMatchObject({ id: first.id, variables: { id: 's1', name: 'C' }, description: 'Rename s1 to C' })
    expect((await client.db.mutations.toArray()).map(m => m.id)).toEqual([first.id, other.id])
    expect((await sites(client.db).get('s1'))?.name).toBe('C')

    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => c.variables)).toEqual(expect.arrayContaining([{ id: 's1', name: 'C' }, { id: 's2', name: 'Other' }]))
    expect(server.mutations()).toHaveLength(2)
    expect(await client.db.base.count()).toBe(0)
  })

  it('finds the edit to fold into behind a long queue of other things, and links by what was created', async () => {
    const client = createClient(server, { mutationHandlers: { ...createHandlers, RenameSite: (merging as Record<string, object>).RenameSite } as unknown as MutationHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const first = await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    const created = await client.enqueue('CreateSite', { name: 'New' })
    for (let n = 0; n < 60; n++) await client.enqueue('CreateSite', { name: `Filler ${n}` })
    const tmp = (await sites(client.db).toArray()).find(s => s.name === 'New')!.id
    const edit = await client.enqueue('RenameSite', { id: tmp, name: 'Newer' })
    const again = await client.enqueue('RenameSite', { id: 's1', name: 'B' })

    // The rename of s1 folds into the first one, 62 rows back; the edit of the new site depends on its create alone.
    expect(again).toMatchObject({ id: first.id, variables: { id: 's1', name: 'B' } })
    expect((await client.db.mutations.get(edit.id))!.dependsOn).toEqual([created.id])
    expect(await client.db.mutations.count()).toBe(63)
    // What the indexes are built from is kept with the rows a mutation changed.
    expect(await client.db.mutations.get(first.id)).toMatchObject({ keys: [['Site', 's1']], rows: [expect.stringContaining('s1')], unkeyed: 0 })
  })

  it('queues mutations in the order they were called, and a failed one takes no other with it', async () => {
    const handlers = {
      ...createHandlers,
      // Slow to describe: without an order kept, the rename below would be applied first.
      CreateSite: { ...(createHandlers as Record<string, object>).CreateSite, describe: async ({ db }: Ctx<unknown>) => `Create site ${(await sites(db).count()) + (await sites(db).count())}` },
      RenameSite: {
        apply: async ({ db, variables }: Ctx<{ id: string, name: string }>) => {
          if (!await sites(db).where('name').equals('New').count() && variables.name === 'needs New') throw new Error('nothing to rename yet')
          await sites(db).update(variables.id, { name: variables.name })
        },
      },
    } as unknown as MutationHandlers
    const client = createClient(server, { mutationHandlers: handlers, stores: { stores: { Site: 'name' } } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    // Not awaited one by one, as a click handler would fire them.
    const throws = client.enqueue('RenameSite', { id: 's1', name: 'needs New' })
    const create = client.enqueue('CreateSite', { name: 'New' })
    const rename = client.enqueue('RenameSite', { id: 's2', name: 'needs New' })
    await expect(throws).rejects.toThrow('nothing to rename yet')
    await Promise.all([create, rename])
    expect((await client.db.mutations.orderBy('createdAt').toArray()).map(m => m.document)).toEqual(['CreateSite', 'RenameSite'])
  })

  it('puts the row back as the server has it when a merged edit is rolled back', async () => {
    const client = createClient(server, { mutationHandlers: merging })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    const merged = await client.enqueue('RenameSite', { id: 's1', name: 'B' })
    await client.rollback(merged.id)
    expect((await sites(client.db).get('s1'))?.name).toBe('North')
    expect(await client.db.mutations.count()).toBe(0)
  })

  it('keeps them apart when something queued in between changed the same row', async () => {
    const client = createClient(server, { mutationHandlers: merging })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    await client.enqueue('ArchiveSite', { id: 's1' })
    await client.enqueue('RenameSite', { id: 's1', name: 'B' })
    expect((await client.db.mutations.toArray()).map(m => m.document)).toEqual(['RenameSite', 'ArchiveSite', 'RenameSite'])
  })

  it('never changes a mutation the server may already have seen', async () => {
    const client = createClient(server, { mutationHandlers: merging })
    await client.fetchQuery('GetSites', undefined)
    const restore = cutNetworkFor('RenameSite')
    const first = await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    await until(() => client.state.lastError !== null, 'the send to fail')
    expect((await client.db.mutations.get(first.id))?.attempts).toBe(1)
    const second = await client.enqueue('RenameSite', { id: 's1', name: 'B' })
    expect(second.id).not.toBe(first.id)
    restore()
    await client.sync()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[0]!.name).toBe('B')
  })

  it('leaves mutations alone without a merge handler', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    await client.enqueue('RenameSite', { id: 's1', name: 'B' })
    expect(await client.db.mutations.count()).toBe(2)
  })
})

describe('sending side by side', () => {
  /** Holds every mutation at the server until released, and counts how many are there at once. */
  function gate() {
    const impl = server.fetch.getMockImplementation()!
    let inside = 0
    let most = 0
    const order: string[] = []
    const releases: (() => void)[] = []
    server.fetch.mockImplementation(async (url, init) => {
      const body = init!.body as string
      if (!body.includes('mutation ')) return impl(url, init)
      order.push(JSON.stringify((JSON.parse(body) as { variables: unknown }).variables))
      most = Math.max(most, ++inside)
      await new Promise<void>(resolve => releases.push(resolve))
      inside--
      return impl(url, init)
    })
    return { most: () => most, inside: () => inside, order, release: () => releases.splice(0).forEach(r => r()) }
  }

  async function drain(client: AirplaneClient, g: ReturnType<typeof gate>) {
    await until(async () => {
      g.release()
      return (await client.db.mutations.count()) === 0
    }, 'outbox to drain')
  }

  it('sends mutations that have nothing to do with each other at once', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('ArchiveSite', { id: 's1' })
    await client.enqueue('ArchiveSite', { id: 's2' })
    const g = gate()
    client.goOnline()
    await until(() => g.inside() === 2, 'both to be in flight')
    await drain(client, g)
    expect(server.sites.map(s => s.archived)).toEqual([true, true])
  })

  it('keeps edits of one row, and a chain, in order', async () => {
    const client = createClient(server, { mutationHandlers: chainHandlers, entities: CHAIN_ENTITIES })
    await queueChain(client)
    await client.enqueue('RenameSite', { id: 's2', name: 'Later' })
    const g = gate()
    client.goOnline()
    // The create heads its chain and the archive of s2 its own: two in flight, the rest waiting on them.
    await until(() => g.inside() === 2, 'the two heads to be in flight')
    await new Promise(r => setTimeout(r, 30))
    expect(g.order).toHaveLength(2)
    await drain(client, g)
    expect(g.most()).toBe(2)
    expect(server.mutations().map(c => c.op).filter(op => op !== 'ArchiveSite' && op !== 'RenameSite')).toEqual(['CreateSite', 'AddSiteItem', 'SetItemQty'])
    expect(server.sites[1]).toMatchObject({ archived: true, name: 'Later' })
  })

  it('never has more in flight than `concurrency`', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers, request: { concurrency: 2 } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    for (const name of ['a', 'b', 'c', 'd', 'e']) await client.enqueue('CreateSite', { name })
    const g = gate()
    client.goOnline()
    await drain(client, g)
    expect(g.most()).toBe(2)
    expect(server.sites).toHaveLength(7)
  })

  it('sends mutations it knows nothing about one at a time', async () => {
    // No `apply`: what they touch is unknown, so their order is all there is to go on.
    const client = createClient(server)
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('ArchiveSite', { id: 's1' })
    await client.enqueue('RenameSite', { id: 's2', name: 'X' })
    await client.enqueue('ArchiveSite', { id: 's2' })
    const g = gate()
    client.goOnline()
    await drain(client, g)
    expect(g.most()).toBe(1)
    expect(server.mutations().map(c => c.op)).toEqual(['ArchiveSite', 'RenameSite', 'ArchiveSite'])
  })

  it('lets what is in flight land and starts nothing more once the network fails', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers, request: { concurrency: 2 } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('ArchiveSite', { id: 's1' })
    for (const name of ['a', 'b', 'c']) await client.enqueue('CreateSite', { name })
    const restore = cutNetworkFor('ArchiveSite')
    client.goOnline()
    await until(() => client.state.lastError !== null && !client.state.syncing, 'sync to stop')
    expect(server.mutations().length).toBeLessThanOrEqual(2)
    expect((await client.db.mutations.toArray()).every(m => m.status === 'pending')).toBe(true)
    expect(client.state.retryAt).toBeGreaterThan(Date.now())
    restore()
    await client.sync()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(client.state.retryAt).toBeNull()
    expect(server.sites).toHaveLength(5)
  })
})

describe('retries', () => {
  it('sends the same idempotency key on every attempt, a different one per mutation', async () => {
    const seen: { op: string, key?: string, header: string | null }[] = []
    const impl = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url, init) => {
      const body = JSON.parse(init!.body as string) as { query: string, extensions?: { idempotencyKey?: string } }
      if (body.query.startsWith('mutation')) seen.push({ op: /mutation (\w+)/.exec(body.query)![1]!, key: body.extensions?.idempotencyKey, header: new Headers(init!.headers).get('idempotency-key') })
      return impl(url, init)
    })
    const client = createClient(server, {
      mutationHandlers: siteHandlers,
      request: { concurrency: 1, headers: (ctx: AirplaneRequestContext) => (ctx.idempotencyKey ? { 'Idempotency-Key': ctx.idempotencyKey } : undefined) },
    })
    await client.fetchQuery('GetSites', undefined)
    const restore = cutNetworkFor('ArchiveSite')
    client.goOffline()
    const row = await client.enqueue('ArchiveSite', { id: 's1' })
    await client.enqueue('RenameSite', { id: 's2', name: 'X' })
    client.goOnline()
    await until(() => client.state.lastError !== null && !client.state.syncing, 'sync to stop')
    restore()
    await client.sync()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')

    expect(row.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    const archive = seen.filter(c => c.op === 'ArchiveSite')
    expect(archive.map(c => c.key)).toEqual([row.idempotencyKey])
    expect(archive[0]!.header).toBe(row.idempotencyKey)
    const rename = seen.find(c => c.op === 'RenameSite')!
    expect(rename.key).toBeTruthy()
    expect(rename.key).not.toBe(row.idempotencyKey)
  })

  it('keeps the key next to the persisted query hash', async () => {
    const bodies: { extensions?: Record<string, unknown> }[] = []
    const client = createClient(server, { documents: hashedDocuments, persistedQueries: 'automatic', mutationHandlers: siteHandlers })
    const sent = withApq()
    const impl = server.fetch.getMockImplementation()!
    server.fetch.mockImplementation(async (url, init) => {
      bodies.push(JSON.parse(init!.body as string) as { extensions?: Record<string, unknown> })
      return impl(url, init)
    })
    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(sent.length).toBe(2)
    for (const body of bodies) expect(body.extensions?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)
    expect(bodies[0]!.extensions?.persistedQuery).toBeTruthy()
    expect(server.sites[0]!.archived).toBe(true)
  })

  it('tries again on its own when the server says when', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    const impl = server.fetch.getMockImplementation()!
    let busy = 1
    server.fetch.mockImplementation(async (url, init) => {
      if (busy-- > 0 && (init!.body as string).includes('mutation ')) return new Response('busy', { status: 503, headers: { 'Retry-After': '0' } })
      return impl(url, init)
    })
    await client.enqueue('ArchiveSite', { id: 's1' })
    // Nobody calls sync again: the retry is the module's.
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites[0]!.archived).toBe(true)
    expect(client.state.retryAt).toBeNull()
  })

  it('waits longer each time, within bounds, and takes the server at its word', () => {
    expect(backoffDelay(0, undefined, 0)).toBe(500)
    expect(backoffDelay(0, undefined, 1)).toBe(1000)
    expect(backoffDelay(3, undefined, 1)).toBe(8000)
    expect(backoffDelay(30, undefined, 1)).toBe(5 * 60_000)
    expect(backoffDelay(5, 2500)).toBe(2500)
    expect(backoffDelay(0, 24 * 60 * 60_000)).toBe(60 * 60_000)
    expect(parseRetryAfter('120')).toBe(120_000)
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:10 GMT', Date.parse('Wed, 21 Oct 2015 07:28:00 GMT'))).toBe(10_000)
    expect(parseRetryAfter('Wed, 21 Oct 2015 07:28:00 GMT', Date.parse('Wed, 21 Oct 2015 07:29:00 GMT'))).toBe(0)
    expect(parseRetryAfter('soon')).toBeUndefined()
    expect(parseRetryAfter(null)).toBeUndefined()
  })
})

describe('refetching after a sync', () => {
  const ITEM_ENTITIES = { Site: { key: 'id' }, Item: { key: 'id' } }
  const queries = {
    ...siteQueries,
    SearchItems: {
      store: ({ db }: { db: AirplaneDexie }, data: { searchItems: { edges: { node: { id: string } }[] } }) => db.table('Item').bulkPut(data.searchItems.edges.map(e => e.node)),
      read: async ({ db }: { db: AirplaneDexie }) => ({ searchItems: await db.table('Item').toArray() }),
    },
  } as unknown as QueryHandlers

  function mount(client: AirplaneClient, name: string, variables?: unknown) {
    const refresh = vi.fn(async () => void await client.fetchQuery(name, variables))
    client.mount(queryKey(name, variables), refresh)
    return refresh
  }

  it('asks again only the queries that fill a table the mutation changed', async () => {
    const client = createClient(server, { entities: ITEM_ENTITIES, queryHandlers: queries, mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    await client.fetchQuery('SearchItems', undefined)
    const sitesQuery = mount(client, 'GetSites')
    const itemsQuery = mount(client, 'SearchItems')
    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(() => sitesQuery.mock.calls.length > 0, 'the sites to be refetched')
    await client.sync()
    expect(sitesQuery).toHaveBeenCalledTimes(1)
    expect(itemsQuery).not.toHaveBeenCalled()
  })

  it('asks again a query that has not shown which tables it fills', async () => {
    const client = createClient(server, { entities: ITEM_ENTITIES, queryHandlers: queries, mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    const itemsQuery = mount(client, 'SearchItems')
    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(() => itemsQuery.mock.calls.length > 0, 'the unknown query to be refetched')
  })

  it('asks again every query after a mutation it knows nothing about', async () => {
    const client = createClient(server, { entities: ITEM_ENTITIES, queryHandlers: queries })
    await client.fetchQuery('GetSites', undefined)
    await client.fetchQuery('SearchItems', undefined)
    const itemsQuery = mount(client, 'SearchItems')
    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(() => itemsQuery.mock.calls.length > 0, 'every query to be refetched')
  })

  it('shares one request between callers asking for the same query at once', async () => {
    const client = createClient(server)
    const [a, b] = await Promise.all([client.fetchQuery('GetSites', undefined), client.fetchQuery('GetSites', {}), client.fetchQuery('GetSite', { id: 's1' })])
    expect(a).toBe(b)
    expect(server.calls.map(c => c.op).sort()).toEqual(['GetSite', 'GetSites'])
    await client.fetchQuery('GetSites', undefined)
    expect(server.calls.filter(c => c.op === 'GetSites')).toHaveLength(2)
  })

  it('does not hand a fetch that left before a mutation was accepted to a caller after it', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    const impl = server.fetch.getMockImplementation()!
    let release!: () => void
    const held = new Promise<void>(resolve => (release = resolve))
    let first = true
    server.fetch.mockImplementation(async (url, init) => {
      if (first && (init!.body as string).includes('query GetSites')) {
        first = false
        const stale = await impl(url, init)
        await held
        return stale
      }
      return impl(url, init)
    })
    const slow = client.fetchQuery<{ sites: Site[] }>('GetSites', undefined)
    await client.enqueue('ArchiveSite', { id: 's1' })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    const fresh = await client.fetchQuery<{ sites: Site[] }>('GetSites', undefined)
    expect(fresh.sites[0]!.archived).toBe(true)
    release()
    expect((await slow).sites[0]!.archived).toBe(false)
  })
})

describe('room', () => {
  it('drops the least recently fetched rows, and their record, when asked', async () => {
    const client = createClient(server)
    for (const id of ['s1', 's2']) {
      await client.fetchQuery('GetSite', { id })
      await new Promise(r => setTimeout(r, 2))
    }
    expect(await client.evict()).toBe(1)
    expect((await cachedSites(client)).map(s => s.id)).toEqual(['s2'])
    expect((await client.db.queries.toArray()).map(q => q.variables)).toEqual([{ id: 's2' }])
  })

  it('keeps rows a mounted query, a newer record or the queue holds', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSite', { id: 's1' })
    await new Promise(r => setTimeout(r, 2))
    await client.fetchQuery('GetSite', { id: 's2' })
    await new Promise(r => setTimeout(r, 2))
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'Mine' })

    // Mounted: its record is not a candidate at all.
    client.mount(queryKey('GetSite', { id: 's1' }), async () => {})
    expect(await client.evict()).toBe(0)
    // The oldest record that is left goes, but GetSites still lists its row.
    expect((await client.db.queries.toArray()).map(q => q.document).sort()).toEqual(['GetSite', 'GetSites'])
    expect(await sites(client.db).count()).toBe(2)

    client.active.clear()
    while ((await client.db.queries.count()) > 0) await client.evict()
    // Every record is gone. The row the queue changed is not.
    expect(await cachedSites(client)).toMatchObject([{ id: 's1', name: 'Mine' }])
    await client.rollback((await client.db.mutations.toArray())[0]!.id)
    expect(await cachedSites(client)).toMatchObject([{ id: 's1', name: 'North' }])
  })

  it('makes room and tries once more when the browser refuses a write', async () => {
    let refuse = 1
    const client = createClient(server, {
      queryHandlers: {
        ...siteQueries,
        GetSites: {
          ...(siteQueries as Record<string, object>).GetSites,
          store: ({ db }: { db: AirplaneDexie }, data: { sites: Site[] }) => {
            if (refuse-- > 0) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' })
            return sites(db).bulkPut(data.sites)
          },
        },
      } as unknown as QueryHandlers,
    })
    await client.fetchQuery('GetSite', { id: 's2' })
    await client.fetchQuery('GetSites', undefined)
    expect((await cachedSites(client)).map(s => s.id)).toEqual(['s1', 's2'])
    expect((await client.db.queries.toArray()).map(q => q.document)).toEqual(['GetSites'])
  })

  it('fails the write when there is nothing left to drop', async () => {
    const client = createClient(server, {
      queryHandlers: { GetSites: { store: () => { throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }) }, read: () => null } } as unknown as QueryHandlers,
    })
    await expect(client.fetchQuery('GetSites', undefined)).rejects.toThrow('full')
  })

  it('writes a large response a chunk at a time and still knows every row', async () => {
    const many = Array.from({ length: 1234 }, (_, i) => ({ id: `m${String(i).padStart(4, '0')}`, name: `Site ${i}`, archived: false }))
    const client = createClient(server, {
      mutationHandlers: {
        ...siteHandlers,
        CreateSite: { apply: ({ db }: Ctx<unknown>) => sites(db).bulkPut(many.map(s => ({ ...s, name: 'Changed' }))) },
      } as unknown as MutationHandlers,
    })
    server.fetch.mockImplementationOnce(async () => Response.json({ data: { sites: many } }))
    await client.fetchQuery('GetSites', undefined)
    expect(await sites(client.db).count()).toBe(1234)
    expect((await client.db.queries.toArray())[0]!.rows).toHaveLength(1234)

    client.goOffline()
    const row = await client.enqueue('CreateSite', { name: 'x' })
    expect(await client.db.base.count()).toBe(1234)
    expect((await sites(client.db).get('m1233'))?.name).toBe('Changed')
    await client.rollback(row.id)
    expect(await sites(client.db).toArray()).toEqual(many)
  })
})

describe('engine in a worker', () => {
  /** Two ends that copy what is posted, as a worker and its page do. */
  function channel() {
    const ends = [new Set<(event: { data: unknown }) => void>(), new Set<(event: { data: unknown }) => void>()]
    const end = (mine: number): Port => ({
      postMessage: (message) => {
        const data = structuredClone(message)
        setTimeout(() => ends[1 - mine]!.forEach(listener => listener({ data })), 0)
      },
      addEventListener: (type, listener) => void (type === 'message' && ends[mine]!.add(listener as (event: { data: unknown }) => void)),
    })
    return { page: end(0), worker: end(1) }
  }

  /** The worker's side: an engine by itself, with no client around it. */
  function createTestEngine(extra: Partial<AirplaneEngineOptions> & { dbName: string }) {
    return createEngine({ documentsHash: 'h1', documents, entities: ENTITIES, mutationHandlers: {}, queryHandlers: siteQueries, stores: { stores: {} }, ...extra })
  }

  /** A client whose every write goes over a channel to an engine on the same database. */
  function createWorkerClient(handlers: MutationHandlers, extra: Partial<AirplaneClientOptions> = {}) {
    const dbName = `test-worker-${++n}`
    const { page, worker } = channel()
    const calls: string[] = []
    serveEngine(worker, () => {
      const engine = createTestEngine({ dbName, mutationHandlers: handlers, ...extra })
      return Object.fromEntries(Object.entries(engine).map(([method, fn]) => [method, (...args: unknown[]) => {
        calls.push(method)
        return (fn as (...args: unknown[]) => unknown)(...args)
      }])) as unknown as typeof engine
    })
    // The page has the handlers too, but must not run the ones that write.
    const never = () => {
      throw new Error('ran on the page')
    }
    const onPage = Object.fromEntries(Object.entries(handlers).map(([name, h]) => [name, { ...h, apply: h?.apply && never, reconcile: h?.reconcile && never }])) as MutationHandlers
    const client = createClient(server, { dbName, mutationHandlers: onPage, remote: remoteEngine(page, { endpoint: '', dbName }), ...extra })
    return { client, calls }
  }

  it('stores, applies, syncs and rolls back through the engine', async () => {
    const { client, calls } = createWorkerClient(createHandlers)
    const live = watchData(client, 'GetSites')
    await client.fetchQuery('GetSites', undefined)
    await until(() => live<{ sites: Site[] }>()?.sites.length === 2, 'the page to see what the engine stored')

    client.goOffline()
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'Renamed' })
    expect(rename).toMatchObject({ document: 'RenameSite', keys: [['Site', 's1']] })
    await client.enqueue('CreateSite', { name: 'West' })
    await until(() => live<{ sites: Site[] }>().sites.some(s => s.name === 'West'), 'the page to see the applied create')
    await until(() => client.state.pending.length === 2, 'the pending list')

    await client.rollback(rename.id)
    expect((await sites(client.db).get('s1'))?.name).toBe('North')

    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.sites.map(s => s.name)).toEqual(['North', 'South', 'West'])
    expect((await cachedSites(client)).map(s => s.id)).toEqual(['s1', 's2', 's3'])
    expect(await client.db.base.count()).toBe(0)
    expect(calls).toEqual(expect.arrayContaining(['ready', 'storeResponse', 'enqueue', 'rollback', 'reconcile', 'acknowledge']))
  })

  it('keeps a result whole and changes it from a mutation in the worker', async () => {
    const queryHandlers = { ...siteQueries, GetViewer: { store: 'result' } } as unknown as QueryHandlers
    const handlers = {
      RenameViewer: {
        apply: ({ result, variables }: { result: (name: string) => { update: (change: (data: { viewer: { name: string } }) => void) => Promise<boolean> }, variables: { name: string } }) =>
          result('GetViewer').update((data) => {
            data.viewer.name = variables.name
          }),
      },
    } as unknown as MutationHandlers
    const { client, calls } = createWorkerClient(handlers, { queryHandlers })
    const live = watchData(client, 'GetViewer')
    await client.fetchQuery('GetViewer', undefined)
    await until(() => live<{ viewer: { name: string } } | null>()?.viewer.name === 'Ada', 'the page to read what the engine stored')
    client.goOffline()
    const rename = await client.enqueue('RenameViewer', { name: 'Grace' })
    await until(() => live<{ viewer: { name: string } }>().viewer.name === 'Grace', 'the page to see the change')
    await client.rollback(rename.id)
    await until(() => live<{ viewer: { name: string } }>().viewer.name === 'Ada', 'the page to see the rollback')
    expect(calls).toEqual(expect.arrayContaining(['storeResponse', 'enqueue', 'rollback']))
  })

  it('carries local variables to the hooks in the worker, and not to the server', async () => {
    const declared = Object.fromEntries(Object.entries(documents).map(([name, doc]) => [name, { ...doc, variables: [...doc.source.matchAll(/\$(\w+):/g)].map(m => m[1]!) }]))
    const reconciled: unknown[] = []
    const { client } = createWorkerClient({
      RenameSite: {
        local: { suffix: '' },
        apply: ({ db, variables, local }: Ctx<{ id: string, name: string }> & { local: { suffix: string } }) => sites(db).update(variables.id, { name: variables.name + local.suffix }),
        reconcile: ({ local }: { local: unknown }) => void reconciled.push(local),
      },
    } as unknown as MutationHandlers, { documents: declared })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const row = await client.enqueue('RenameSite', { id: 's1', name: 'Renamed', suffix: '*' })
    expect(row).toMatchObject({ variables: { id: 's1', name: 'Renamed' }, local: { suffix: '*' } })
    expect((await sites(client.db).get('s1'))?.name).toBe('Renamed*')
    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => c.variables)).toEqual([{ id: 's1', name: 'Renamed' }])
    expect(reconciled).toEqual([{ suffix: '*' }])
  })

  it('takes variables a component hands over as a reactive object', async () => {
    const { client } = createWorkerClient(siteHandlers)
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const row = await client.enqueue('RenameSite', reactive({ id: 's1', name: 'Reactive' }))
    expect(row.variables).toEqual({ id: 's1', name: 'Reactive' })
    expect((await sites(client.db).get('s1'))?.name).toBe('Reactive')
  })

  it('fails the calls, waiting and later, when the worker itself fails', async () => {
    const listeners: Record<string, (event: { data?: unknown, message?: string }) => void> = {}
    const dead: Port = { postMessage: () => {}, addEventListener: (type, listener) => void (listeners[type] = listener) }
    const engine = remoteEngine(dead, { endpoint: '', dbName: 'x' })
    const waiting = engine.enqueue('RenameSite', {})
    listeners.error!({ message: 'script failed to load' })
    await expect(waiting).rejects.toThrow('The worker failed: script failed to load')
    await expect(engine.ready()).rejects.toThrow('`handlers.worker` to false')
  })

  it('brings an error from a handler back to the caller', async () => {
    const { client } = createWorkerClient({
      RenameSite: {
        apply: () => {
          throw new TypeError('no such site')
        },
      },
    } as unknown as MutationHandlers)
    await expect(client.enqueue('RenameSite', { id: 'nope', name: 'x' })).rejects.toMatchObject({ name: 'TypeError', message: 'no such site' })
    expect(await client.db.mutations.count()).toBe(0)
  })

  it('clears the cache in the engine when the key changes, keeping the outbox', async () => {
    const first = createWorkerClient(siteHandlers)
    await first.client.fetchQuery('GetSites', undefined)
    first.client.goOffline()
    await first.client.enqueue('RenameSite', { id: 's1', name: 'Kept' })
    await until(() => first.client.state.pending.length === 1, 'the pending list')
    const dbName = first.client.db.name
    first.client.db.close()

    const { page, worker } = channel()
    serveEngine(worker, () => createTestEngine({ dbName, mutationHandlers: siteHandlers, documentsHash: 'h2' }))
    const client = createClient(server, { dbName, mutationHandlers: siteHandlers, documentsHash: 'h2', remote: remoteEngine(page, { endpoint: '', dbName }) })
    client.goOffline()
    await client.ready
    expect(await client.db.queries.count()).toBe(0)
    expect(await client.db.mutations.count()).toBe(1)
  })
})

describe('inferred tables', () => {
  it('says why a table that was left out is not there', () => {
    const client = createClient(server, { unusedEntities: ['SiteItem'] })
    expect(() => (client.db as unknown as Record<string, unknown>).SiteItem).toThrow('was not created because nothing in the app mentions it')
  })

  it('merges the inferred tables with the user stores', () => {
    const entities = { Site: { key: 'id' }, Item: { key: 'id' } }
    expect(mergeStores(entities, {})).toEqual({ Site: '&id', Item: '&id' })
    expect(mergeStores(entities, { Item: 'name, &id', drafts: '++id, body' }))
      .toEqual({ Site: '&id', Item: '&id, name', drafts: '++id, body' })
  })

  it('opens a table per entity, keyed on its id', async () => {
    const client = createClient(server, { stores: { stores: { Site: 'name' } } })
    await client.ready
    expect(client.db.tables.map(t => t.name).sort()).toEqual(['Site', 'base', 'meta', 'mutations', 'queries', 'results'])
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

  it('tells a placeholder from a real id, through every way it is exported', async () => {
    const { isTempId: fromTypes } = await import('../src/runtime/types')
    const { isTempId: autoImported } = await import('../src/runtime/composables/isTempId')
    for (const check of [isTempId, fromTypes, autoImported]) {
      expect(check(newTempId())).toBe(true)
      for (const value of ['s1', 'tmp-', 'tmp-1700000000000', `x${newTempId()}`, `${newTempId()} `, newTempId().toUpperCase(), '', 42, null, undefined, {}, ['tmp-x']]) {
        expect(check(value)).toBe(false)
      }
    }
  })

  it('is true for the id tempId() gave a row, and false once the server has named it', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    expect(isTempId(tmp)).toBe(true)
    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    const real = (await cachedSites(client)).find(s => s.name === 'West')!.id
    expect(real).toBe('s3')
    expect(isTempId(real)).toBe(false)
  })

  it('puts a queued row back after a store that replaces the whole table', async () => {
    const replacing = {
      ...(siteQueries as unknown as Record<string, object>),
      GetSites: {
        ...(siteQueries as unknown as Record<string, object>).GetSites,
        // Nothing kept by hand: the table becomes exactly what the server sent.
        store: async ({ db }: { db: AirplaneDexie }, data: { sites: Site[] }) => {
          await sites(db).clear()
          await sites(db).bulkPut(data.sites)
        },
      },
    } as unknown as QueryHandlers
    const client = createClient(server, { queryHandlers: replacing, mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'West' })
    await client.enqueue('RenameSite', { id: 's1', name: 'Local' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id

    server.sites[1]!.name = 'South 2'
    await client.fetchQuery('GetSites', undefined)
    expect(await cachedSites(client)).toEqual([
      { id: 's1', name: 'Local', archived: false },
      { id: 's2', name: 'South 2', archived: false },
      { id: tmp, name: 'West', archived: false },
    ])

    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    await client.fetchQuery('GetSites', undefined)
    expect((await cachedSites(client)).map(s => s.id)).toEqual(['s1', 's2', 's3'])
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
    // The edit is queued under the real id, so it lands on the real row at once.
    const archive = await client.enqueue('ArchiveSite', { id: tmp })
    expect(archive.variables).toEqual({ id: 's3' })
    expect((await sites(client.db).get('s3'))!.archived).toBe(true)
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain again')
    expect(server.mutations().at(-1)).toMatchObject({ op: 'ArchiveSite', variables: { id: 's3' } })
  })

  it('rewrites the queue, variables and undo logs, when a placeholder resolves', async () => {
    const client = createClient(server, { mutationHandlers: createHandlers })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    const rename = await client.enqueue('RenameSite', { id: tmp, name: 'West 2' })
    const archive = await client.enqueue('ArchiveSite', { id: tmp })

    // The create is accepted, the rename hits a network error, the archive is never attempted.
    const restore = cutNetworkFor('RenameSite')
    client.goOnline()
    await until(() => client.state.lastError !== null, 'network error')
    expect((await client.db.mutations.get(archive.id))!.variables).toEqual({ id: 's3' })
    expect((await client.db.mutations.get(rename.id))!.keys).toEqual([['Site', 's3']])
    // The accepted create is the server's version of the row now, under both edits.
    expect(await client.db.base.toArray()).toEqual([{ table: 'Site', key: 's3', row: { id: 's3', name: 'West', archived: false } }])

    // A refetch rebases both edits onto the real row, with nothing left under the placeholder.
    await client.fetchQuery('GetSites', undefined)
    expect(await sites(client.db).get('s3')).toMatchObject({ name: 'West 2', archived: true })
    expect(await sites(client.db).get(tmp)).toBeUndefined()

    // So does rolling the rename back: the archive stays, on the real row.
    await client.rollback(rename.id)
    expect(await sites(client.db).get('s3')).toMatchObject({ name: 'West', archived: true })
    expect(await sites(client.db).get(tmp)).toBeUndefined()

    restore()
    await client.sync()
    expect(server.sites[2]).toMatchObject({ id: 's3', name: 'West', archived: true })
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
    client.mount('GetSites:x', refresh)

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
    expect((await client.db.mutations.get(row.id))?.keys).toEqual([['sites', 's1']])
    expect(await client.db.base.toArray()).toMatchObject([{ table: 'sites', key: 's1', row: { name: 'North' } }])

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
// Results kept whole: `store: 'result'`
// ---------------------------------------------------------------------------

describe('results kept whole', () => {
  interface Viewer { viewer: { name: string, role: string } }
  interface SiteStats { siteStats: { siteName: string | null, itemCount: number } }
  type ResultCtx = { result: (name: string, variables?: unknown) => { get: () => Promise<unknown>, update: (change: (data: never) => void) => Promise<boolean> } }

  const resultQueries = { ...siteQueries, GetViewer: { store: 'result' }, GetSiteStats: { store: 'result' } } as unknown as QueryHandlers
  /** Renames the viewer in the stored `GetViewer` result. */
  const viewerHandlers = {
    RenameViewer: {
      apply: ({ result, variables }: ResultCtx & { variables: { name: string } }) =>
        result('GetViewer').update((data: Viewer) => {
          data.viewer.name = variables.name
        }),
    },
  } as unknown as MutationHandlers
  const viewerKey = queryKey('GetViewer', undefined)

  it('keeps the whole response and reads it back, offline and in a fresh client', async () => {
    const dbName = `test-${++n}`
    const client = createClient(server, { dbName, queryHandlers: resultQueries })
    expect(client.readable('GetViewer')).toBe(true)
    await client.fetchQuery('GetViewer', undefined)
    expect(await client.db.results.toArray()).toEqual([{ key: viewerKey, document: 'GetViewer', variables: undefined, data: { viewer: { name: 'Ada', role: 'admin' } } }])
    // Keyed like the fetch record, which lists the row.
    expect((await client.db.queries.get(viewerKey))?.rows).toEqual([['results', viewerKey]])

    const { snapshot, unsubscribe } = client.watchQuery('GetViewer', undefined)
    await until(() => (snapshot.value.data as Viewer | null)?.viewer.name === 'Ada', 'the stored result')
    expect(snapshot.value).toMatchObject({ cached: true, updatedAt: expect.any(Number) })
    unsubscribe()

    const asked = server.calls.length
    const reloaded = createClient(server, { dbName, queryHandlers: resultQueries, startOffline: true })
    const viewer = watchData(reloaded, 'GetViewer')
    await until(() => viewer<Viewer | null>()?.viewer.name === 'Ada', 'the result from the table, offline')
    expect(server.calls.length).toBe(asked)
  })

  it('keeps one result per set of variables', async () => {
    server.siteItems.push({ id: 'i1', siteId: 's1', name: 'Bolt', qty: 0 })
    const client = createClient(server, { queryHandlers: resultQueries })
    await client.fetchQuery('GetSiteStats', { siteId: 's1' })
    await client.fetchQuery('GetSiteStats', { siteId: 's2' })
    expect(await client.db.results.where('document').equals('GetSiteStats').count()).toBe(2)
    const north = watchData(client, 'GetSiteStats', { siteId: 's1' })
    const south = watchData(client, 'GetSiteStats', { siteId: 's2' })
    await until(() => !!north() && !!south(), 'both results')
    expect(north<SiteStats>().siteStats).toEqual({ siteName: 'North', itemCount: 1 })
    expect(south<SiteStats>().siteStats).toEqual({ siteName: 'South', itemCount: 0 })
  })

  it('shows a mutation\'s change at once, keeps it on top of a fresh response, and rolls it back', async () => {
    const client = createClient(server, { queryHandlers: resultQueries, mutationHandlers: viewerHandlers })
    await client.fetchQuery('GetViewer', undefined)
    const viewer = watchData(client, 'GetViewer')
    client.goOffline()
    const rename = await client.enqueue('RenameViewer', { name: 'Grace' })
    await until(() => viewer<Viewer | null>()?.viewer.name === 'Grace', 'the change to show')
    expect(rename.keys).toEqual([['results', viewerKey]])
    expect(await client.db.base.toArray()).toEqual([{ table: 'results', key: viewerKey, row: expect.objectContaining({ data: { viewer: { name: 'Ada', role: 'admin' } } }) }])

    // A response while it is queued becomes the server's version, with the change on top.
    server.viewer.role = 'owner'
    await client.fetchQuery('GetViewer', undefined)
    expect((await client.db.results.get(viewerKey))?.data).toEqual({ viewer: { name: 'Grace', role: 'owner' } })

    await client.rollback(rename.id)
    expect((await client.db.results.get(viewerKey))?.data).toEqual({ viewer: { name: 'Ada', role: 'owner' } })
    await until(() => viewer<Viewer>().viewer.name === 'Ada', 'the rollback to show')
    expect(await client.db.base.count()).toBe(0)
  })

  it('syncs a change to a stored result like any other', async () => {
    const client = createClient(server, { queryHandlers: resultQueries, mutationHandlers: viewerHandlers })
    await client.fetchQuery('GetViewer', undefined)
    client.goOffline()
    await client.enqueue('RenameViewer', { name: 'Grace' })
    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.viewer.name).toBe('Grace')
    expect((await client.db.results.get(viewerKey))?.data).toEqual({ viewer: { name: 'Grace', role: 'admin' } })
    expect(await client.db.base.count()).toBe(0)
  })

  it('goes with clearCache() and clear()', async () => {
    const client = createClient(server, { queryHandlers: resultQueries, mutationHandlers: viewerHandlers })
    await client.fetchQuery('GetViewer', undefined)
    client.goOffline()
    await client.enqueue('RenameViewer', { name: 'Grace' })

    await client.clearCache()
    // The queue is put on again and finds nothing to change.
    expect(await client.db.results.count()).toBe(0)
    expect(await client.db.mutations.count()).toBe(1)

    await client.fetchQuery('GetViewer', undefined)
    expect((await client.db.results.get(viewerKey))?.data).toEqual({ viewer: { name: 'Grace', role: 'admin' } })
    await client.clear()
    expect(await client.db.results.count()).toBe(0)
  })

  it('is dropped with its fetch record when room runs out', async () => {
    const client = createClient(server, { queryHandlers: resultQueries })
    for (const siteId of ['s1', 's2']) {
      await client.fetchQuery('GetSiteStats', { siteId })
      await new Promise(r => setTimeout(r, 2))
    }
    expect(await client.evict()).toBe(1)
    expect((await client.db.results.toArray()).map(r => r.variables)).toEqual([{ siteId: 's2' }])
    expect((await client.db.queries.toArray()).map(q => q.variables)).toEqual([{ siteId: 's2' }])
  })

  it('reads with the handler\'s own read when it has one', async () => {
    const handlers = {
      GetViewer: {
        store: 'result',
        read: async ({ result }: ResultCtx) => {
          const data = await result('GetViewer').get() as Viewer | undefined
          return data && { viewer: { ...data.viewer, name: data.viewer.name.toUpperCase() } }
        },
      },
    } as unknown as QueryHandlers
    const client = createClient(server, { queryHandlers: handlers })
    await client.fetchQuery('GetViewer', undefined)
    const viewer = watchData(client, 'GetViewer')
    await until(() => viewer<Viewer | null>()?.viewer.name === 'ADA', 'the handler\'s read')
  })

  it('hands every hook the stored result, and says when there is none to update', async () => {
    const seen: unknown[] = []
    const handlers = {
      RenameViewer: {
        describe: async ({ result }: ResultCtx) => {
          seen.push(await result('GetViewer').get())
          return 'Rename'
        },
        apply: async ({ result }: ResultCtx) => seen.push(await result('GetViewer').update(() => {})),
        reconcile: async ({ result }: ResultCtx) => seen.push(await result('GetViewer').get()),
      },
    } as unknown as MutationHandlers
    const client = createClient(server, { queryHandlers: resultQueries, mutationHandlers: handlers })
    await client.enqueue('RenameViewer', { name: 'Grace' })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    // Nothing fetched yet: nothing to read, nothing to update.
    expect(seen).toEqual([undefined, false, undefined])
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

// ---------------------------------------------------------------------------
// Things
// ---------------------------------------------------------------------------

describe('what a mutation did', () => {
  const changes = (before: unknown, after: unknown) => {
    const { created, touched } = describeChanges([{ table: 'Site', key: 's1', before, after }])
    return { created, touched }
  }
  const did = (before: unknown, after: unknown) => describeChanges([{ table: 'Site', key: 's1', before, after }])

  it('names what a write created and touched, at every level', () => {
    const site = { id: 's1', name: 'North', items: [{ id: 'i1', qty: 1 }] }
    expect(changes(undefined, site)).toEqual({ created: new Set(['Site/s1', 'Site/s1/items/i1']), touched: new Set(['Site/s1', 'Site/s1/items/i1']) })
    expect(changes(site, { ...site, items: [...site.items, { id: 'i2', qty: 0 }] })).toEqual({ created: new Set(['Site/s1/items/i2']), touched: new Set(['Site/s1', 'Site/s1/items/i2']) })
    expect(changes(site, { ...site, items: [{ id: 'i1', qty: 4 }] })).toEqual({ created: new Set(), touched: new Set(['Site/s1', 'Site/s1/items/i1']) })
    expect(changes(site, { ...site, name: 'South' })).toEqual({ created: new Set(), touched: new Set(['Site/s1']) })
    expect(changes(site, { ...site, items: [] })).toEqual({ created: new Set(), touched: new Set(['Site/s1', 'Site/s1/items/i1']) })
    expect(changes(site, { ...site })).toEqual({ created: new Set(), touched: new Set() })
    expect(describeChanges([{ table: 'siteItems', key: ['s1', 'a/b'], before: undefined, after: { qty: 0 } }]).created).toEqual(new Set(['siteItems/["s1","a%2Fb"]']))
  })

  it('removing a thing touches it, not what it held', () => {
    const site = { id: 's1', items: [{ id: 'i1', parts: [{ id: 'p1' }] }] }
    expect(changes(site, undefined)).toEqual({ created: new Set(), touched: new Set(['Site/s1']) })
    expect(changes(site, { ...site, items: [] })).toEqual({ created: new Set(), touched: new Set(['Site/s1', 'Site/s1/items/i1']) })
  })

  it('counts list elements only: a single nested object with an id is a reference', () => {
    const site = { id: 's1', owner: { id: 'u1', name: 'Ann' }, tags: ['a'] }
    expect(changes(site, { ...site, owner: { id: 'u2', name: 'Bob' } })).toEqual({ created: new Set(), touched: new Set(['Site/s1']) })
    expect(changes(site, { ...site, tags: ['a', 'b'] })).toEqual({ created: new Set(), touched: new Set(['Site/s1']) })
  })

  it('finds lists through the objects on the way, as in a connection', () => {
    const site = { id: 's1', items: { totalCount: 1, nodes: [{ id: 'i1', qty: 1 }] } }
    expect(changes(site, { ...site, items: { totalCount: 2, nodes: [...site.items.nodes, { id: 'i2', qty: 0 }] } }))
      .toEqual({ created: new Set(['Site/s1/items/nodes/i2']), touched: new Set(['Site/s1', 'Site/s1/items/nodes/i2']) })
  })

  it('treats what it cannot compare field by field as changed', () => {
    expect(changes({ id: 's1', seen: new Map([['a', 1]]) }, { id: 's1', seen: new Map([['a', 1]]) }).touched).toEqual(new Set(['Site/s1']))
    expect(changes({ id: 's1', at: new Date(5) }, { id: 's1', at: new Date(5) }).touched).toEqual(new Set())
  })

  it('names the pieces it wrote', () => {
    const site = { id: 's1', name: 'North', tags: ['a'], items: [{ id: 'i1', qty: 1 }, { id: 'i2', qty: 2 }] }
    const after = { id: 's1', name: 'South', tags: ['a', 'b'], note: 'new', items: [{ id: 'i2', qty: 5 }, { id: 'i3', qty: 0 }] }
    expect(did(site, after).wrote).toEqual(new Set(['Site/s1#name', 'Site/s1#tags', 'Site/s1/items/i1', 'Site/s1/items/i2#qty', 'Site/s1/items/i3', 'Site/s1#note']))
    expect(did(undefined, site).wrote).toEqual(new Set(['Site/s1']))
    expect(did(site, undefined).wrote).toEqual(new Set(['Site/s1']))
    // A list that only changed its order is one piece.
    expect(did(site, { ...site, items: [...site.items].reverse() }).wrote).toEqual(new Set(['Site/s1#items']))
  })
})

// ---------------------------------------------------------------------------
// Local variables: passed with an operation's own, read by its handler, never sent
// ---------------------------------------------------------------------------

describe('local variables', () => {
  /** The documents as the build compiles them: each knows the variables it declares. */
  const declared = Object.fromEntries(Object.entries(documents).map(([name, doc]) => [name, {
    ...doc,
    variables: [...doc.source.matchAll(/\$(\w+):/g)].map(m => m[1]!),
  }]))

  /** `GetSites` with a local filter on the name, read from the tables. */
  const store = vi.fn(({ db }: { db: AirplaneDexie }, data: { sites: Site[] }) => sites(db).bulkPut(data.sites))
  const read = vi.fn(async ({ db, local }: { db: AirplaneDexie, local: { startsWith: string, archived: boolean } }) => ({
    sites: (await sites(db).toArray()).filter(s => s.name.startsWith(local.startsWith) && (local.archived || !s.archived)),
  }))
  const localQueries = {
    ...siteQueries,
    GetSites: { local: { startsWith: '', archived: false }, store, read },
  } as unknown as QueryHandlers

  function createLocalClient(extra: Partial<AirplaneClientOptions> = {}) {
    return createClient(server, { documents: declared, queryHandlers: localQueries, ...extra })
  }

  beforeEach(() => {
    store.mockClear()
    read.mockClear()
  })

  it('sends only what the operation declares, and hands `read` the rest with the defaults filled in', async () => {
    const client = createLocalClient()
    await client.fetchQuery('GetSites', { startsWith: 'N' })
    expect(server.calls.map(c => c.variables)).toEqual([undefined])
    expect(store).toHaveBeenCalledWith(expect.objectContaining({ variables: undefined }), expect.anything())
    expect(store.mock.calls[0]![0]).not.toHaveProperty('local')

    const data = watchData(client, 'GetSites', { startsWith: 'N' })
    await until(() => !!data(), 'read')
    expect(data()).toEqual({ sites: [expect.objectContaining({ name: 'North' })] })
    expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ variables: undefined, local: { startsWith: 'N', archived: false } }))
  })

  it('keeps local variables out of the query key: one fetch record, one request in flight', async () => {
    const client = createLocalClient()
    await Promise.all([
      client.fetchQuery('GetSites', { startsWith: 'N' }),
      client.fetchQuery('GetSites', { startsWith: 'S', archived: true }),
      client.fetchQuery('GetSites', undefined),
    ])
    expect(server.calls).toHaveLength(1)
    expect((await client.db.queries.toArray()).map(r => r.key)).toEqual([queryKey('GetSites', undefined)])
    expect(client.splitQuery('GetSites', { startsWith: 'N' }).key).toBe(queryKey('GetSites', undefined))
  })

  it('keeps the operation\'s own variables in the key, and sends them as they were passed', async () => {
    const client = createClient(server, {
      documents: declared,
      queryHandlers: { ...siteQueries, GetSite: { ...(siteQueries as Record<string, object>).GetSite, local: { highlight: false } } } as unknown as QueryHandlers,
    })
    await client.fetchQuery('GetSite', { id: 's1', highlight: true })
    expect(server.calls[0]!.variables).toEqual({ id: 's1' })
    expect(client.splitQuery('GetSite', { id: 's1', highlight: true })).toEqual({ server: { id: 's1' }, local: { highlight: true }, key: queryKey('GetSite', { id: 's1' }) })
    // Nothing local passed: the same object goes out.
    const input = { id: 's2' }
    expect(client.splitQuery('GetSite', input).server).toBe(input)
  })

  it('drops a key that is neither the operation\'s nor a local one, rather than send what the server rejects', async () => {
    const client = createLocalClient()
    await client.fetchQuery('GetSite', { id: 's1', typo: 1 })
    expect(server.calls[0]!.variables).toEqual({ id: 's1' })
  })

  it('a local variable left undefined takes its default', () => {
    const client = createLocalClient()
    expect(client.splitQuery('GetSites', { startsWith: undefined }).local).toEqual({ startsWith: '', archived: false })
  })

  it('never hands a local variable to `prefetch.next`, and sends what it returns', async () => {
    const next = vi.fn((data: { searchItems: { pageInfo: { hasNextPage: boolean, endCursor: string } } }, variables: Record<string, unknown> | undefined) =>
      data.searchItems.pageInfo.hasNextPage ? { ...variables, after: data.searchItems.pageInfo.endCursor } : null)
    const client = createClient(server, {
      documents: declared,
      queryHandlers: { SearchItems: { local: { only: 'x' }, prefetch: { next }, store: () => {}, read: () => null } } as unknown as QueryHandlers,
    })
    await client.fetchQuery('SearchItems', { only: 'y' })
    await until(() => client.state.prefetching === 0 && server.calls.length === 3, 'prefetch')
    expect(next.mock.calls.map(([, variables]) => variables)).toEqual([undefined, { after: '2' }, { after: '4' }])
    expect(server.calls.map(c => c.variables)).toEqual([undefined, { after: '2' }, { after: '4' }])
  })

  it('keeps a refresh for each mounted query, also two that share a key', async () => {
    const client = createLocalClient()
    const a = vi.fn(async () => {})
    const b = vi.fn(async () => {})
    const key = client.splitQuery('GetSites', { startsWith: 'N' }).key
    const unmountA = client.mount(key, a)
    client.mount(client.splitQuery('GetSites', { startsWith: 'S' }).key, b)
    unmountA()
    await client.refetchActive()
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
  })

  /** `RenameSite` with a local `note` the hooks see and the server never does. */
  let seen: Record<string, unknown[]> = {}
  const saw = (hook: string) => (ctx: { local: unknown }) => void (seen[hook] ??= []).push(ctx.local)
  const localMutations = {
    ...createHandlers,
    RenameSite: {
      local: { note: '', siteRef: '' },
      describe: (ctx: Ctx<{ id: string, name: string }> & { local: { note: string } }) => (saw('describe')(ctx), `Rename (${ctx.local.note})`),
      apply: (ctx: Ctx<{ id: string, name: string }> & { local: { note: string } }) => {
        saw('apply')(ctx)
        return sites(ctx.db).update(ctx.variables.id, { name: `${ctx.variables.name}${ctx.local.note}` })
      },
      reconcile: saw('reconcile'),
      revert: saw('revert'),
    },
  } as unknown as MutationHandlers

  beforeEach(() => {
    seen = {}
  })

  it('queues local variables on the outbox row, hands them to every hook and never sends them', async () => {
    const client = createClient(server, { documents: declared, mutationHandlers: localMutations })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const row = await client.enqueue('RenameSite', { id: 's1', name: 'A', note: '!' })
    expect(row).toMatchObject({ variables: { id: 's1', name: 'A' }, local: { note: '!', siteRef: '' }, description: 'Rename (!)' })
    expect((await sites(client.db).get('s1'))?.name).toBe('A!')

    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(server.mutations().map(c => c.variables)).toEqual([{ id: 's1', name: 'A' }])
    expect(seen.describe).toEqual([{ note: '!', siteRef: '' }])
    expect(seen.reconcile).toEqual([{ note: '!', siteRef: '' }])
    expect(seen.apply!.every(local => (local as { note: string }).note === '!')).toBe(true)
  })

  it('hands them to `apply` again on a rebase, and to `revert` on a rollback', async () => {
    const client = createClient(server, { documents: declared, mutationHandlers: localMutations })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const row = await client.enqueue('RenameSite', { id: 's1', name: 'A', note: '?' })
    // A response carrying the row the queue changed puts the queue on again.
    await client.engine.storeResponse('GetSites', undefined, { sites: [{ id: 's1', name: 'Fresh', archived: false }] })
    expect(seen.apply).toEqual([{ note: '?', siteRef: '' }, { note: '?', siteRef: '' }])
    expect((await sites(client.db).get('s1'))?.name).toBe('A?')
    await client.rollback(row.id)
    expect(seen.revert).toEqual([{ note: '?', siteRef: '' }])
    expect((await sites(client.db).get('s1'))?.name).toBe('Fresh')
  })

  it('links and rewrites a placeholder carried in a local variable, as in the variables', async () => {
    const client = createClient(server, { documents: declared, mutationHandlers: localMutations })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const create = await client.enqueue('CreateSite', { name: 'West' })
    const tmp = (await cachedSites(client)).find(s => s.name === 'West')!.id
    const rename = await client.enqueue('RenameSite', { id: 's1', name: 'B', siteRef: tmp })
    expect(rename.dependsOn).toEqual([create.id])

    client.goOnline()
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    expect(seen.reconcile).toEqual([{ note: '', siteRef: 's3' }])
  })

  it('merges two queued edits only when their local variables are the same', async () => {
    const merging = {
      ...localMutations,
      RenameSite: { ...(localMutations as Record<string, object>).RenameSite, merge: (a: { id: string }, b: { id: string }) => (a.id === b.id ? b : null) },
    } as unknown as MutationHandlers
    const client = createClient(server, { documents: declared, mutationHandlers: merging })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    const first = await client.enqueue('RenameSite', { id: 's1', name: 'A', note: '1' })
    const same = await client.enqueue('RenameSite', { id: 's1', name: 'B', note: '1' })
    const other = await client.enqueue('RenameSite', { id: 's1', name: 'C', note: '2' })
    expect(same.id).toBe(first.id)
    expect(other.id).not.toBe(first.id)
  })

  it('splits them for `execute` too, and hands them to `reconcile`', async () => {
    const client = createClient(server, { documents: declared, mutationHandlers: localMutations })
    await client.execute('RenameSite', { id: 's1', name: 'Direct', note: '#' })
    expect(server.mutations().map(c => c.variables)).toEqual([{ id: 's1', name: 'Direct' }])
    expect(seen.reconcile).toEqual([{ note: '#', siteRef: '' }])
  })
})

// ---------------------------------------------------------------------------
// Online queries: asked of the server, never stored
// ---------------------------------------------------------------------------

describe('ask', () => {
  it('sends the query and stores nothing, even when the query has a handler', async () => {
    const store = vi.fn()
    const client = createClient(server, { queryHandlers: { ...siteQueries, GetSites: { ...(siteQueries as Record<string, object>).GetSites, store } } as unknown as QueryHandlers })
    const data = await client.ask<{ sites: Site[] }>('GetSites', undefined)
    expect(data.sites).toHaveLength(2)
    expect(store).not.toHaveBeenCalled()
    expect(await client.db.queries.count()).toBe(0)
    expect(await sites(client.db).count()).toBe(0)
  })

  it('shares a request on its way, but not one that left before a mutation was accepted', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers })
    await Promise.all([client.ask('GetSites', undefined), client.ask('GetSites', undefined)])
    expect(server.calls.filter(c => c.op === 'GetSites')).toHaveLength(1)

    const first = client.ask('GetSites', undefined)
    await client.execute('RenameSite', { id: 's1', name: 'Asked' })
    const second = client.ask<{ sites: Site[] }>('GetSites', undefined)
    await first
    expect((await second).sites[0]!.name).toBe('Asked')
    expect(server.calls.filter(c => c.op === 'GetSites')).toHaveLength(3)
  })

  it('refuses a mutation', async () => {
    const client = createClient(server)
    await expect(client.ask('RenameSite', { id: 's1', name: 'x' })).rejects.toThrow(/not a query/)
  })

  it('a mounted online query is refetched after a sync only when a mutation names it', async () => {
    const client = createClient(server, {
      mutationHandlers: { ...siteHandlers, ArchiveSite: { ...(siteHandlers as Record<string, object>).ArchiveSite, refetch: ['GetSite'] } } as unknown as MutationHandlers,
    })
    const online = vi.fn(async () => {})
    const named = vi.fn(async () => {})
    const stored = vi.fn(async () => {})
    client.mount(queryKey('GetSites', undefined), online, { online: true })
    client.mount(queryKey('GetSite', { id: 's1' }), named, { online: true })
    client.mount(queryKey('GetSites', undefined), stored)

    // A rename changes the Site table: the stored GetSites is asked again, the online one is not.
    await client.enqueue('RenameSite', { id: 's1', name: 'R' })
    await until(async () => (await client.db.mutations.count()) === 0, 'outbox to drain')
    await until(() => stored.mock.calls.length > 0, 'the stored query refetched')
    expect(online).not.toHaveBeenCalled()
    expect(named).not.toHaveBeenCalled()

    // An archive names GetSite.
    await client.enqueue('ArchiveSite', { id: 's2' })
    await until(() => named.mock.calls.length === 1, 'the named online query refetched')
    expect(online).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// "Work offline": kept across reloads and tabs, and nothing sent before start
// ---------------------------------------------------------------------------

describe('work offline', () => {
  /** A `localStorage` of its own, shared by the clients a test creates, as the tabs of one browser share theirs. */
  function memoryStorage() {
    const items = new Map<string, string>()
    return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), items }
  }

  it('is kept: a client opened later, as after a reload, starts offline and sends nothing', async () => {
    const storage = memoryStorage()
    const dbName = `offline-${++n}`
    const first = createClient(server, { dbName, storage, mutationHandlers: siteHandlers })
    await first.fetchQuery('GetSites', undefined)
    first.goOffline()
    await first.enqueue('RenameSite', { id: 's1', name: 'Held' })
    // The first client stays open, held offline as it is: closing its database under its own background work would only add noise.

    const reloaded = createClient(server, { dbName, storage, mutationHandlers: siteHandlers })
    expect(reloaded.state.forcedOffline).toBe(true)
    await reloaded.sync()
    expect(server.mutations()).toHaveLength(0)

    reloaded.goOnline()
    await until(async () => (await reloaded.db.mutations.count()) === 0, 'outbox to drain')
    expect(storage.items.get(offlineKey(dbName))).toBe('0')
    expect(createClient(server, { dbName, storage }).state.forcedOffline).toBe(false)
  })

  it('starts offline with `startOffline` until a choice is made, and the choice wins from then on', () => {
    const storage = memoryStorage()
    const dbName = `offline-${++n}`
    expect(createClient(server, { dbName, storage, startOffline: true }).state.forcedOffline).toBe(true)
    createClient(server, { dbName, storage, startOffline: true }).goOnline()
    expect(createClient(server, { dbName, storage, startOffline: true }).state.forcedOffline).toBe(false)
    // No storage at all: `startOffline` alone.
    expect(createClient(server, { storage: null, startOffline: true }).state.forcedOffline).toBe(true)
  })

  it('follows another tab going offline and back online', async () => {
    const tab = new EventTarget()
    vi.stubGlobal('window', tab)
    const storage = memoryStorage()
    const dbName = `offline-${++n}`
    const client = createClient(server, { dbName, storage, mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    const fromOtherTab = (newValue: string | null) => tab.dispatchEvent(Object.assign(new Event('storage'), { key: offlineKey(dbName), newValue }))

    fromOtherTab('1')
    expect(client.state.forcedOffline).toBe(true)
    await client.enqueue('RenameSite', { id: 's1', name: 'Waits' })
    await new Promise(r => setTimeout(r, 30))
    expect(server.mutations()).toHaveLength(0)

    fromOtherTab('0')
    expect(client.state.forcedOffline).toBe(false)
    await until(async () => (await client.db.mutations.count()) === 0, 'the other tab\'s goOnline to drain it')
    // Someone else's key changes nothing.
    tab.dispatchEvent(Object.assign(new Event('storage'), { key: 'other', newValue: '1' }))
    expect(client.state.forcedOffline).toBe(false)
  })

  it('with autoStart: false, sends nothing until start(), and a sync() asked for before resolves after', async () => {
    const client = createClient(server, { autoStart: false, mutationHandlers: siteHandlers })
    await client.fetchQuery('GetSites', undefined)
    await client.enqueue('RenameSite', { id: 's1', name: 'Later' })
    let drained = false
    const asked = client.sync().then(() => (drained = true))
    await new Promise(r => setTimeout(r, 30))
    expect(server.mutations()).toHaveLength(0)
    expect(drained).toBe(false)

    client.start()
    await asked
    expect(server.mutations()).toHaveLength(1)
  })

  it('going offline mid-batch lets what is in flight land and starts nothing more', async () => {
    const client = createClient(server, { mutationHandlers: siteHandlers, request: { concurrency: 1 } })
    await client.fetchQuery('GetSites', undefined)
    client.goOffline()
    await client.enqueue('RenameSite', { id: 's1', name: 'A' })
    await client.enqueue('ArchiveSite', { id: 's2' })
    const impl = server.fetch.getMockImplementation()!
    let release!: () => void
    const held = new Promise<void>(r => (release = r))
    server.fetch.mockImplementation(async (url, init) => {
      if ((init!.body as string).includes('mutation RenameSite')) await held
      return impl(url, init)
    })
    client.goOnline()
    await until(() => server.fetch.mock.calls.some(([, init]) => (init!.body as string).includes('mutation RenameSite')), 'the rename to be in flight')
    client.goOffline()
    release()
    await until(async () => (await client.db.mutations.count()) === 1, 'the rename to land')
    await new Promise(r => setTimeout(r, 30))
    expect(server.mutations().map(c => c.op)).toEqual(['RenameSite'])
    expect((await client.db.mutations.toArray()).map(m => m.document)).toEqual(['ArchiveSite'])
  })
})
