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

  it('infers an entity table per type selected with an id, with its row type', async () => {
    const source = await built('nuxt-airplane/documents.mjs')
    expect(source).not.toContain('__typename')
    expect(source).toContain('export const entities = {"Site":{"key":"id"}}')
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
  })

  it('ships the public options in the payload and keeps the build-time ones out', async () => {
    const html = await $fetch('/')
    expect(html).toContain('/api/graphql')
    expect(html).toContain('fixture-1')
    expect(html).toContain('automatic')
    expect(html).not.toContain('build-only-token')
  })
})
