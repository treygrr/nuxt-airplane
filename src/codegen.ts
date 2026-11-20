import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { codegen } from '@graphql-codegen/core'
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
  specifiedScalarTypes,
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
  /**
   * Row fields per entity, for the generated types: TS type, whether every
   * selection includes it, and whether it holds another entity (one, a list
   * of them, or an object with some inside), which a handler may keep in
   * that entity's own table and leave off this row.
   */
  rows: Record<string, Record<string, { ts: string, required: boolean, entity?: true }>>
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
  /** Occurrences in queries that count towards a field being required: node selections, not navigation ones. */
  selections: number
  /** The same, in mutations and subscriptions. They only decide where no query selects the type. */
  weakSelections: number
  fields: Map<string, { count: number, weakCount: number, type: GraphQLOutputType, sub: MergedSelection | null }>
  /**
   * `__typename` by response key (an alias included), counted like a field.
   * It is a meta field, not in the type's fields: its type is the name of
   * whatever concrete type the object is, so it is rendered where that is known.
   */
  typenames: Map<string, { count: number, weakCount: number }>
  /** Fields selected under a type condition that narrows a union or interface, per condition. */
  arms: Map<string, { type: GraphQLNamedType, selection: MergedSelection }>
}

const emptySelection = (): MergedSelection => ({ selections: 0, weakSelections: 0, fields: new Map(), typenames: new Map(), arms: new Map() })

/**
 * Whether a field is in every occurrence that decides: those in queries, or,
 * for something no query selects, those in mutations. A mutation's result is
 * often a few fields of a row that a query stored in full, written with
 * `update`; counting it would make every other field of the row optional.
 */
function inEvery(m: Pick<MergedSelection, 'selections' | 'weakSelections'>, f: { count: number, weakCount: number }) {
  if (m.selections > 0) return f.count === m.selections
  return m.weakSelections > 0 && f.weakCount === m.weakSelections
}

/**
 * The TypeScript type of a stored field: scalars mapped, and any object,
 * another entity included, as the fields the documents select on it at that
 * place, so a query's result is assignable to its row. A nested entity is
 * not typed as its own row: what is stored there is what was selected
 * there, and two rows that point at each other would be a type without end.
 */
function fieldType(schema: GraphQLSchema, type: GraphQLOutputType, sub: MergedSelection | null): string {
  if (isNonNullType(type)) return fieldType(schema, type.ofType, sub).replace(/ \| null$/, '')
  const inner = isListType(type)
    ? `Array<${fieldType(schema, type.ofType, sub)}>`
    : isScalarType(type)
      ? SCALARS[type.name] ?? `Scalars['${type.name}']['output']`
      : isEnumType(type)
        ? type.name
        : !sub
            ? type.name
            : objectType(schema, type, sub)
  return `${inner} | null`
}

type Member = { key: string, optional: boolean, ts: string }

/** The `__typename` literal for an object that is one of `names`. */
const typenameType = (names: string[]) => names.length ? names.map(n => `'${n}'`).join(' | ') : 'never'

/**
 * Object members from a merged selection; a field is optional unless every
 * counted occurrence selected it. `names` are the concrete types the object
 * can be there, which `__typename` is one of. `of` is what the occurrences
 * are counted against: for a type condition, those of the object it is in,
 * since an occurrence without the condition stores none of its fields.
 */
function members(schema: GraphQLSchema, m: MergedSelection, names: string[], optional = false, of: Pick<MergedSelection, 'selections' | 'weakSelections'> = m): Member[] {
  const typename = [...m.typenames].map(([key, t]) => ({ key, optional: optional || !inEvery(of, t), ts: typenameType(names) }))
  const own = [...m.fields].map(([key, f]) => ({ key, optional: optional || !inEvery(of, f), ts: fieldType(schema, f.type, f.sub) }))
  // A condition nested inside a condition is rare; its fields are folded in as optional.
  const nested = [...m.arms.values()].flatMap(a => members(schema, a.selection, concreteNames(schema, a.type, names), true))
  return [...typename, ...own, ...nested]
}

/**
 * Members as an object type literal. A key selected both outside a type
 * condition and inside it (`__typename` most often) is one member: present
 * when either has it, and of both types when they differ.
 */
function literal(list: Member[]) {
  const byKey = new Map<string, Member>()
  for (const m of list) {
    const seen = byKey.get(m.key)
    byKey.set(m.key, !seen ? m : { key: m.key, optional: seen.optional && m.optional, ts: seen.ts === m.ts ? seen.ts : `(${seen.ts}) & (${m.ts})` })
  }
  const all = [...byKey.values()].map(m => `${m.key}${m.optional ? '?' : ''}: ${m.ts}`)
  return all.length ? `{ ${all.join(', ')} }` : 'Record<PropertyKey, never>'
}

/** The concrete types an object of `type` can be, within `within` when given (the types the enclosing position allows). */
function concreteNames(schema: GraphQLSchema, type: GraphQLNamedType, within?: string[]) {
  const names = isAbstractType(type) ? schema.getPossibleTypes(type).map(t => t.name) : [type.name]
  return within ? names.filter(n => within.includes(n)) : names
}

/**
 * An inline object type from a merged selection. On a union or interface,
 * one object per type condition, each with the common fields, plus the
 * common fields alone when the conditions do not cover every member, as the
 * generated result types do. `__typename` is the condition's type in an
 * arm, and the types no condition covers in the rest.
 */
function objectType(schema: GraphQLSchema, type: GraphQLNamedType, m: MergedSelection): string {
  const all = concreteNames(schema, type)
  const common = (names: string[]) => members(schema, { ...m, arms: new Map() }, names)
  if (!m.arms.size) return literal(common(all))
  const variants = [...m.arms.values()].map((a) => {
    const names = concreteNames(schema, a.type, all)
    return literal([...common(names), ...members(schema, a.selection, names, false, m)])
  })
  const rest = all.filter(n => ![...m.arms.values()].some(a => concreteNames(schema, a.type).includes(n)))
  if (isAbstractType(type) && rest.length) variants.push(literal(common(rest)))
  return variants.join(' | ')
}

/**
 * Finds the types the documents select with an id, which each get a table,
 * and the fields stored for each. A selection set on an object type with an
 * `id: ID` field, that selects `id`, counts; the row type gets the union of
 * the fields of every such selection, required when all of them have it, and
 * the same rule applies to each object below it. A selection that only
 * navigates through the type to what is below it (`site { id items { … } }`,
 * whatever `items` is) contributes its fields but does not make the others
 * optional: it never stores a full row.
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
   * Whether a selection only navigates through `on` to what is below it: it
   * selects no leaf (scalar or enum) field other than `id` and `__typename`.
   * Object children of any kind, an entity, a connection, an embedded value,
   * carry none of `on`'s own data, so such a selection never stores a full
   * row of `on`.
   */
  function navigation(sets: SelectionSetNode[], on: GraphQLNamedType | undefined): boolean {
    return sets.every(set => set.selections.every((s) => {
      if (s.kind !== Kind.FIELD) {
        const { condition, selectionSet } = fragmentOf(s, on)
        return !condition || !selectionSet || navigation([selectionSet], condition)
      }
      return s.name.value === '__typename' || (s.name.value === 'id' && !s.alias) || !!s.selectionSet
    }))
  }

  /**
   * Merges one occurrence of a selection (possibly spread over several sets
   * that GraphQL merges, like `a { x } a { y }`) on `parent` into `into`,
   * following fragment spreads and inline fragments. A selection on an
   * entity type that selects its id is also merged into that entity's row.
   * `counts` is false for a navigation occurrence: its fields are registered
   * but do not take part in deciding which fields are required. `weak` is
   * true inside a mutation or subscription: it is counted apart, and only
   * decides for what no query selects. `typenames` are the `__typename` keys
   * the enclosing selection asked for beside the type condition this one is.
   */
  function merge(into: MergedSelection, sets: SelectionSetNode[], parent: GraphQLNamedType | undefined, weak: boolean, counts = true, typenames: string[] = []) {
    if (counts) into[weak ? 'weakSelections' : 'selections']++
    const counted = new Set<string>()
    const below = new Map<string, { sets: SelectionSetNode[], type: GraphQLNamedType }>()
    const arms = new Map<string, { sets: SelectionSetNode[], type: GraphQLNamedType }>()
    const entityArms: { condition: GraphQLNamedType, set: SelectionSetNode }[] = []
    const here = new Set<string>()
    const typename = (key: string) => {
      here.add(key)
      const entry = into.typenames.get(key) ?? { count: 0, weakCount: 0 }
      into.typenames.set(key, entry)
      if (counts && !counted.has(key)) {
        counted.add(key)
        entry[weak ? 'weakCount' : 'count']++
      }
    }
    // What the enclosing selection asked for outside a type condition is in this object too.
    for (const key of typenames) typename(key)
    const walk = (set: SelectionSetNode, on: GraphQLNamedType | undefined) => {
      for (const s of set.selections) {
        if (s.kind === Kind.FIELD) {
          if (s.name.value === '__typename') {
            typename((s.alias ?? s.name).value)
            continue
          }
          const def = isObjectType(on) || isInterfaceType(on) ? on.getFields()[s.name.value] : undefined
          if (!def) continue
          const key = (s.alias ?? s.name).value
          const entry = into.fields.get(key) ?? { count: 0, weakCount: 0, type: def.type, sub: null }
          into.fields.set(key, entry)
          if (counts && !counted.has(key)) {
            counted.add(key)
            entry[weak ? 'weakCount' : 'count']++
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
        if (hasIdField(condition) && hasId(selectionSet)) entityArms.push({ condition, set: selectionSet })
        const arm = arms.get(condition.name) ?? { sets: [], type: condition }
        arm.sets.push(selectionSet)
        arms.set(condition.name, arm)
      }
    }
    for (const set of sets) walk(set, parent)
    // `__typename` selected beside the condition (`search { __typename ... on Site { id } }`) is on the row too.
    for (const { condition, set } of entityArms) {
      merge(entitySelection(condition.name), [set], condition, weak, !navigation([set], condition), [...here])
    }
    for (const [key, { sets: subsets, type }] of below) {
      const entry = into.fields.get(key)!
      entry.sub ??= emptySelection()
      // An object below a navigation selection is still a full occurrence of itself.
      merge(entry.sub, subsets, type, weak)
      if (hasIdField(type) && subsets.some(hasId)) merge(entitySelection(type.name), subsets, type, weak, !navigation(subsets, type))
    }
    for (const [name, { sets: armSets, type }] of arms) {
      const arm = into.arms.get(name) ?? { type, selection: emptySelection() }
      into.arms.set(name, arm)
      merge(arm.selection, armSets, type, weak, counts)
    }
  }

  for (const doc of documentNodes) {
    for (const def of doc.definitions) {
      if (def.kind !== Kind.OPERATION_DEFINITION) continue
      const root = def.operation === 'query' ? schema.getQueryType() : def.operation === 'mutation' ? schema.getMutationType() : schema.getSubscriptionType()
      merge(emptySelection(), [def.selectionSet], root ?? undefined, def.operation !== 'query')
    }
  }

  const entities: Record<string, EntityInfo> = {}
  const rows: LoadedDocuments['rows'] = {}
  /** Whether what is selected below a field of `type` is, or has in it, an entity selected with its id. */
  const holdsEntity = (type: GraphQLOutputType, sub: MergedSelection | null): boolean => !!sub && (
    (hasIdField(getNamedType(type)) && sub.fields.has('id'))
    || [...sub.fields.values()].some(f => holdsEntity(f.type, f.sub))
    || [...sub.arms.values()].some(a => (hasIdField(a.type) && a.selection.fields.has('id')) || [...a.selection.fields.values()].some(f => holdsEntity(f.type, f.sub))))

  for (const [name, entry] of seen) {
    entities[name] = { key: 'id' }
    rows[name] = {}
    for (const [key, t] of entry.typenames) rows[name][key] = { ts: `'${name}'`, required: inEvery(entry, t) }
    for (const [key, f] of entry.fields) {
      rows[name][key] = { ts: fieldType(schema, f.type, f.sub), required: key === 'id' || inEvery(entry, f), ...(holdsEntity(f.type, f.sub) && { entity: true as const }) }
    }
  }
  return { entities, rows }
}

/**
 * Asks for `__typename` in every selection set that does not already, as
 * `nonOptionalTypename` types it: on every object, the root included, except
 * the root of a subscription, where GraphQL does not allow it.
 */
function withTypename<T extends OperationDefinitionNode | FragmentDefinitionNode>(def: T, subscriptionType: string): T {
  const field: FieldNode = { kind: Kind.FIELD, name: { kind: Kind.NAME, value: '__typename' } }
  const add = (set: SelectionSetNode, root: boolean): SelectionSetNode => {
    const selections = set.selections.map((s): SelectionNode =>
      s.kind === Kind.FIELD
        ? s.selectionSet ? { ...s, selectionSet: add(s.selectionSet, false) } : s
        : s.kind === Kind.INLINE_FRAGMENT ? { ...s, selectionSet: add(s.selectionSet, root) } : s)
    const has = set.selections.some(s => s.kind === Kind.FIELD && s.name.value === '__typename' && !s.alias)
    return { ...set, selections: has || root ? selections : [field, ...selections] }
  }
  const root = def.kind === Kind.OPERATION_DEFINITION
    ? def.operation === 'subscription'
    : def.typeCondition.name.value === subscriptionType
  return { ...def, selectionSet: add(def.selectionSet, root) }
}

export interface LoadDocumentsOptions {
  /**
   * Ask for `__typename` everywhere, as codegen's `nonOptionalTypename`
   * types it, so what is sent, its hash, the result types and the row types
   * agree. Otherwise the documents are sent as written.
   */
  nonOptionalTypename?: boolean
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
  options: LoadDocumentsOptions = {},
): Promise<LoadedDocuments> {
  const subscriptionType = schema?.getSubscriptionType()?.name ?? 'Subscription'
  const prepare = <T extends OperationDefinitionNode | FragmentDefinitionNode>(def: T) => options.nonOptionalTypename ? withTypename(def, subscriptionType) : def
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
      if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, prepare(def))
      else if (def.kind === Kind.OPERATION_DEFINITION) {
        if (!def.name) log.warn(`Skipping anonymous ${def.operation} in ${file}: operations must be named`)
        else ops.push({ node: prepare(def), file })
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
    // Sent as written, or with `__typename` everywhere under `nonOptionalTypename`.
    const source = print(documentNode)
    // The variables it declares are what is sent; any other key passed with it is a handler's local variable.
    const variables = (node.variableDefinitions ?? []).map(def => def.variable.name.value)
    operations[name] = { name, kind: node.operation, source, hash: createHash('sha256').update(source).digest('hex'), variables }
    // The root's `__typename`, which the client adds to what `read` returns when it is left out.
    const root = node.operation === 'query' ? schema?.getQueryType()?.name ?? 'Query' : node.operation === 'mutation' ? schema?.getMutationType()?.name ?? 'Mutation' : undefined
    if (options.nonOptionalTypename && root) operations[name].root = root
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
  export const documents: Record<string, { name: string, kind: 'query' | 'mutation' | 'subscription', source: string, hash: string, variables: string[], root?: string }>
  export const documentsHash: string
  export const entities: Record<string, { key: string }>
  export const unusedEntities: string[]
}
declare module '#nuxt-airplane/handlers' {
  export const handlers: unknown[]
}
declare module '#nuxt-airplane/request' {
  export const requestFiles: unknown[]
}
declare module '#nuxt-airplane/worker' {
  export const createWorker: (() => Worker) | undefined
}
`

type ScalarMapping = string | { input?: string, output?: string }

/**
 * What the row types refer custom scalars by (`Scalars['DateTime']['output']`),
 * as the scalars config maps them, and `any` where it does not, as codegen does.
 */
function scalarTypes(schema: GraphQLSchema, scalars: Record<string, ScalarMapping>) {
  const custom = Object.values(schema.getTypeMap())
    .filter(type => isScalarType(type) && !specifiedScalarTypes.some(s => s.name === type.name))
  const members = custom.map((type) => {
    const mapping = scalars[type.name]
    const { input = 'any', output = 'any' } = typeof mapping === 'string' ? { input: mapping, output: mapping } : mapping ?? {}
    return `  ${type.name}: { input: ${input}; output: ${output}; }`
  })
  return `export type Scalars = {\n${members.join('\n')}\n}`
}

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

  // `ID` comes back as a string over the wire; typing it as such keeps
  // variables simple. Scalars given in the config are added to it, not put
  // in its place.
  const scalars = { ID: { input: 'string', output: 'string' }, ...(config.scalars as Record<string, ScalarMapping> | undefined) }
  // The operations plugin alone: since v6 it declares the enums and input
  // types the operations use. With the `typescript` plugin as well, each
  // would be declared twice, and enums once as an enum and once as a union.
  const generated = await codegen({
    filename: 'nuxt-airplane.ts',
    schema: parse(printSchema(schema)),
    documents: docs.documentNodes.map(document => ({ document })),
    config: { namingConvention: 'keep', ...config, scalars },
    plugins: [{ typescriptOperations: {} }],
    pluginMap: { typescriptOperations: typescriptOperationsPlugin },
  })

  // One row type per entity table, and the global map that types `db.<Typename>`.
  const rowTypes = Object.entries(docs.rows).map(([name, fields]) => {
    const members = Object.entries(fields).map(([field, { ts, required }]) => `${field}${required ? '' : '?'}: ${ts}`)
    return `export type ${name}Row = { ${members.join(', ')} }`
  })
  const storesMap = Object.keys(docs.rows).map(name => `    ${JSON.stringify(name)}: ${name}Row`).join('\n')
  // What may be written: the row, with the fields that hold other entities
  // optional. A handler that keeps those in their own table leaves them off.
  const loose = (fields: LoadedDocuments['rows'][string]) => Object.entries(fields).filter(([, f]) => f.entity && f.required).map(([field]) => JSON.stringify(field))
  const writeTypes = Object.entries(docs.rows).filter(([, fields]) => loose(fields).length).map(([name, fields]) =>
    `export type ${name}RowWrite = Omit<${name}Row, ${loose(fields).join(' | ')}> & Partial<Pick<${name}Row, ${loose(fields).join(' | ')}>>`)
  const writesMap = Object.entries(docs.rows).filter(([, fields]) => loose(fields).length).map(([name]) => `    ${JSON.stringify(name)}: ${name}RowWrite`).join('\n')

  return [
    '// Generated by nuxt-airplane from your GraphQL documents. Do not edit.',
    scalarTypes(schema, scalars),
    generated,
    ...rowTypes,
    ...writeTypes,
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
    '  interface NuxtAirplaneWrites {',
    writesMap,
    '  }',
    '}',
    virtualModules,
  ].join('\n')
}
