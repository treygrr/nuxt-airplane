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

  it('generates operation types from the SDL schema', async () => {
    const types = await built('types/nuxt-airplane.d.ts')
    expect(types).toContain('export type GetSitesQuery = ')
    expect(types).toContain('"ArchiveSite": { result: ArchiveSiteMutation, variables: ArchiveSiteMutationVariables }')
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
    expect(html).not.toContain('build-only-token')
  })
})
