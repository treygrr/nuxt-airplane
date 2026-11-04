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
