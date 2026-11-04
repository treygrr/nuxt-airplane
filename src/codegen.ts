import { createHash } from 'node:crypto'
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
  getNamedType,
  isAbstractType,
  isEnumType,
  isInterfaceType,
  isListType,
  isNonNullType,
  isObjectType,
  isScalarType,
  parse,
  print,
  printSchema,
  visit,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLNamedType,
  type GraphQLOutputType,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionNode,
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

/**
 * A selection set merged across every place it was selected: how many times,
 * and for each field (by response key) how many of those selected it, its
 * schema type and, for an object field, the merged selection below it.
 */
interface MergedSelection {
  /** Occurrences that count towards a field being required: node selections, not navigation ones. */
  selections: number
  fields: Map<string, { count: number, type: GraphQLOutputType, sub: MergedSelection | null }>
  /** Fields selected under a type condition that narrows a union or interface, per condition. */
  arms: Map<string, { type: GraphQLNamedType, selection: MergedSelection }>
}

const emptySelection = (): MergedSelection => ({ selections: 0, fields: new Map(), arms: new Map() })

/** Whether every counted occurrence of a merged selection selected the type's `id`. */
const selectsId = (m: MergedSelection) => m.fields.has('id') && m.fields.get('id')!.count === m.selections

/**
 * The TypeScript type of a stored field: scalars mapped, another entity
 * selected with its id as its row type, any other object as the fields the
 * documents select on it, so a query's result is assignable to its row.
 */
function fieldType(schema: GraphQLSchema, type: GraphQLOutputType, sub: MergedSelection | null, entities: Set<string>): string {
  if (isNonNullType(type)) return fieldType(schema, type.ofType, sub, entities).replace(/ \| null$/, '')
  const inner = isListType(type)
    ? `Array<${fieldType(schema, type.ofType, sub, entities)}>`
    : isScalarType(type)
      ? SCALARS[type.name] ?? `Scalars['${type.name}']['output']`
      : isEnumType(type)
        ? type.name
        : !sub
            ? type.name
            : entities.has(type.name) && selectsId(sub) ? `${type.name}Row` : objectType(schema, type, sub, entities)
  return `${inner} | null`
}

/** Object members from a merged selection; a field is optional unless every counted occurrence selected it. */
function members(schema: GraphQLSchema, m: MergedSelection, entities: Set<string>, optional = false): string[] {
  const own = [...m.fields].map(([key, f]) =>
    `${key}${!optional && m.selections > 0 && f.count === m.selections ? '' : '?'}: ${fieldType(schema, f.type, f.sub, entities)}`)
  // A condition nested inside a condition is rare; its fields are folded in as optional.
  const nested = [...m.arms.values()].flatMap(a => members(schema, a.selection, entities, true))
  return [...own, ...nested]
}

/**
 * An inline object type from a merged selection. On a union or interface,
 * one object per type condition, each with the common fields, plus the
 * common fields alone when the conditions do not cover every member, as the
 * generated result types do.
 */
function objectType(schema: GraphQLSchema, type: GraphQLNamedType, m: MergedSelection, entities: Set<string>): string {
  const common = members(schema, { ...m, arms: new Map() }, entities)
  if (!m.arms.size) return `{ ${common.join(', ')} }`
  const variants = [...m.arms.values()].map(a => `{ ${[...common, ...members(schema, a.selection, entities)].join(', ')} }`)
  const possible = isAbstractType(type) ? schema.getPossibleTypes(type) : []
  const covered = possible.every(p => [...m.arms.values()].some(a => a.type === p || (isAbstractType(a.type) && schema.isSubType(a.type, p))))
  if (!covered) variants.push(common.length ? `{ ${common.join(', ')} }` : 'Record<PropertyKey, never>')
  return variants.join(' | ')
}

/**
 * Finds the types the documents select with an id, which each get a table,
 * and the fields stored for each. A selection set on an object type with an
 * `id: ID` field, that selects `id`, counts; the row type gets the union of
 * the fields of every such selection, required when all of them have it, and
 * the same rule applies to each object below it. A selection that only
 * navigates through the type to child entities (`site { id items { … } }`)
 * contributes its fields but does not make the others optional: it never
 * stores a full row.
 */
function analyzeEntities(schema: GraphQLSchema, documentNodes: DocumentNode[], fragments: Map<string, FragmentDefinitionNode>) {
  const seen = new Map<string, MergedSelection>()
  const entitySelection = (name: string) => {
    const entry = seen.get(name) ?? emptySelection()
    seen.set(name, entry)
    return entry
  }

  /** Whether a selection set selects the plain `id` field, following spreads and inline fragments. */
  function hasId(set: SelectionSetNode): boolean {
    return set.selections.some(s =>
      s.kind === Kind.FIELD
        ? s.name.value === 'id' && !s.alias
        : s.kind === Kind.INLINE_FRAGMENT
          ? hasId(s.selectionSet)
          : !!fragments.get(s.name.value) && hasId(fragments.get(s.name.value)!.selectionSet))
  }

  /** The condition and selection set a fragment spread or inline fragment applies. */
  function fragmentOf(s: Exclude<SelectionNode, FieldNode>, on: GraphQLNamedType | undefined) {
    if (s.kind === Kind.INLINE_FRAGMENT) return { condition: s.typeCondition ? schema.getType(s.typeCondition.name.value) ?? undefined : on, selectionSet: s.selectionSet }
    const fragment = fragments.get(s.name.value)
    return { condition: fragment && (schema.getType(fragment.typeCondition.name.value) ?? undefined), selectionSet: fragment?.selectionSet }
  }

  /** Whether a type condition only applies to some of what `on` can be, so the fields under it are optional. */
  function narrows(condition: GraphQLNamedType, on: GraphQLNamedType | undefined) {
    if (!on || condition === on) return false
    return !(isAbstractType(condition) && isObjectType(on) && schema.isSubType(condition, on))
  }

  /**
   * Whether a selection only navigates through `on` to child entities: every
   * field is `id`, `__typename`, or an entity selected with its id. Such a
   * selection never stores a full row of `on`.
   */
  function navigation(sets: SelectionSetNode[], on: GraphQLNamedType | undefined): boolean {
    return sets.every(set => set.selections.every((s) => {
      if (s.kind !== Kind.FIELD) {
        const { condition, selectionSet } = fragmentOf(s, on)
        return !condition || !selectionSet || navigation([selectionSet], condition)
      }
      if (s.name.value === '__typename' || (s.name.value === 'id' && !s.alias)) return true
      const def = isObjectType(on) || isInterfaceType(on) ? on.getFields()[s.name.value] : undefined
      return !!def && !!s.selectionSet && hasIdField(getNamedType(def.type)) && hasId(s.selectionSet)
    }))
  }

  /**
   * Merges one occurrence of a selection (possibly spread over several sets
   * that GraphQL merges, like `a { x } a { y }`) on `parent` into `into`,
   * following fragment spreads and inline fragments. A selection on an
   * entity type that selects its id is also merged into that entity's row.
   * `counts` is false for a navigation occurrence: its fields are registered
   * but do not take part in deciding which fields are required.
   */
  function merge(into: MergedSelection, sets: SelectionSetNode[], parent: GraphQLNamedType | undefined, counts = true) {
    if (counts) into.selections++
    const counted = new Set<string>()
    const below = new Map<string, { sets: SelectionSetNode[], type: GraphQLNamedType }>()
    const arms = new Map<string, { sets: SelectionSetNode[], type: GraphQLNamedType }>()
    const walk = (set: SelectionSetNode, on: GraphQLNamedType | undefined) => {
      for (const s of set.selections) {
        if (s.kind === Kind.FIELD) {
          if (s.name.value === '__typename') continue
          const def = isObjectType(on) || isInterfaceType(on) ? on.getFields()[s.name.value] : undefined
          if (!def) continue
          const key = (s.alias ?? s.name).value
          const entry = into.fields.get(key) ?? { count: 0, type: def.type, sub: null }
          into.fields.set(key, entry)
          if (counts && !counted.has(key)) {
            counted.add(key)
            entry.count++
          }
          if (s.selectionSet) {
            const b = below.get(key) ?? { sets: [], type: getNamedType(def.type) }
            b.sets.push(s.selectionSet)
            below.set(key, b)
          }
          continue
        }
        const { condition, selectionSet } = fragmentOf(s, on)
        if (!condition || !selectionSet) continue
        if (!narrows(condition, on)) {
          walk(selectionSet, condition)
          continue
        }
        // Narrowing a union or interface to an entity is a selection of that entity too.
        if (hasIdField(condition) && hasId(selectionSet)) merge(entitySelection(condition.name), [selectionSet], condition, !navigation([selectionSet], condition))
        const arm = arms.get(condition.name) ?? { sets: [], type: condition }
        arm.sets.push(selectionSet)
        arms.set(condition.name, arm)
      }
    }
    for (const set of sets) walk(set, parent)
    for (const [key, { sets: subsets, type }] of below) {
      const entry = into.fields.get(key)!
      entry.sub ??= emptySelection()
      merge(entry.sub, subsets, type, counts)
      if (hasIdField(type) && subsets.some(hasId)) merge(entitySelection(type.name), subsets, type, !navigation(subsets, type))
    }
    for (const [name, { sets: armSets, type }] of arms) {
      const arm = into.arms.get(name) ?? { type, selection: emptySelection() }
      into.arms.set(name, arm)
      merge(arm.selection, armSets, type, counts)
    }
  }

  for (const doc of documentNodes) {
    for (const def of doc.definitions) {
      if (def.kind !== Kind.OPERATION_DEFINITION) continue
      const root = def.operation === 'query' ? schema.getQueryType() : def.operation === 'mutation' ? schema.getMutationType() : schema.getSubscriptionType()
      merge(emptySelection(), [def.selectionSet], root ?? undefined)
    }
  }

  const entities: Record<string, EntityInfo> = {}
  const rows: LoadedDocuments['rows'] = {}
  const names = new Set(seen.keys())
  for (const [name, entry] of seen) {
    entities[name] = { key: 'id' }
    rows[name] = {}
    for (const [key, f] of entry.fields) {
      rows[name][key] = { ts: fieldType(schema, f.type, f.sub, names), required: key === 'id' || (entry.selections > 0 && f.count === entry.selections) }
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
