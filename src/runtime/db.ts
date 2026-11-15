import { Dexie } from 'dexie'
import type { DBCoreIndex, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable, DBCoreTransaction, IndexableType } from 'dexie'
import type { AirplaneDexie, UndoEntry, UndoOp, UndoStep } from './types'

export const MODULE_STORES = {
  queries: '&key, document, updatedAt',
  mutations: '++id, status, createdAt',
  meta: '&key',
}

/** Tables that hold module bookkeeping rather than cached data. */
export const BOOKKEEPING_TABLES = new Set(['mutations', 'meta'])

export interface CreateDbOptions {
  /**
   * Warn (once per table and index) when a boolean is written to an indexed
   * key path, since IndexedDB cannot index booleans. Defaults to dev mode.
   */
  warnOnBooleanIndex?: boolean
}

export function createDb(name: string, stores: Record<string, string> = {}, version = 1, { warnOnBooleanIndex = import.meta.dev }: CreateDbOptions = {}): AirplaneDexie {
  const db = new Dexie(name) as AirplaneDexie
  db.version(version).stores({ ...MODULE_STORES, ...stores })
  installUndoLog(db, warnOnBooleanIndex)
  return db
}

// ---------------------------------------------------------------------------
// Boolean index check (development only)
//
// A row with `archived: true` in a table declared '&id, archived' is stored
// fine but never matches `where('archived').equals(true)`, and nothing says
// why. Inspect writes against the table's indexes and warn the first time.
// ---------------------------------------------------------------------------

/** Reads a (possibly dotted) key path off a row, like IndexedDB does. */
function valueAt(row: unknown, keyPath: string): unknown {
  return keyPath.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), row)
}

function warnBooleanIndexes(table: DBCoreTable, values: readonly unknown[], warned: Set<string>) {
  const { primaryKey, indexes } = table.schema
  for (const index of [primaryKey, ...indexes]) {
    // Dexie lists prefix indexes it derives from compound ones; skip those.
    if (!index.keyPath || index.name?.includes('(virtual-from:')) continue
    const label = index.name ?? 'primary key'
    const id = `${table.name}/${label}`
    if (warned.has(id)) continue
    const paths = Array.isArray(index.keyPath) ? index.keyPath : [index.keyPath]
    for (const value of values) {
      const at = paths.findIndex(path => typeof valueAt(value, path) === 'boolean')
      if (at === -1) continue
      warned.add(id)
      const where = paths.length > 1 ? `index "${label}" at "${paths[at]}"` : `index "${label}"`
      console.warn(`[nuxt-airplane] Table "${table.name}": ${where} received a boolean, and IndexedDB cannot index booleans; store it as 0 | 1 (see the docs on stores).`)
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Undo log
//
// A DBCore middleware that, for transactions started by `withUndoLog`, keeps
// every row a write touches as it was before and as the writes left it. From
// the two, `describeChanges` works out what the mutation did: the pieces to
// put back to undo it, and what it created, touched and wrote (see below).
// That is what lets a queued mutation be rolled back whatever tables its
// `apply` handler wrote to.
// ---------------------------------------------------------------------------

/** A row as `apply` found it and as it left it, whatever the writes in between. */
export interface RowChange {
  table: string
  key: IndexableType
  before: unknown
  after: unknown
}

/** One write as it happened: the whole row before it, to take back a handler that threw midway. */
interface Write {
  table: string
  key: IndexableType
  before?: unknown
}

interface Log {
  writes: Write[]
  changes: Map<string, RowChange>
}

/** A write plus the row as it left it. */
type Recorded = Write & { after?: unknown }

/** Active logs, keyed by the IndexedDB transaction the writes run in. */
const logs = new WeakMap<object, Log>()

function keysOf(index: DBCoreIndex, values: readonly unknown[]) {
  return index.extractKey ? values.map(v => index.extractKey!(v)) : undefined
}

async function recordBefore(table: DBCoreTable, req: DBCoreMutateRequest): Promise<{ entries: Recorded[], afterMutate?: (res: DBCoreMutateResponse) => void }> {
  const pk = table.schema.primaryKey
  const trans = req.trans as DBCoreTransaction
  const name = table.name

  if (req.type === 'deleteRange') {
    const values = (await table.query({ trans, query: { index: pk, range: req.range }, values: true })).result as unknown[]
    // Keys kept beside the rows cannot be read off them: ask the store.
    const inRows = pk.keyPath == null ? undefined : keysOf(pk, values)
    const keys = inRows ?? (await table.query({ trans, query: { index: pk, range: req.range }, values: false })).result
    return { entries: values.map((before, i) => ({ table: name, key: keys[i], before })) }
  }

  if (req.type === 'delete') {
    const before = await table.getMany({ trans, keys: req.keys })
    return { entries: req.keys.map((key, i) => ({ table: name, key, before: before[i] })) }
  }

  // add / put. A key the store generates (auto-increment, kept in the row or
  // beside it) is only known after the write, and a row written under one is new.
  const keys: unknown[] = req.keys ?? keysOf(pk, req.values) ?? req.values.map(() => undefined)
  const known = keys.filter(key => key != null)
  // Always a Dexie read, even for no keys: the await keeps the caller in the transaction's zone.
  const found = await table.getMany({ trans, keys: known })
  let next = 0
  const entries: Recorded[] = keys.map((key, i) => ({ table: name, key: key as IndexableType, before: key == null ? undefined : found[next++], after: req.values[i] }))
  return {
    entries,
    afterMutate: ({ results, lastResult }) => entries.forEach((entry, i) => {
      if (entry.key == null) entry.key = (results?.[i] ?? (i === entries.length - 1 ? lastResult : undefined)) as IndexableType
    }),
  }
}

function installUndoLog(db: Dexie, warnOnBooleanIndex = false) {
  const warned = new Set<string>()
  db.use({
    stack: 'dbcore',
    name: 'nuxt-airplane-undo',
    create: core => ({
      ...core,
      table(name) {
        const table = core.table(name)
        // Bookkeeping tables are never part of a mutation's effect.
        if (BOOKKEEPING_TABLES.has(name)) return table
        return {
          ...table,
          async mutate(req) {
            if (warnOnBooleanIndex && (req.type === 'add' || req.type === 'put')) warnBooleanIndexes(table, req.values, warned)
            const log = logs.get(req.trans as object)
            if (!log) return table.mutate(req)
            const { entries, afterMutate } = await recordBefore(table, req)
            const res = await table.mutate(req)
            afterMutate?.(res)
            for (const { after, ...entry } of entries) {
              // A write whose key never became known left nothing that can be taken back.
              if (entry.key == null) continue
              log.writes.push(entry)
              // Per row: the first state seen and the last one written.
              const id = `${entry.table}\0${JSON.stringify(entry.key)}`
              const seen = log.changes.get(id)
              log.changes.set(id, { table: entry.table, key: entry.key, before: seen ? seen.before : entry.before, after })
            }
            return res
          },
        }
      },
    }),
  })
}

/**
 * Runs `fn` in a read-write transaction over every table and returns the
 * rows it changed. If `fn` throws, the transaction aborts and nothing is kept.
 *
 * With `tolerant`, a throw is survived instead: what `fn` wrote is taken
 * back, the transaction this runs in goes on, and the error is returned. The
 * catch has to sit inside the transaction scope, because a rejection that
 * leaves a nested scope aborts the outermost one.
 */
export async function withUndoLog<T>(db: AirplaneDexie, fn: () => Promise<T> | T, { tolerant = false } = {}): Promise<{ result?: T, changes: RowChange[], error?: Error }> {
  const log: Log = { writes: [], changes: new Map() }
  let error: Error | undefined
  const result = await db.transaction('rw', db.tables, async () => {
    const idbtrans = Dexie.currentTransaction.idbtrans as object
    logs.set(idbtrans, log)
    try {
      return await fn()
    }
    catch (thrown) {
      if (!tolerant) throw thrown
      logs.delete(idbtrans)
      // Row by row, newest write first: exact, since nothing else wrote in between.
      for (const write of log.writes.reverse()) await putBack(db, write)
      log.changes.clear()
      error = thrown instanceof Error ? thrown : new Error(String(thrown))
    }
    finally {
      logs.delete(idbtrans)
    }
  })
  return { result, changes: [...log.changes.values()], error }
}

/** Restores one whole row, or removes it if it was not there. */
async function putBack(db: AirplaneDexie, { table: name, key, before }: Write) {
  const table = db.tables.find(t => t.name === name)
  if (!table || key == null) return
  if (before === undefined) await table.delete(key)
  else if (table.schema.primKey.keyPath) await table.put(before)
  else await table.put(before, key)
}

/**
 * Takes a mutation's effect back, newest entry first. A row it created is
 * deleted, a row it deleted is put back, and a row it changed gets back only
 * the pieces it changed: other fields, and other elements of a list, are
 * left as they are now, whoever wrote them since.
 */
export async function applyUndo(db: AirplaneDexie, undo: UndoEntry[]) {
  await db.transaction('rw', db.tables, async () => {
    for (const entry of [...undo].reverse()) {
      // A table that is gone, or an entry without its key, cannot be taken back.
      const table = entry.key == null ? undefined : db.tables.find(t => t.name === entry.table)
      if (!table) continue
      if (!entry.ops) {
        await putBack(db, entry.created ? { table: entry.table, key: entry.key } : entry)
        continue
      }
      const row = await table.get(entry.key)
      if (!isObject(row)) continue
      for (const op of [...entry.ops].reverse()) revert(row, op)
      if (table.schema.primKey.keyPath) await table.put(row)
      else await table.put(row, entry.key)
    }
  })
}

/** Puts one piece of a row back. A piece whose place no longer exists is skipped. */
function revert(row: Record<string, unknown>, { path, had, value, index }: UndoOp) {
  let at: unknown = row
  for (const step of path.slice(0, -1)) {
    at = typeof step === 'string'
      ? (isObject(at) ? at[step] : undefined)
      : (Array.isArray(at) ? at.find(el => isObject(el) && String(el.id) === step.id) : undefined)
  }
  const last = path[path.length - 1]!
  if (typeof last === 'string') {
    if (!isObject(at)) return
    if (had) at[last] = value
    else Reflect.deleteProperty(at, last)
  }
  else if (Array.isArray(at)) {
    const now = at.findIndex(el => isObject(el) && String(el.id) === last.id)
    if (!had) {
      if (now >= 0) at.splice(now, 1)
    }
    else if (now >= 0) at[now] = value
    else at.splice(Math.min(index ?? at.length, at.length), 0, value)
  }
}

/** Calls `fn` when the IndexedDB transaction the caller is running in commits. */
export function whenCommitted(fn: () => void) {
  (Dexie.currentTransaction.idbtrans as IDBTransaction).addEventListener('complete', fn)
}

// ---------------------------------------------------------------------------
// What a mutation did
//
// Comparing each row before and after `apply` gives four things.
//
// - The undo log: the pieces that changed, each with what was there before.
//   A piece is a field, or an element with an `id` in a list, at any depth.
//   Only those are put back on undo, so a write to another field of the same
//   row (the app's own, a value `reconcile` merged, a later mutation the
//   server has since accepted) survives it.
// - What it created: rows, and list elements with an `id`, named by path
//   (`Site/s1`, `Site/s1/items/i1`, `Site/s1/items/nodes/i1`). A mutation
//   that touches a thing an earlier queued one created depends on it, since
//   the server has not seen that thing yet.
// - What it touched: every thing it created, removed or changed, and what
//   each sits in.
// - What it wrote: the pieces themselves (`Site/s1#name`, `Site/s1/items/i1`).
//   Two queued mutations that wrote the same piece must reach the server in
//   order, so the later one waits while the earlier one is failed.
//
// Only list elements count as things. A single nested object with an `id`
// (an owner, a category) refers to something that exists elsewhere and is
// part of the value of what holds it. And removing a thing touches that
// thing, not each one it held: deleting a site does not depend on the items
// added to it.
// ---------------------------------------------------------------------------

export interface Changes {
  /** What to put back to undo the writes. */
  undo: UndoEntry[]
  /** Things present after the writes and absent before. */
  created: Set<string>
  /** Things created, removed or changed. A change to a thing also touches what it sits in. */
  touched: Set<string>
  /** The pieces written: fields, and things added or removed. */
  wrote: Set<string>
}

const escapePart = (part: string) => part.replace(/[%/#]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

/** The name of a thing: its path components, escaped and joined with `/`. */
export const thingPath = (parts: string[]) => parts.map(escapePart).join('/')

/** A primary key as a path component. */
export const keyLabel = (key: unknown) => (typeof key === 'string' ? key : JSON.stringify(key))

/** What the rows in `changes` say the writes did. */
export function describeChanges(changes: RowChange[]): Changes {
  const out: Changes = { undo: [], created: new Set(), touched: new Set(), wrote: new Set() }
  for (const { table, key, before, after } of changes) {
    if (deepEqual(before, after)) continue
    const names = [table, keyLabel(key)]
    const name = thingPath(names)
    out.touched.add(name)
    if (before === undefined) {
      out.created.add(name)
      out.wrote.add(name)
      out.undo.push({ table, key, created: true })
      created(names, after, out)
    }
    else if (after === undefined || !isObject(before) || !isObject(after)) {
      out.wrote.add(name)
      out.undo.push({ table, key, before })
    }
    else {
      const ops: UndoOp[] = []
      diffObject([], names, before, after, ops, out)
      out.undo.push({ table, key, ops })
    }
  }
  return out
}

/** Two versions of an object: a row, a list element, or a plain object on the way to a list. */
function diffObject(steps: UndoStep[], names: string[], before: Record<string, unknown>, after: Record<string, unknown>, ops: UndoOp[], out: Changes) {
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[field]
    const is = after[field]
    if (deepEqual(was, is)) continue
    const count = ops.length
    if (isList(was) && isList(is)) diffList([...steps, field], [...names, field], was, is, ops, out)
    else if (isObject(was) && isObject(is)) diffObject([...steps, field], [...names, field], was, is, ops, out)
    // Anything else is one piece, as is a list that only changed its order.
    if (ops.length > count) continue
    ops.push({ path: [...steps, field], had: field in before, value: was })
    out.wrote.add(`${thingPath(names)}#${escapePart(field)}`)
    if (was === undefined) created([...names, field], is, out, true)
  }
}

/** Two versions of a list of things, matched by id. */
function diffList(steps: UndoStep[], names: string[], before: Thing[], after: Thing[], ops: UndoOp[], out: Changes) {
  const was = new Map(before.map((el, index) => [String(el.id), { el, index }]))
  const is = new Map(after.map(el => [String(el.id), el]))
  for (const id of new Set([...was.keys(), ...is.keys()])) {
    const old = was.get(id)
    const now = is.get(id)
    if (old && now && deepEqual(old.el, now)) continue
    const name = thingPath([...names, id])
    out.touched.add(name)
    if (old && now) {
      diffObject([...steps, { id }], [...names, id], old.el, now, ops, out)
      continue
    }
    out.wrote.add(name)
    if (old) ops.push({ path: [...steps, { id }], had: true, value: old.el, index: old.index })
    else {
      ops.push({ path: [...steps, { id }], had: false })
      out.created.add(name)
      created([...names, id], now, out)
    }
  }
}

/** Names the things inside something that is new, lists found through the objects on the way. */
function created(names: string[], value: unknown, out: Changes, isField = false) {
  if (isField && isList(value)) {
    for (const el of value) {
      const name = thingPath([...names, String(el.id)])
      out.created.add(name)
      out.touched.add(name)
      created([...names, String(el.id)], el, out)
    }
  }
  else if (isObject(value)) {
    for (const [field, inner] of Object.entries(value)) created([...names, field], inner, out, true)
  }
}

/** An object with fields to look into: plain or a class instance, not a Date, a Map, a Blob. */
const isObject = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === '[object Object]'

type Thing = Record<string, unknown> & { id: string | number }

/** A list of things: every element is an object with an `id`. */
const isList = (value: unknown): value is Thing[] =>
  Array.isArray(value) && value.every(el => isObject(el) && (typeof el.id === 'string' || typeof el.id === 'number'))

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  // Anything else that cannot be compared field by field (a Blob, a Map) counts as changed.
  if (Array.isArray(a) ? !Array.isArray(b) : !isObject(a) || !isObject(b)) return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length
    && keys.every(k => k in b && deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
