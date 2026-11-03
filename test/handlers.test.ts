import { describe, expect, it } from 'vitest'
import { DEFINE_HELPERS, findUntaggedDefaultExport } from '../src/handlers'

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
