// The module inside a real Nuxt app: templates, generated types, the
// handlers-directory rules and the auto-imported composables.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { setup, $fetch, useTestContext } from '@nuxt/test-utils/e2e'

const fixture = fileURLToPath(new URL('./fixtures/basic', import.meta.url))

/** A generated file from the build directory test-utils used for this run. */
const built = (path: string) => readFile(join(useTestContext().nuxt!.options.buildDir, path), 'utf8')

describe('module', async () => {
  await setup({ rootDir: fixture })

  it('renders a page that uses the composables during SSR', async () => {
    const html = await $fetch('/')
    expect(html).toContain('<div>basic</div>')
    // Server-side placeholders: online, synced, nothing pending, no data yet.
    expect(html).toContain('online:true')
    expect(html).toContain('synced:true')
    expect(html).toContain('pending:0')
    expect(html).toContain('loading:true')
  })

  it('answers an online query while rendering, with the app\'s request options and the visitor\'s cookies', async () => {
    const before = (await $fetch<{ count: number }>('/api/requests')).count
    const html = await $fetch<string>('/', { headers: { cookie: 'token=t1; visitor=v1' } })
    // `defineAirplaneRequest` ran on the server (`useCookie` read the token) and the visitor's cookie was forwarded.
    expect(html).toContain('live:auth=t1;cookie=v1')
    expect(html).toContain('live-fetching:false')
    // The answer travels in the page, so the browser starts from it.
    expect(html).toMatch(/airplane:GetSites:/)
    // Off: rendered as not fetching, and nothing sent for it. One request, the live one.
    expect(html).toContain('off-fetching:false')
    expect((await $fetch<{ count: number }>('/api/requests')).count - before).toBe(1)
  })

  it('auto-imports a composable under the name the `imports` option gives it', async () => {
    const imports = await built('imports.d.ts')
    expect(imports).toMatch(/useSync as useAirplaneSync/)
    // Not under its own name as well (the file path still says `useSync`).
    expect(imports).not.toMatch(/[{,]\s*useSync\s*[,}]/)
    // And the page that calls it under that name renders.
    expect(await $fetch<string>('/')).toContain('synced:true')
  })

  it('auto-imports isTempId, free of IndexedDB, so it runs during SSR', async () => {
    const imports = await built('imports.d.ts')
    expect(imports).toMatch(/[{,]\s*isTempId\s*[,}][^\n]*runtime\/composables\/isTempId/)
    expect(imports).toMatch(/[{,]\s*hasFields\s*[,}][^\n]*runtime\/composables\/hasFields/)
    // The page calls it on a row the server sent: a real id.
    expect(await $fetch<string>('/')).toContain('live-temp:false')
  })

  it('gives the server only the request files, and the browser all of them', async () => {
    const request = await built('nuxt-airplane/request.mjs')
    expect(request).toContain('airplane/request.ts')
    expect(request).not.toContain('airplane/mutations/archive-site.ts')
    expect(request).not.toContain('airplane/stores.ts')
    expect(await built('nuxt-airplane/handlers.mjs')).toContain('airplane/request.ts')
    expect(await built('nuxt-airplane-worker/entry.mjs')).not.toContain('airplane/request.ts')
  })

  it('compiles the documents with their fragments', async () => {
    const source = await built('nuxt-airplane/documents.mjs')
    expect(source).toContain('"GetSites"')
    expect(source).toContain('"ArchiveSite"')
    expect(source).toMatch(/fragment SiteFields on Site/)
    expect(source).toMatch(/export const documentsHash = "[\w-]+"/)
  })

  it('writes the persisted query manifest and ships the hashes', async () => {
    const manifest = JSON.parse(await built('nuxt-airplane/persisted-queries.json')) as { format: string, operations: { id: string, name: string, type: string, body: string }[] }
    expect(manifest.format).toBe('apollo-persisted-query-manifest')
    const getSites = manifest.operations.find(op => op.name === 'GetSites')!
    expect(getSites).toMatchObject({ type: 'query' })
    expect(getSites.id).toMatch(/^[0-9a-f]{64}$/)
    expect(getSites.body).toContain('fragment SiteFields')
    expect(await built('nuxt-airplane/documents.mjs')).toContain(`"hash": "${getSites.id}"`)
  })

  it('generates operation types from the SDL schema', async () => {
    const types = await built('types/nuxt-airplane.d.ts')
    expect(types).toContain('export type GetSitesQuery = ')
    expect(types).toContain('"ArchiveSite": { result: ArchiveSiteMutation, variables: ArchiveSiteMutationVariables }')
  })

  it('infers an entity table per type selected with an id, with its row type, and creates the ones the app uses', async () => {
    const source = await built('nuxt-airplane/documents.mjs')
    expect(source).not.toContain('__typename')
    // The fixture keeps its sites in a table of its own and never reaches `db.Site`.
    expect(source).toContain('export const entities = {}')
    expect(source).toContain('export const unusedEntities = ["Site"]')
  })

  it('writes the database schema to the build directory and to the schema file', async () => {
    const schema = await built('nuxt-airplane/schema.ts')
    // The fixture's own table, from its defineAirplaneStores file, and the module's.
    expect(schema).toContain('sites: \'&id, archived\', // airplane/stores.ts')
    expect(schema).toContain('mutations: \'++id, status, createdAt, document, unkeyed, *rows, *creates, *writes, *tempIds\',')
    expect(schema).toContain('export const unused = [\'Site\'] as const')
    expect(schema).toContain('export const version = 1')
    expect(await readFile(join(fixture, 'app/airplane.schema.ts'), 'utf8')).toBe(schema)
  })

  it('builds a worker with the handler files that write, by default', async () => {
    expect(await built('nuxt-airplane/worker.mjs')).toContain('nuxt-airplane-worker/entry.mjs?worker')
    const entry = await built('nuxt-airplane-worker/entry.mjs')
    expect(entry).toContain('airplane/mutations/archive-site.ts')
    expect(entry).toContain('airplane/queries/index.ts')
    expect(entry).toContain('startWorker([')
    const types = await built('types/nuxt-airplane.d.ts')
    expect(types).toContain('export type SiteRow = { id: string, name: string, archived: boolean }')
    expect(types).toContain('"Site": SiteRow')
  })

  it('imports handler files, honoring index folders', async () => {
    const handlers = await built('nuxt-airplane/handlers.mjs')
    expect(handlers).toContain('airplane/stores.ts')
    expect(handlers).toContain('airplane/mutations/archive-site.ts')
    // queries/ has an index: only the index is imported, not the pieces beside it.
    expect(handlers).toContain('airplane/queries/index.ts')
    expect(handlers).not.toContain('airplane/queries/get-sites.ts')
    // A file with no default export is imported as a namespace: its missing default is undefined, not a link error.
    expect(handlers).toMatch(/import \* as h\d+ from ".*airplane\/helpers\.ts"/)
    expect(handlers).toMatch(/export const handlers = \[(h\d+\.default(, )?)+\]/)
  })

  it('ships the public options in the payload and keeps the build-time ones out', async () => {
    const html = await $fetch('/')
    expect(html).toContain('/api/graphql')
    expect(html).toContain('fixture-1')
    expect(html).toContain('automatic')
    expect(html).not.toContain('build-only-token')
  })
})
