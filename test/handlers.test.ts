import { describe, expect, it } from 'vitest'
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
