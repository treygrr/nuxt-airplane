import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { codegen } from '@graphql-codegen/core'
import * as typescriptPlugin from '@graphql-codegen/typescript'
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations'
import {
  Kind,
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  parse,
  print,
  printSchema,
  visit,
  type DocumentNode,
  type FragmentDefinitionNode,
  type GraphQLSchema,
  type OperationDefinitionNode,
} from 'graphql'
import { glob } from 'tinyglobby'
import type { OperationDocument } from './runtime/types'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export interface SchemaSource {
  /** SDL file or URL. */
  schema?: string
  /** GraphQL endpoint to introspect when no `schema` is given. */
  endpoint: string
  /** Where the last good schema is cached for builds with no server running. */
  cacheDir: string
}

function isUrl(value: string) {
  return /^https?:\/\//.test(value)
}

async function introspect(url: string, attempts = 10): Promise<GraphQLSchema> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
    signal: AbortSignal.timeout(15_000),
  })
  // A dev server that is still booting answers 503; give it a moment.
  if (res.status === 503 && attempts > 1) {
    await new Promise(r => setTimeout(r, 1000))
    return introspect(url, attempts - 1)
  }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  const body = await res.json()
  if (body.errors?.length) throw new Error(body.errors.map((e: { message: string }) => e.message).join(', '))
  return buildClientSchema(body.data)
}

/**
 * Resolves the schema from a file, a URL, the endpoint (introspection) or the
 * on-disk cache, in that order. Returns `null` when none of them work.
 */
export async function loadSchema(source: SchemaSource, log: { warn: (msg: string) => void }): Promise<GraphQLSchema | null> {
  const cacheFile = join(source.cacheDir, 'schema.graphql')
  let schema: GraphQLSchema | null = null

  try {
    if (source.schema && !isUrl(source.schema)) {
      schema = buildSchema(await readFile(source.schema, 'utf8'))
    }
    else {
      const url = source.schema ?? source.endpoint
      if (isUrl(url)) schema = await introspect(url)
    }
  }
  catch (error) {
    log.warn(`Could not load GraphQL schema: ${(error as Error).message}`)
  }

  if (schema) {
    await mkdir(dirname(cacheFile), { recursive: true })
    await writeFile(cacheFile, printSchema(schema))
  }
  else if (existsSync(cacheFile)) {
    schema = buildSchema(await readFile(cacheFile, 'utf8'))
  }
  return schema
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface LoadedDocuments {
  operations: Record<string, OperationDocument>
  /** Every operation with the fragments it needs, for codegen. */
  documentNodes: DocumentNode[]
  files: string[]
}

function fragmentSpreads(node: OperationDefinitionNode | FragmentDefinitionNode) {
  const names = new Set<string>()
  visit(node, { FragmentSpread: s => void names.add(s.name.value) })
  return names
}

export async function loadDocuments(
  patterns: string[],
  cwd: string,
  log: { warn: (msg: string) => void },
): Promise<LoadedDocuments> {
  const files = (await glob(patterns, { cwd, absolute: true, ignore: ['**/node_modules/**'] })).sort()
  const fragments = new Map<string, FragmentDefinitionNode>()
  const ops: { node: OperationDefinitionNode, file: string }[] = []

  for (const file of files) {
    let doc: DocumentNode
    try {
      doc = parse(await readFile(file, 'utf8'))
    }
    catch (error) {
      log.warn(`Skipping ${file}: ${(error as Error).message}`)
      continue
    }
    for (const def of doc.definitions) {
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def)
      else if (def.kind === Kind.OPERATION_DEFINITION) {
        if (!def.name) log.warn(`Skipping anonymous ${def.operation} in ${file}: operations must be named`)
        else ops.push({ node: def, file })
      }
    }
  }

  const operations: Record<string, OperationDocument> = {}
  const documentNodes: DocumentNode[] = []

  for (const { node, file } of ops) {
    const name = node.name!.value
    if (operations[name]) {
      log.warn(`Duplicate operation "${name}" in ${file}, keeping the first one`)
      continue
    }
    // Pull in the fragments the operation spreads, recursively.
    const needed = new Map<string, FragmentDefinitionNode>()
    const queue = [...fragmentSpreads(node)]
    while (queue.length) {
      const spread = queue.shift()!
      if (needed.has(spread)) continue
      const fragment = fragments.get(spread)
      if (!fragment) {
        log.warn(`Operation "${name}" spreads unknown fragment "${spread}"`)
        continue
      }
      needed.set(spread, fragment)
      queue.push(...fragmentSpreads(fragment))
    }
    const documentNode: DocumentNode = { kind: Kind.DOCUMENT, definitions: [node, ...needed.values()] }
    documentNodes.push(documentNode)
    operations[name] = { name, kind: node.operation, source: print(documentNode) }
  }

  return { operations, documentNodes, files }
}

// ---------------------------------------------------------------------------
// Type generation
// ---------------------------------------------------------------------------

function operationMap(ops: OperationDocument[], kind: OperationDocument['kind'], suffix: string) {
  return ops
    .filter(op => op.kind === kind)
    .map(op => `    ${JSON.stringify(op.name)}: { result: ${op.name}${suffix}, variables: ${op.name}${suffix}Variables }`)
    .join('\n')
}

/**
 * Builds the `.d.ts` that types every operation and augments the global
 * `NuxtAirplaneQueries` / `NuxtAirplaneMutations` maps the composables key off.
 */
const virtualModules = `
declare module '#nuxt-airplane/documents' {
  export const documents: Record<string, { name: string, kind: 'query' | 'mutation' | 'subscription', source: string }>
  export const documentsHash: string
}
declare module '#nuxt-airplane/handlers' {
  export const handlers: unknown[]
}
`

export async function generateTypes(
  schema: GraphQLSchema | null,
  docs: LoadedDocuments,
  config: Record<string, unknown> = {},
): Promise<string> {
  const ops = Object.values(docs.operations)

  if (!schema) {
    // No schema available: keep the composables usable, just untyped.
    return [
      '// Generated by nuxt-airplane. No GraphQL schema could be loaded, so operations are untyped.',
      'export {}',
      'declare global {',
      '  interface NuxtAirplaneQueries { [name: string]: { result: any, variables: any } }',
      '  interface NuxtAirplaneMutations { [name: string]: { result: any, variables: any } }',
      '}',
      virtualModules,
    ].join('\n')
  }

  const generated = await codegen({
    filename: 'nuxt-airplane.ts',
    schema: parse(printSchema(schema)),
    documents: docs.documentNodes.map(document => ({ document })),
    config: {
      namingConvention: 'keep',
      // `ID` comes back as a string over the wire; typing it as such keeps variables simple.
      scalars: { ID: { input: 'string', output: 'string' } },
      ...config,
    },
    plugins: [{ typescript: {} }, { typescriptOperations: {} }],
    pluginMap: { typescript: typescriptPlugin, typescriptOperations: typescriptOperationsPlugin },
  })

  return [
    '// Generated by nuxt-airplane from your GraphQL documents. Do not edit.',
    generated,
    'declare global {',
    '  interface NuxtAirplaneQueries {',
    operationMap(ops, 'query', 'Query'),
    '  }',
    '  interface NuxtAirplaneMutations {',
    operationMap(ops, 'mutation', 'Mutation'),
    '  }',
    '}',
    virtualModules,
  ].join('\n')
}
