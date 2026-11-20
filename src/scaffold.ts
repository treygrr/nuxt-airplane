// `handlers.generate`: a handler file, with its hooks in place and their
// bodies empty, for every operation that has none yet.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { glob } from 'tinyglobby'
import type { OperationDocument } from './runtime/types'

/** `UpdateSiteItemOnHand` → `update-site-item-on-hand`, `SendHTTPRequest` → `send-http-request`. */
export function kebabCase(name: string) {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[_\s]+/g, '-')
    .toLowerCase()
}

/** Drops block comments and whole-line / trailing `//` comments (not `://` in URLs). */
function stripComments(source: string) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

/**
 * Whether a handler file declares a handler for an operation: as the first
 * argument of `defineMutationHandler` / `defineQueryHandler`, or as a key of
 * the object given to the plural helpers. A name that is only referred to,
 * as in `refetch: ['GetSites']`, does not count.
 */
export function declaresHandler(source: string, name: string) {
  const code = stripComments(source)
  const word = name.replace(/\$/g, '\\$&')
  return new RegExp(`define(?:Mutation|Query)Handler\\s*(?:<[^()]*>\\s*)?\\(\\s*['"\`]${word}['"\`]`).test(code)
    || new RegExp(`(?<![\\w$.])(?:${word}|['"\`]${word}['"\`]|\\[\\s*['"\`]${word}['"\`]\\s*\\])\\s*:`).test(code)
}

/** The operation's text as a comment, so the variables and the selection are in view while writing the hooks. */
function documentComment(source: string) {
  return source.trim().split('\n').map(line => `//   ${line}`.trimEnd().replace(/\*\//g, '* /')).join('\n')
}

const HEADER = '// Scaffolded by nuxt-airplane (`handlers.generate`). The file is yours: fill it in, change it, it is never overwritten.'

/** The contents of a scaffolded handler file for one operation, or nothing for a subscription. */
export function scaffoldHandler(op: Pick<OperationDocument, 'name' | 'kind' | 'source'>): string | undefined {
  const head = [HEADER, '//', documentComment(op.source), ''].join('\n')
  if (op.kind === 'mutation') {
    return `${head}
export default defineMutationHandler('${op.name}', {
  // Runs as soon as the mutation is queued: change the tables so the UI shows it at once.
  // Receives { db, result, variables, local, tempId }.
  apply() {

  },

  // Runs with the server's answer: write what it assigned (ids, timestamps) into the tables.
  // Receives { db, result, variables, local, tempIds, resolve } and the result.
  reconcile() {

  },
})
`
  }
  if (op.kind === 'query') {
    return `${head}
export default defineQueryHandler('${op.name}', {
  // For a result with no \`id\`, \`store: 'result'\` keeps it whole and needs no \`read\`.
  // Writes a response into the tables.
  // Receives { db, result, variables } and the data.
  store() {

  },

  // Builds the query's result from the tables: what \`useAirplaneQuery('${op.name}')\` returns, online or not.
  // Receives { db, result, variables, local }. Until it returns something, the query has nothing to show.
  read() {
    return null
  },
})
`
  }
}

export interface GenerateHandlersResult {
  /** Files written, absolute. */
  written: string[]
  /** Folders with an `index` file that got a new file: the index has to export it for it to be picked up. */
  behindIndex: string[]
}

/**
 * Writes a scaffolded handler file for every query and mutation that no file
 * in `dir` declares a handler for: `mutations/<name>.ts` or
 * `queries/<name>.ts`. A file that exists is left alone, whatever is in it.
 */
export async function generateHandlerFiles(dir: string, operations: Pick<OperationDocument, 'name' | 'kind' | 'source'>[]): Promise<GenerateHandlersResult> {
  const files = await glob(['**/*.{ts,js,mts,mjs}'], { cwd: dir, absolute: true })
  const sources = await Promise.all(files.map(file => readFile(file, 'utf8').catch(() => '')))
  const result: GenerateHandlersResult = { written: [], behindIndex: [] }
  for (const op of operations) {
    const contents = scaffoldHandler(op)
    if (!contents || sources.some(source => declaresHandler(source, op.name))) continue
    const folder = join(dir, op.kind === 'mutation' ? 'mutations' : 'queries')
    const file = join(folder, `${kebabCase(op.name)}.ts`)
    // Taken by something else: not ours to replace.
    if (files.some(existing => dirname(existing) === folder && basename(existing).replace(/\.[^.]+$/, '') === kebabCase(op.name))) continue
    await mkdir(folder, { recursive: true })
    await writeFile(file, contents, { flag: 'wx' }).then(() => result.written.push(file), () => {})
    if (files.some(existing => dirname(existing) === folder && /^index\.[mc]?[tj]s$/.test(basename(existing))) && !result.behindIndex.includes(folder)) result.behindIndex.push(folder)
  }
  return result
}
