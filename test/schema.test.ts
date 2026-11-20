// The database schema written at build time: the same merge the runtime
// does, grouped by where each table comes from.
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadStoreFiles, renderSchema, type StoreFile } from '../src/schema'
import { MODULE_STORES, mergeStores } from '../src/runtime/stores'

describe('renderSchema', () => {
  const entities = { Site: { key: 'id' }, SiteItem: { key: 'id' } }
  const storeFiles: StoreFile[] = [
    { file: '/app/airplane/stores.ts', stores: { Site: 'name', drafts: '++id, siteId' } },
    { file: '/app/airplane/more/stores.ts', stores: { SiteItem: 'id, siteId' }, version: 3 },
  ]
  const text = renderSchema({ entities, unusedEntities: ['Owner'], storeFiles, root: '/app' })

  it('writes what the runtime opens, table by table', () => {
    const merged = { ...MODULE_STORES, ...mergeStores(entities, { Site: 'name', drafts: '++id, siteId', SiteItem: 'id, siteId' }) }
    for (const [name, spec] of Object.entries(merged)) expect(text).toContain(`${name}: '${spec}',`)
  })

  it('says where each table comes from', () => {
    expect(text).toContain('Site: \'&id, name\', // indexes from airplane/stores.ts')
    expect(text).toContain('SiteItem: \'&id, siteId\', // indexes from airplane/more/stores.ts')
    expect(text).toContain('drafts: \'++id, siteId\', // airplane/stores.ts')
    // An inferred table with nothing declared on it has no note.
    expect(renderSchema({ entities, unusedEntities: [], storeFiles: [], root: '/app' })).toMatch(/ {2}Site: '&id',\n/)
  })

  it('takes the highest version, and lists the tables left out', () => {
    expect(text).toContain('export const version = 3')
    expect(text).toContain('export const unused = [\'Owner\'] as const')
  })

  it('quotes a table name that is not an identifier', () => {
    expect(renderSchema({ entities: {}, unusedEntities: [], storeFiles: [{ file: '/a/s.ts', stores: { 'my-table': '++id' } }], root: '/a' })).toContain('\'my-table\': \'++id\',')
  })

  it('names a store file it could not load', () => {
    expect(renderSchema({ entities, unusedEntities: [], storeFiles: [], failed: [{ file: '/app/airplane/broken.ts', error: 'boom' }], root: '/app' }))
      .toContain('//   airplane/broken.ts: boom')
  })
})

describe('loadStoreFiles', () => {
  it('runs the defineAirplaneStores files, with their imports, and leaves the others alone', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nuxt-airplane-schema-'))
    await mkdir(join(dir, 'airplane'))
    await writeFile(join(dir, 'shared.ts'), `export const INDEX = 'siteId'\n`)
    await writeFile(join(dir, 'airplane/stores.ts'), `import { INDEX } from '~/shared'\nexport default defineAirplaneStores({ drafts: \`++id, \${INDEX}\` }, { version: 2 })\n`)
    await writeFile(join(dir, 'airplane/handlers.ts'), `throw new Error('a handler file must not be run')\nexport default defineMutationHandlers({})\n`)
    await writeFile(join(dir, 'airplane/broken.ts'), `import { nothing } from '~/missing'\nexport default defineAirplaneStores({ x: nothing })\n`)

    const { loaded, failed } = await loadStoreFiles(
      ['stores.ts', 'handlers.ts', 'broken.ts'].map(f => join(dir, 'airplane', f)),
      { '~': dir },
    )
    expect(loaded).toEqual([{ file: join(dir, 'airplane/stores.ts'), stores: { drafts: '++id, siteId' }, version: 2 }])
    expect(failed.map(f => f.file)).toEqual([join(dir, 'airplane/broken.ts')])
    // The helper was a global only while the files loaded.
    expect('defineAirplaneStores' in globalThis).toBe(false)
  })
})
