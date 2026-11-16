import { Dexie } from 'dexie'
import type { DBCoreIndex, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable, DBCoreTransaction, IndexableType } from 'dexie'
import type { AirplaneDexie } from './types'

export const MODULE_STORES = {
  queries: '&key, document, updatedAt',
  // Past the queue's order, the indexes answer what queuing and sending ask of
  // it without reading it all: the rows a mutation changed, what it created
  // and wrote, the placeholders it minted, and whether it changed nothing.
  mutations: '++id, status, createdAt, document, unkeyed, *rows, *creates, *writes, *tempIds',
  meta: '&key',
  base: '[table+key]',
}

/** Tables that hold module bookkeeping rather than cached data. */
export const BOOKKEEPING_TABLES = new Set(['mutations', 'meta', 'base'])

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
  installWriteLayer(db, warnOnBooleanIndex)
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
// Two layers
//
// The data tables show what the user should see: what the server said, with
// the queued mutations applied on top. For every row the queue has changed,
// the `base` table keeps the server's version (or a note that the server has
// no such row). Nothing else is recorded about a mutation's effect: taking
// the queue off the tables is putting those rows back, and putting it on
// again is running the `apply` handlers in order.
//
// A DBCore middleware keeps the two layers apart at the point of writing:
//
// - Inside `record`, it notes each row as it was and as it ended up. That
//   is how an `apply` tells which rows it changed, and a `store` which rows
//   it brought from the server.
// - Inside `quietly`, it stays out of the way: the module is moving rows
//   between the layers itself.
// - Any other write to a data table comes from outside the queue: the app's
//   own code, or a `reconcile`. If the row has a server version in `base`,
//   the same change is made there, so it survives the queue being taken off
//   and put back.
// ---------------------------------------------------------------------------

/** A row as a recorded function found it and as it left it, whatever the writes in between. */
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

/** Active recordings, keyed by the IndexedDB transaction the writes run in. */
const logs = new WeakMap<object, Log>()
/** Transactions in which the module moves rows between the layers itself. */
const quiet = new WeakSet<object>()

/** Notes of which rows a transaction wrote, for `track`. */
const trackers = new WeakMap<object, Map<string, [string, IndexableType]>>()

/**
 * From here to the end of the current transaction, notes every row written
 * to a data table, whether it changed or not. That is how a query's record
 * knows which rows its `store` brought, at the cost of no extra read.
 */
export function track() {
  const idbtrans = Dexie.currentTransaction.idbtrans as object
  const rows = new Map<string, [string, IndexableType]>()
  trackers.set(idbtrans, rows)
  return { rows, stop: () => trackers.delete(idbtrans) }
}

/** Whether an error, or what caused it, is the browser refusing a write for lack of room. */
export function isQuotaError(error: unknown): boolean {
  for (let e = error as { name?: string, inner?: unknown } | undefined, depth = 0; e && depth < 5; e = e.inner as typeof e, depth++) {
    if (e.name === 'QuotaExceededError') return true
  }
  return false
}

/** Rows written per request to IndexedDB. */
const CHUNK = 500

/**
 * A large `bulkPut` cloned in one go holds the thread for as long as it
 * takes. Written a chunk at a time, the browser gets a turn between chunks
 * (each one waits for IndexedDB to answer) and the transaction stays the same.
 */
async function mutateInChunks(table: DBCoreTable, req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
  if ((req.type !== 'add' && req.type !== 'put') || req.values.length <= CHUNK) return table.mutate(req)
  const out: DBCoreMutateResponse = { numFailures: 0, failures: {}, results: req.wantResults ? [] : undefined, lastResult: undefined }
  for (let at = 0; at < req.values.length; at += CHUNK) {
    const res = await table.mutate({ ...req, values: req.values.slice(at, at + CHUNK), keys: req.keys?.slice(at, at + CHUNK) })
    out.numFailures += res.numFailures
    for (const [i, failure] of Object.entries(res.failures)) out.failures[Number(i) + at] = failure
    if (res.results) (out.results ??= []).push(...res.results)
    out.lastResult = res.lastResult
  }
  return out
}

/** A row's identity across tables. */
export const rowKey = (table: string, key: unknown) => `${table}\0${JSON.stringify(key)}`

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

/**
 * A write from outside the queue. Where the row has a server version in
 * `base`, the fields this write changes are changed there too. The caller's
 * transaction usually does not cover `base`, so that follows in one of its
 * own, right behind.
 */
async function writeThrough(db: AirplaneDexie, table: DBCoreTable, req: DBCoreMutateRequest) {
  if (req.type === 'deleteRange') return table.mutate(req)
  const trans = req.trans as DBCoreTransaction
  const keys: unknown[] = (req.type === 'delete' ? req.keys : req.keys ?? keysOf(table.schema.primaryKey, req.values)) ?? []
  const known = keys.map((key, i) => ({ key: key as IndexableType, i })).filter(({ key }) => key != null)
  const before = await table.getMany({ trans, keys: known.map(({ key }) => key) })
  const res = await mutateInChunks(table, req)
  const writes = known.map(({ key, i }, n) => ({ key, before: before[n], after: req.type === 'delete' ? undefined : req.values[i] }))
  if (writes.length) void Dexie.ignoreTransaction(() => carryToBase(db, table.name, writes)).catch(() => {})
  return res
}

async function carryToBase(db: AirplaneDexie, table: string, writes: { key: IndexableType, before: unknown, after: unknown }[]) {
  await db.transaction('rw', db.base, async () => {
    const held = await db.base.bulkGet(writes.map(({ key }) => [table, key] as [string, IndexableType]))
    for (const [n, { key, before, after }] of writes.entries()) {
      const entry = held[n]
      // A row the server does not have yet stays that way until its mutation is accepted.
      if (!entry || entry.absent) continue
      await db.base.put(after === undefined ? { table, key, absent: 1 } : { table, key, row: carry(entry.row, before, after) })
    }
  })
}

/** `row` with the top-level fields that differ between `before` and `after` taken from `after`. */
function carry(row: unknown, before: unknown, after: unknown) {
  if (!isObject(row) || !isObject(before) || !isObject(after)) return after
  const next = { ...row }
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (deepEqual(before[field], after[field])) continue
    if (field in after) next[field] = after[field]
    else Reflect.deleteProperty(next, field)
  }
  return next
}

function installWriteLayer(db: Dexie, warnOnBooleanIndex = false) {
  const warned = new Set<string>()
  db.use({
    stack: 'dbcore',
    name: 'nuxt-airplane-layers',
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
            const tracked = trackers.get(req.trans as object)
            if (tracked && req.type !== 'deleteRange') {
              const keys = req.type === 'delete' ? req.keys : req.keys ?? keysOf(table.schema.primaryKey, req.values) ?? []
              for (const key of keys) {
                if (key == null) continue
                if (req.type === 'delete') tracked.delete(rowKey(name, key))
                else tracked.set(rowKey(name, key), [name, key as IndexableType])
              }
            }
            const log = logs.get(req.trans as object)
            if (!log) return quiet.has(req.trans as object) ? mutateInChunks(table, req) : writeThrough(db as AirplaneDexie, table, req)
            const { entries, afterMutate } = await recordBefore(table, req)
            const res = await mutateInChunks(table, req)
            afterMutate?.(res)
            for (const { after, ...entry } of entries) {
              // A write whose key never became known left nothing that can be taken back.
              if (entry.key == null) continue
              log.writes.push(entry)
              // Per row: the first state seen and the last one written.
              const id = rowKey(entry.table, entry.key)
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
export async function record<T>(db: AirplaneDexie, fn: () => Promise<T> | T, { tolerant = false } = {}): Promise<{ result?: T, changes: RowChange[], error?: Error }> {
  const log: Log = { writes: [], changes: new Map() }
  let error: Error | undefined
  const result = await db.transaction('rw', db.tables, async () => {
    const idbtrans = Dexie.currentTransaction.idbtrans as object
    const outer = logs.get(idbtrans)
    logs.set(idbtrans, log)
    try {
      return await fn()
    }
    catch (thrown) {
      if (!tolerant) throw thrown
      // Row by row, newest write first: exact, since nothing else wrote in between.
      logs.delete(idbtrans)
      quiet.add(idbtrans)
      for (const write of log.writes.reverse()) await putRow(db, write.table, write.key, write.before)
      log.changes.clear()
      error = thrown instanceof Error ? thrown : new Error(String(thrown))
    }
    finally {
      if (outer) logs.set(idbtrans, outer)
      else logs.delete(idbtrans)
    }
  })
  return { result, changes: [...log.changes.values()].filter(c => !deepEqual(c.before, c.after)), error }
}

/** Runs `fn` in a read-write transaction in which the module moves rows between the layers itself. */
export function quietly<T>(db: AirplaneDexie, fn: () => Promise<T>): Promise<T> {
  return db.transaction('rw', db.tables, async () => {
    quiet.add(Dexie.currentTransaction.idbtrans as object)
    return await fn()
  })
}

/** Writes one whole row, or removes it when `row` is undefined. A table that is gone is skipped. */
export async function putRow(db: AirplaneDexie, name: string, key: IndexableType, row: unknown) {
  const table = db.tables.find(t => t.name === name)
  if (!table || key == null) return
  if (row === undefined) await table.delete(key)
  else if (table.schema.primKey.keyPath) await table.put(row)
  else await table.put(row, key)
}

// ---------------------------------------------------------------------------
// What a mutation did
//
// Comparing each row before and after `apply` names three things.
//
// - What it created: rows, and list elements with an `id`, by path
//   (`Site/s1`, `Site/s1/items/i1`, `Site/s1/items/nodes/i1`). A mutation
//   that touches a thing an earlier queued one created depends on it, since
//   the server has not seen that thing yet.
// - What it touched: every thing it created, removed or changed, and what
//   each sits in.
// - What it wrote: the pieces themselves, a field (`Site/s1#name`) or a
//   thing added or removed (`Site/s1/items/i1`). Two queued mutations that
//   wrote the same piece must reach the server in order, so the later one
//   waits while the earlier one is failed.
//
// Only list elements count as things. A single nested object with an `id`
// (an owner, a category) refers to something that exists elsewhere and is
// part of the value of what holds it. And removing a thing touches that
// thing, not each one it held: deleting a site does not depend on the items
// added to it.
// ---------------------------------------------------------------------------

export interface Changes {
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
  const out: Changes = { created: new Set(), touched: new Set(), wrote: new Set() }
  for (const { table, key, before, after } of changes) {
    if (deepEqual(before, after)) continue
    const names = [table, keyLabel(key)]
    const name = thingPath(names)
    out.touched.add(name)
    if (before === undefined) {
      out.created.add(name)
      out.wrote.add(name)
      created(names, after, out)
    }
    else if (after === undefined || !isObject(before) || !isObject(after)) out.wrote.add(name)
    else diffObject(names, before, after, out)
  }
  return out
}

/** Two versions of an object: a row, a list element, or a plain object on the way to a list. */
function diffObject(names: string[], before: Record<string, unknown>, after: Record<string, unknown>, out: Changes) {
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const was = before[field]
    const is = after[field]
    if (deepEqual(was, is)) continue
    const count = out.wrote.size
    if (isList(was) && isList(is)) diffList([...names, field], was, is, out)
    else if (isObject(was) && isObject(is)) diffObject([...names, field], was, is, out)
    // Anything else is one piece, as is a list that only changed its order.
    if (out.wrote.size > count) continue
    out.wrote.add(`${thingPath(names)}#${escapePart(field)}`)
    if (was === undefined) created([...names, field], is, out, true)
  }
}

/** Two versions of a list of things, matched by id. */
function diffList(names: string[], before: Thing[], after: Thing[], out: Changes) {
  const was = new Map(before.map(el => [String(el.id), el]))
  const is = new Map(after.map(el => [String(el.id), el]))
  for (const id of new Set([...was.keys(), ...is.keys()])) {
    const old = was.get(id)
    const now = is.get(id)
    if (old && now && deepEqual(old, now)) continue
    const name = thingPath([...names, id])
    out.touched.add(name)
    if (old && now) {
      diffObject([...names, id], old, now, out)
      continue
    }
    out.wrote.add(name)
    if (now) {
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
