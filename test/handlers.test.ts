import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importsProblems, movedOptions } from '../src/module'
import { declaresHandler, generateHandlerFiles, kebabCase } from '../src/scaffold'
import { DEFINE_HELPERS, defaultExportHelper, findUntaggedDefaultExport, mentionedTables } from '../src/handlers'

const reason = (source: string) => findUntaggedDefaultExport(source)?.reason ?? null

describe('findUntaggedDefaultExport', () => {
  it('accepts every define* helper, including awaited and multi-line calls', () => {
    for (const helper of DEFINE_HELPERS) {
      expect(reason(`export default ${helper}({})`)).toBeNull()
      expect(reason(`export default await ${helper}(\n  'GetSites',\n  { store() {} },\n)`)).toBeNull()
    }
  })

  it('accepts files without a default export and identifiers it cannot resolve', () => {
    expect(reason('export const siteName = () => 1')).toBeNull()
    expect(reason('const handlers = defineMutationHandlers({})\nexport default handlers')).toBeNull()
    expect(reason('export default registry.handlers')).toBeNull()
  })

  it('flags literals, functions and calls to anything else', () => {
    expect(reason('export default {\n  ArchiveSite: { apply() {} },\n}')).toBe('an object literal')
    expect(reason('export default [defineQueryHandler("A", {})]')).toBe('an array literal')
    expect(reason('export default () => ({})')).toBe('an arrow function')
    expect(reason('export default async ({ db }) => db')).toBe('an arrow function')
    expect(reason('export default function handlers() {}')).toBe('a function')
    expect(reason('export default class Handlers {}')).toBe('a class')
    expect(reason('export default new Map()')).toBe('a `new` expression')
    expect(reason('export default "nope"')).toBe('a literal value')
    expect(reason('export default createHandlers({})')).toBe('a call to `createHandlers()`')
    expect(reason('export default helpers.make({})')).toBe('a call to `helpers.make()`')
  })

  it('ignores comments and tolerates whitespace', () => {
    expect(reason('// export default {}\n/* export default [] */\nexport   default\n  defineAirplaneStores({ sites: "&id" })')).toBeNull()
    expect(reason('const url = "https://x.test" // not a comment start\nexport default { a: 1 }')).toBe('an object literal')
  })
})

describe('what a source file uses', () => {
  it('names the define* helper a file exports', () => {
    expect(defaultExportHelper('export default defineAirplaneRequest({ headers: () => ({}) })')).toBe('defineAirplaneRequest')
    expect(defaultExportHelper('// export default defineAirplaneRequest()\nexport default defineQueryHandler<\'GetSites\'>(\'GetSites\', {})')).toBe('defineQueryHandler')
    expect(defaultExportHelper('const handlers = defineMutationHandlers({})\nexport default handlers')).toBeUndefined()
    expect(defaultExportHelper('export default wrap(defineAirplaneRequest({}))')).toBeUndefined()
  })

  it('finds the inferred tables a handler file mentions, by name', () => {
    const names = ['Site', 'SiteItem', 'Item']
    expect(mentionedTables('store: ({ db }, data) => db.Site.bulkPut(data.sites)', names, true)).toEqual(['Site'])
    expect(mentionedTables('export default defineAirplaneStores({ SiteItem: \'siteId\' })', names, true)).toEqual(['SiteItem'])
    expect(mentionedTables('const { Item } = db\n// db.Site is not used', names, true)).toEqual(['Item'])
    expect(mentionedTables('type X = SiteRow; const mySite = 1', names, true)).toEqual([])
  })

  it('wants a table to be reached, not just named, outside the handlers directory', () => {
    const names = ['Site', 'Item']
    expect(mentionedTables('<h1>Site</h1><script setup>const Item = 1</script>', names, false)).toEqual([])
    expect(mentionedTables('const rows = await useAirplane().db.Site.toArray()', names, false)).toEqual(['Site'])
    expect(mentionedTables('db.table("Item").count(); db.table(`Site`)', names, false)).toEqual(['Site', 'Item'])
  })
})

describe('module options', () => {
  it('takes new names for the composables, and refuses unknown ones, invalid names and clashes', () => {
    expect(importsProblems({})).toEqual([])
    expect(importsProblems({ useAirplaneQuery: 'useQuery', useOnlineQuery: 'useRemoteQuery' })).toEqual([])
    expect(importsProblems({ defineQueryHandler: 'defineQuery' })).toEqual([expect.stringMatching(/defineQueryHandler: not a composable of the module/)])
    expect(importsProblems({ useSync: 'use-sync' })).toEqual([expect.stringMatching(/useSync: "use-sync" is not a name/)])
    expect(importsProblems({ useAirplaneQuery: 'useMutation' })).toEqual([expect.stringMatching(/useMutation and useAirplaneQuery would both be imported as useMutation/)])
    // Swapping two names is fine.
    expect(importsProblems({ useAirplaneQuery: 'useOnlineQuery', useOnlineQuery: 'useAirplaneQuery' })).toEqual([])
  })

  it('names every option still under its old name, with where it went', () => {
    expect(movedOptions({ endpoint: '/api/graphql', schema: { source: './schema.graphql' }, handlers: { dir: 'airplane' }, database: {} })).toEqual([])
    expect(movedOptions({ schema: './schema.graphql', schemaHeaders: {}, handlersDir: 'x', generateHandlers: true, worker: false, dbName: 'app', cacheKey: 'v1' })).toEqual([
      `  schema: '…' → schema: { source: '…' }`,
      '  schemaHeaders → schema.headers',
      '  handlersDir → handlers.dir',
      '  generateHandlers → handlers.generate',
      '  worker → handlers.worker',
      '  dbName → database.name',
      '  cacheKey → database.cacheKey',
    ])
  })
})

describe('handlers.generate', () => {
  const ops = [
    { name: 'GetSites', kind: 'query' as const, source: 'query GetSites {\n  sites { id name }\n}' },
    { name: 'RenameSite', kind: 'mutation' as const, source: 'mutation RenameSite($id: ID!, $name: String!) { renameSite(id: $id, name: $name) { id } }' },
    { name: 'ArchiveSite', kind: 'mutation' as const, source: 'mutation ArchiveSite($id: ID!) { archiveSite(id: $id) { id } }' },
    { name: 'SendHTTPPing', kind: 'mutation' as const, source: 'mutation SendHTTPPing { ping }' },
    { name: 'OnSiteChanged', kind: 'subscription' as const, source: 'subscription OnSiteChanged { siteChanged { id } }' },
  ]
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'airplane-scaffold-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))
  const list = async () => (await readdir(dir, { recursive: true })).filter(f => f.endsWith('.ts')).sort()

  it('names files after the operation', () => {
    expect(kebabCase('UpdateSiteItemOnHand')).toBe('update-site-item-on-hand')
    expect(kebabCase('SendHTTPPing')).toBe('send-http-ping')
    expect(kebabCase('get_sites')).toBe('get-sites')
  })

  it('tells a declared handler from a name that is only referred to', () => {
    expect(declaresHandler(`export default defineQueryHandler('GetSites', {})`, 'GetSites')).toBe(true)
    expect(declaresHandler(`export default defineMutationHandler<'RenameSite'>(\n  "RenameSite", {})`, 'RenameSite')).toBe(true)
    expect(declaresHandler(`export default defineQueryHandlers({ GetSites: { read() {} } })`, 'GetSites')).toBe(true)
    expect(declaresHandler(`export default defineMutationHandlers({\n  'RenameSite': {},\n})`, 'RenameSite')).toBe(true)
    expect(declaresHandler(`export default defineMutationHandler('ArchiveSite', { refetch: ['GetSites'] })`, 'GetSites')).toBe(false)
    expect(declaresHandler(`// GetSites: handled elsewhere\nexport default defineQueryHandler('GetSite', {})`, 'GetSites')).toBe(false)
  })

  it('writes a file with empty hooks for each query and mutation, and none for a subscription', async () => {
    const { written, behindIndex } = await generateHandlerFiles(dir, ops)
    expect(await list()).toEqual(['mutations/archive-site.ts', 'mutations/rename-site.ts', 'mutations/send-http-ping.ts', 'queries/get-sites.ts'])
    expect(written).toHaveLength(4)
    expect(behindIndex).toEqual([])

    const mutation = await readFile(join(dir, 'mutations/rename-site.ts'), 'utf8')
    expect(mutation).toContain(`export default defineMutationHandler('RenameSite', {`)
    expect(mutation).toContain('//   mutation RenameSite($id: ID!, $name: String!)')
    expect(mutation).toMatch(/apply\(\) \{\s*\},/)
    expect(mutation).toMatch(/reconcile\(\) \{\s*\},/)
    expect(findUntaggedDefaultExport(mutation)).toBeNull()

    const query = await readFile(join(dir, 'queries/get-sites.ts'), 'utf8')
    expect(query).toContain(`export default defineQueryHandler('GetSites', {`)
    expect(query).toContain('//   query GetSites {\n//     sites { id name }\n//   }')
    expect(query).toMatch(/store\(\) \{\s*\},/)
    expect(query).toMatch(/read\(\) \{\s*return null\s*\},/)
    expect(query).toContain('// For a result with no `id`, `store: \'result\'` keeps it whole and needs no `read`.')
  })

  it('leaves alone what has a handler, wherever it is declared, and never overwrites a file', async () => {
    await mkdir(join(dir, 'mutations'), { recursive: true })
    await writeFile(join(dir, 'everything.ts'), `export default defineMutationHandlers({ RenameSite: { apply() {} } })`)
    // Same file name as the scaffold would use, but about something else.
    await writeFile(join(dir, 'mutations/archive-site.ts'), 'export const mine = true\n')
    const { written } = await generateHandlerFiles(dir, ops)
    expect(written.map(f => f.slice(dir.length + 1))).toEqual(['queries/get-sites.ts', 'mutations/send-http-ping.ts'])
    expect(await readFile(join(dir, 'mutations/archive-site.ts'), 'utf8')).toBe('export const mine = true\n')

    // A second run has nothing left to do, and edits made since are kept.
    await writeFile(join(dir, 'queries/get-sites.ts'), `export default defineQueryHandler('GetSites', { read: () => null })\n`)
    expect((await generateHandlerFiles(dir, ops)).written).toEqual([])
    expect(await readFile(join(dir, 'queries/get-sites.ts'), 'utf8')).toContain('read: () => null')
  })

  it('says when a new file sits behind an index that has to export it', async () => {
    await mkdir(join(dir, 'queries'), { recursive: true })
    await writeFile(join(dir, 'queries/index.ts'), 'export default defineQueryHandlers({})\n')
    const { behindIndex } = await generateHandlerFiles(dir, ops)
    expect(behindIndex).toEqual([join(dir, 'queries')])
  })
})
