// Build-time pieces: document loading with fragment resolution, type
// generation, and schema loading from file, introspection and the cache.
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSchema, graphqlSync, getIntrospectionQuery } from 'graphql'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateTypes, loadDocuments, loadSchema } from '../src/codegen'

const SDL = `
  type Site { id: ID!, name: String!, archived: Boolean! }
  type Query { sites(archived: Boolean): [Site!]!, site(id: ID!): Site }
  type Mutation { renameSite(id: ID!, name: String!): Site! }
`

async function tempDir() {
  return mkdtemp(join(tmpdir(), 'nuxt-airplane-'))
}

const log = () => ({ warn: vi.fn() })

afterEach(() => vi.unstubAllGlobals())

describe('loadDocuments', () => {
  it('collects named operations and inlines the fragments they spread, recursively', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'graphql'), { recursive: true })
    await writeFile(join(dir, 'graphql/fragments.gql'), `
      fragment SiteFields on Site { id ...SiteName }
      fragment SiteName on Site { name }
    `)
    await writeFile(join(dir, 'graphql/sites.gql'), `
      query GetSites { sites { ...SiteFields } }
      mutation RenameSite($id: ID!, $name: String!) { renameSite(id: $id, name: $name) { ...SiteName } }
      query GetSite($id: ID!) { site(id: $id) { id } }
    `)
    const logger = log()
    const docs = await loadDocuments(['**/*.gql'], dir, logger)

    expect(Object.keys(docs.operations).sort()).toEqual(['GetSite', 'GetSites', 'RenameSite'])
    expect(docs.operations.GetSites).toMatchObject({ kind: 'query' })
    expect(docs.operations.RenameSite).toMatchObject({ kind: 'mutation' })
    // Both fragments travel with GetSites, only SiteName with RenameSite, none with GetSite.
    expect(docs.operations.GetSites!.source).toMatch(/fragment SiteFields on Site[\s\S]*fragment SiteName on Site/)
    expect(docs.operations.RenameSite!.source).toContain('fragment SiteName')
    expect(docs.operations.RenameSite!.source).not.toContain('fragment SiteFields')
    expect(docs.operations.GetSite!.source).not.toContain('fragment')
    expect(docs.files).toHaveLength(2)
    expect(logger.warn).not.toHaveBeenCalled()
    // The persisted query id: SHA-256 of exactly the text that is sent.
    for (const op of Object.values(docs.operations)) {
      expect(op.hash).toBe(createHash('sha256').update(op.source).digest('hex'))
    }
  })

  it('skips anonymous and duplicate operations, and files that do not parse, with a warning', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.gql'), 'query GetSites { sites { id } }\nquery { sites { id } }')
    await writeFile(join(dir, 'b.gql'), 'query GetSites { sites { name } }')
    await writeFile(join(dir, 'broken.gql'), 'query {{{')
    const logger = log()
    const docs = await loadDocuments(['*.gql'], dir, logger)

    expect(Object.keys(docs.operations)).toEqual(['GetSites'])
    expect(docs.operations.GetSites!.source).toContain('id') // the first one wins
    const warnings = logger.warn.mock.calls.map(c => c[0] as string)
    expect(warnings.some(w => /anonymous query/.test(w))).toBe(true)
    expect(warnings.some(w => /Duplicate operation "GetSites"/.test(w))).toBe(true)
    expect(warnings.some(w => /Skipping .*broken\.gql/.test(w))).toBe(true)
  })

  it('warns about unknown fragments but keeps the operation', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'a.gql'), 'query GetSites { sites { ...Missing } }')
    const logger = log()
    const docs = await loadDocuments(['*.gql'], dir, logger)
    expect(docs.operations.GetSites).toBeDefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/unknown fragment "Missing"/))
  })
})

describe('entities', () => {
  const NESTED = buildSchema(`
    type SiteItem { id: ID!, name: String!, onHand: Int! }
    type User { id: ID!, name: String!, email: String! }
    type Team { id: ID!, name: String!, size: Int! }
    union Contact = User | Team
    type Site { id: ID!, name: String!, archived: Boolean!, items: [SiteItem!]!, tags: [String!], owner: User, contact: Contact! }
    type PageInfo { hasNextPage: Boolean! }
    type Query { sites: [Site!]!, site(id: ID!): Site, pageInfo: PageInfo! }
    type Mutation { renameSite(id: ID!, name: String!): Site! }
  `)

  async function nestedDocs() {
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.gql'), `
      fragment SiteFields on Site { id name }
      query GetSites { sites { ...SiteFields archived items { id name onHand } owner { name } contact { ... on User { name } ... on Team { size } } } }
      query GetSite($id: ID!) { site(id: $id) { ...SiteFields tags owner { name email } } }
      query GetSiteItems($id: ID!) { site(id: $id) { id items { id name onHand } } }
      query GetPage { pageInfo { hasNextPage } }
      mutation RenameSite($id: ID!, $name: String!) { renameSite(id: $id, name: $name) { id } }
    `)
    return loadDocuments(['*.gql'], dir, log(), NESTED)
  }

  it('finds the types selected with an id and the union of their fields', async () => {
    const docs = await nestedDocs()
    expect(Object.keys(docs.entities).sort()).toEqual(['Site', 'SiteItem'])
    expect(docs.entities.Site).toEqual({ key: 'id' })
    // The documents are sent as written: nothing is injected.
    expect(docs.operations.GetSites!.source).not.toContain('__typename')
    // Selected in every node selection of Site (GetSites, GetSite): required.
    // Only in some: optional. GetSiteItems and RenameSite only navigate to
    // children or select the id, so they do not loosen the row; `items` is
    // on it all the same. A nested entity selected with its id: its row
    // type. Any other object: the fields selected on it, merged the same
    // way, never the schema type (User has a required email the documents
    // do not always select). A union: one object per member selected.
    expect(docs.rows.Site).toEqual({
      id: { ts: 'string', required: true },
      name: { ts: 'string', required: true },
      archived: { ts: 'boolean', required: false },
      items: { ts: 'Array<SiteItemRow>', required: false },
      owner: { ts: '{ name: string, email?: string } | null', required: true },
      contact: { ts: '{ name: string } | { size: number }', required: false },
      tags: { ts: 'Array<string> | null', required: false },
    })
    expect(docs.rows.SiteItem).toEqual({
      id: { ts: 'string', required: true },
      name: { ts: 'string', required: true },
      onHand: { ts: 'number', required: true },
    })
    expect(docs.entities.User).toBeUndefined()
  })

  it('does not count a selection that only reaches below the type through a connection or an embedded object', async () => {
    const schema = buildSchema(`
      enum Status { OPEN, CLOSED }
      type Item { id: ID!, label: String! }
      type ItemConnection { nodes: [Item!], totalCount: Int! }
      type Settings { theme: String! }
      type Site { id: ID!, name: String!, status: Status!, items(first: Int): ItemConnection!, settings: Settings! }
      type Query { site(id: ID!): Site }
    `)
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.gql'), `
      query GetSite($id: ID!) { site(id: $id) { id name status } }
      query GetSiteItems($id: ID!) { site(id: $id) { id items { totalCount nodes { id label } } } }
      query GetSiteSettings($id: ID!) { site(id: $id) { id settings { theme } } }
      query GetSiteKey($id: ID!) { site(id: $id) { siteId: id name } }
    `)
    const docs = await loadDocuments(['*.gql'], dir, log(), schema)
    // GetSite is the only full node selection: name and status required. What
    // the navigation queries reach is on the row, optional, with its own
    // fields required as selected. GetSiteKey aliases the id, so it is not a
    // selection of Site at all.
    expect(docs.rows.Site).toEqual({
      id: { ts: 'string', required: true },
      name: { ts: 'string', required: true },
      status: { ts: 'Status', required: true },
      items: { ts: '{ totalCount: number, nodes: Array<ItemRow> | null }', required: false },
      settings: { ts: '{ theme: string }', required: false },
    })
    expect(docs.rows.Item).toEqual({ id: { ts: 'string', required: true }, label: { ts: 'string', required: true } })
  })

  it('types a partly covered union or interface as the result does, so rows go in and come back out', async () => {
    const schema = buildSchema(`
      type Product { id: ID!, title: String!, code: String }
      type ProductNotFound { message: String! }
      union ProductResult = Product | ProductNotFound
      interface Node { id: ID! }
      type Item implements Node { id: ID!, label: String!, product: ProductResult, node: Node, nodes: [Node!]! }
      type Other implements Node { id: ID!, size: Int! }
      type Query { item(id: ID!): Item }
    `)
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.gql'), `
      query GetItem($id: ID!) { item(id: $id) { id label product { ... on Product { title code } } node { id ... on Other { size } } nodes { ... on Other { size } } } }
    `)
    const docs = await loadDocuments(['*.gql'], dir, log(), schema)
    expect(docs.rows.Item).toEqual({
      id: { ts: 'string', required: true },
      label: { ts: 'string', required: true },
      product: { ts: '{ title: string, code: string | null } | Record<PropertyKey, never> | null', required: true },
      node: { ts: '{ id: string, size: number } | { id: string } | null', required: true },
      nodes: { ts: 'Array<{ size: number } | Record<PropertyKey, never>>', required: true },
    })
    // An arm that does not select the id on its own (`... on Other { size }`) makes no table.
    expect(Object.keys(docs.entities).sort()).toEqual(['Item'])
  })

  it('emits a row type per entity and maps them onto NuxtAirplaneStores', async () => {
    const out = await generateTypes(NESTED, await nestedDocs())
    expect(out).toContain('export type SiteRow = { id: string, name: string, archived?: boolean, items?: Array<SiteItemRow>, owner: { name: string, email?: string } | null, contact?: { name: string } | { size: number }, tags?: Array<string> | null }')
    expect(out).toContain('export type SiteItemRow = { id: string, name: string, onHand: number }')
    expect(out).toContain('"Site": SiteRow')
    expect(out).toContain('"SiteItem": SiteItemRow')
  })

  it('finds nothing without a schema', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.gql'), 'query GetSites { sites { id name } }')
    const docs = await loadDocuments(['*.gql'], dir, log())
    expect(docs.entities).toEqual({})
  })
})

describe('generateTypes', () => {
  async function docs() {
    const dir = await tempDir()
    await writeFile(join(dir, 'ops.gql'), `
      query GetSites($archived: Boolean) { sites(archived: $archived) { id name } }
      mutation RenameSite($id: ID!, $name: String!) { renameSite(id: $id, name: $name) { id } }
    `)
    return loadDocuments(['*.gql'], dir, log())
  }

  it('emits operation types and maps them onto the global interfaces', async () => {
    const out = await generateTypes(buildSchema(SDL), await docs())
    expect(out).toContain('export type GetSitesQuery = ')
    expect(out).toContain('export type GetSitesQueryVariables = ')
    expect(out).toContain('export type RenameSiteMutation = ')
    expect(out).toContain('"GetSites": { result: GetSitesQuery, variables: GetSitesQueryVariables }')
    expect(out).toContain('"RenameSite": { result: RenameSiteMutation, variables: RenameSiteMutationVariables }')
    expect(out).toContain(`declare module '#nuxt-airplane/documents'`)
    // ID is a string on the wire.
    expect(out).toMatch(/id: string/)
    expect(out).not.toMatch(/id: string \| number/)
  })

  it('passes codegen config through', async () => {
    const out = await generateTypes(buildSchema(SDL), await docs(), { scalars: { ID: 'number' } })
    expect(out).toMatch(/id: number/)
  })

  it('falls back to untyped maps without a schema', async () => {
    const out = await generateTypes(null, await docs())
    expect(out).toContain('[name: string]: { result: any, variables: any }')
    expect(out).toContain(`declare module '#nuxt-airplane/handlers'`)
  })
})

describe('loadSchema', () => {
  it('reads an SDL file and caches it', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'schema.graphql'), SDL)
    const schema = await loadSchema({ schema: join(dir, 'schema.graphql'), endpoint: '', cacheDir: join(dir, 'cache') }, log())
    expect(schema?.getType('Site')).toBeDefined()
    expect(await readFile(join(dir, 'cache/schema.graphql'), 'utf8')).toContain('type Site')
  })

  it('introspects a URL with the given headers', async () => {
    const introspection = graphqlSync({ schema: buildSchema(SDL), source: getIntrospectionQuery() })
    const fetch = vi.fn(async () => Response.json(introspection))
    vi.stubGlobal('fetch', fetch)
    const dir = await tempDir()

    const schema = await loadSchema({ endpoint: 'https://api.test/graphql', cacheDir: dir, headers: { Authorization: 'Bearer t' } }, log())
    expect(schema?.getMutationType()?.getFields().renameSite).toBeDefined()
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.test/graphql')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer t')
  })

  it('falls back to the cached schema when the endpoint is unreachable, and warns', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'schema.graphql'), SDL)
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('ECONNREFUSED')
    }))
    const logger = log()
    const schema = await loadSchema({ endpoint: 'https://down.test/graphql', cacheDir: dir }, logger)
    expect(schema?.getType('Site')).toBeDefined()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/Could not load GraphQL schema/))
  })

  it('returns null when nothing is available', async () => {
    const dir = await tempDir()
    expect(await loadSchema({ endpoint: '/relative', cacheDir: dir }, log())).toBeNull()
  })
})
