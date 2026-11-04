import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { codegen } from '@graphql-codegen/core'
import * as typescriptPlugin from '@graphql-codegen/typescript'
import * as typescriptOperationsPlugin from '@graphql-codegen/typescript-operations'
import {
  Kind,
  TypeInfo,
  buildClientSchema,
  buildSchema,
  getIntrospectionQuery,
  getNamedType,
  isEnumType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  parse,
  print,
  printSchema,
  visit,
  visitWithTypeInfo,
  type DocumentNode,
  type FragmentDefinitionNode,
  type GraphQLOutputType,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
} from 'graphql'
import { glob } from 'tinyglobby'
import type { EntityInfo, OperationDocument } from './runtime/types'

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
  /** Headers for the introspection request. */
  headers?: Record<string, string>
}

function isUrl(value: string) {
  return /^https?:\/\//.test(value)
}

async function introspect(url: string, headers: Record<string, string> = {}, attempts = 10): Promise<GraphQLSchema> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query: getIntrospectionQuery() }),
    signal: AbortSignal.timeout(15_000),
  })
  // A dev server that is still booting answers 503; give it a moment.
  if (res.status === 503 && attempts > 1) {
    await new Promise(r => setTimeout(r, 1000))
    return introspect(url, headers, attempts - 1)
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
      if (isUrl(url)) schema = await introspect(url, source.headers)
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
  /**
   * Object types selected with their `id` somewhere in the documents, keyed by
   * typename: each gets a table. Empty without a schema.
   */
  entities: Record<string, EntityInfo>
  /** Row fields per entity, for the generated types: TS type and whether every selection includes it. */
  rows: Record<string, Record<string, { ts: string, required: boolean }>>
}

/** Whether an object type gets a table: it has an `id` field of type `ID`. */
function hasIdField(type: unknown) {
  if (!isObjectType(type)) return false
  const id = type.getFields().id
  return !!id && getNamedType(id.type).name === 'ID'
}

const SCALARS: Record<string, string> = { ID: 'string', String: 'string', Int: 'number', Float: 'number', Boolean: 'boolean' }

/** The TypeScript type of a stored field: scalars mapped, other entities as their row type, the rest as the generated type. */
function rowFieldType(type: GraphQLOutputType, entities: Set<string>): string {
  if (isNonNullType(type)) return rowFieldType(type.ofType, entities).replace(/ \| null$/, '')
  const inner = isListType(type)
    ? `Array<${rowFieldType(type.ofType, entities)}>`
    : isScalarType(type)
      ? SCALARS[type.name] ?? `Scalars['${type.name}']['output']`
      : isEnumType(type)
        ? type.name
        : entities.has(type.name) ? `${type.name}Row` : type.name
  return `${inner} | null`
}

/**
 * Finds the types the documents select with an id, which each get a table,
 * and the fields stored for each. A selection set on an object type with an
 * `id: ID` field, that selects `id`, counts; the row type gets the union of
 * the fields of every such selection, required when all of them have it.
 */
function analyzeEntities(schema: GraphQLSchema, documentNodes: DocumentNode[], fragments: Map<string, FragmentDefinitionNode>) {
  const seen = new Map<string, { selections: number, fields: Map<string, number> }>()

  /** Field names of a selection set, following spreads and inline fragments. */
  function fieldsOf(set: SelectionSetNode, into = new Set<string>()): Set<string> {
    for (const s of set.selections) {
      if (s.kind === Kind.FIELD) into.add(s.name.value)
      else if (s.kind === Kind.INLINE_FRAGMENT) fieldsOf(s.selectionSet, into)
      else if (s.kind === Kind.FRAGMENT_SPREAD) {
        const fragment = fragments.get(s.name.value)
        if (fragment) fieldsOf(fragment.selectionSet, into)
      }
    }
    return into
  }

  for (const doc of documentNodes) {
    const typeInfo = new TypeInfo(schema)
    visit(doc, visitWithTypeInfo(typeInfo, {
      SelectionSet(node) {
        const type = getNamedType(typeInfo.getType())
        if (!hasIdField(type)) return
        const fields = fieldsOf(node)
        if (!fields.has('id')) return
        const entry = seen.get(type!.name) ?? { selections: 0, fields: new Map() }
        entry.selections++
        for (const f of fields) entry.fields.set(f, (entry.fields.get(f) ?? 0) + 1)
        seen.set(type!.name, entry)
      },
    }))
  }

  const entities: Record<string, EntityInfo> = {}
  const rows: LoadedDocuments['rows'] = {}
  const names = new Set(seen.keys())
  for (const [name, entry] of seen) {
    entities[name] = { key: 'id' }
    const type = schema.getType(name)
    if (!isObjectType(type)) continue
    const schemaFields = type.getFields()
    rows[name] = {}
    for (const [field, count] of entry.fields) {
      if (field === '__typename') continue
      const def = schemaFields[field]
      if (!def) continue
      rows[name][field] = { ts: rowFieldType(def.type, names), required: field === 'id' || count === entry.selections }
    }
  }
  return { entities, rows }
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
  schema: GraphQLSchema | null = null,
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
    // What is sent asks for `__typename` everywhere, so responses can be split into tables.
    const source = print(documentNode)
    operations[name] = { name, kind: node.operation, source, hash: createHash('sha256').update(source).digest('hex') }
  }

  const { entities, rows } = schema ? analyzeEntities(schema, documentNodes, fragments) : { entities: {}, rows: {} }
  return { operations, documentNodes, files, entities, rows }
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
  export const documents: Record<string, { name: string, kind: 'query' | 'mutation' | 'subscription', source: string, hash: string }>
  export const documentsHash: string
  export const entities: Record<string, { key: string }>
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

  // One row type per entity table, and the global map that types `db.<Typename>`.
  const rowTypes = Object.entries(docs.rows).map(([name, fields]) => {
    const members = Object.entries(fields).map(([field, { ts, required }]) => `${field}${required ? '' : '?'}: ${ts}`)
    return `export type ${name}Row = { ${members.join(', ')} }`
  })
  const storesMap = Object.keys(docs.rows).map(name => `    ${JSON.stringify(name)}: ${name}Row`).join('\n')

  return [
    '// Generated by nuxt-airplane from your GraphQL documents. Do not edit.',
    generated,
    ...rowTypes,
    'declare global {',
    '  interface NuxtAirplaneQueries {',
    operationMap(ops, 'query', 'Query'),
    '  }',
    '  interface NuxtAirplaneMutations {',
    operationMap(ops, 'mutation', 'Mutation'),
    '  }',
    '  interface NuxtAirplaneStores {',
    storesMap,
    '  }',
    '}',
    virtualModules,
  ].join('\n')
}
