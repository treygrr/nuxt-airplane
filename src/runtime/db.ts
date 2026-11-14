import { Dexie } from 'dexie'
import type { DBCoreIndex, DBCoreMutateRequest, DBCoreMutateResponse, DBCoreTable, DBCoreTransaction, IndexableType } from 'dexie'
import type { AirplaneDexie, UndoEntry } from './types'

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
// A DBCore middleware that, for transactions started by `withUndoLog`, records
// the previous state of every row a write touches. That is what lets a queued
// mutation be rolled back whatever tables its `apply` handler wrote to.
// ---------------------------------------------------------------------------

/** Active logs, keyed by the IndexedDB transaction the writes run in. */
const logs = new WeakMap<object, UndoEntry[]>()

function keysOf(index: DBCoreIndex, values: readonly unknown[]) {
  return index.extractKey ? values.map(v => index.extractKey!(v)) : undefined
}

async function recordBefore(table: DBCoreTable, req: DBCoreMutateRequest): Promise<{ entries: UndoEntry[], afterMutate?: (res: DBCoreMutateResponse) => void }> {
  const pk = table.schema.primaryKey
  const trans = req.trans as DBCoreTransaction
  const name = table.name

  if (req.type === 'deleteRange') {
    const values = (await table.query({ trans, query: { index: pk, range: req.range }, values: true })).result as unknown[]
    const keys = keysOf(pk, values) ?? (await table.query({ trans, query: { index: pk, range: req.range }, values: false })).result
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
  const entries: UndoEntry[] = keys.map(key => ({ table: name, key: key as IndexableType, before: key == null ? undefined : found[next++] }))
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
            // A write whose key never became known left nothing that can be taken back.
            log.push(...entries.filter(entry => entry.key != null))
            return res
          },
        }
      },
    }),
  })
}

/**
 * Runs `fn` in a read-write transaction over every table and returns the
 * writes it made. If `fn` throws, the transaction aborts and nothing is kept.
 *
 * With `tolerant`, a throw is survived instead: what `fn` wrote is taken
 * back, the transaction this runs in goes on, and the error is returned. The
 * catch has to sit inside the transaction scope, because a rejection that
 * leaves a nested scope aborts the outermost one.
 */
export async function withUndoLog<T>(db: AirplaneDexie, fn: () => Promise<T> | T, { tolerant = false } = {}): Promise<{ result?: T, undo: UndoEntry[], error?: Error }> {
  let undo: UndoEntry[] = []
  let error: Error | undefined
  const result = await db.transaction('rw', db.tables, async () => {
    const idbtrans = Dexie.currentTransaction.idbtrans as object
    logs.set(idbtrans, undo)
    try {
      return await fn()
    }
    catch (thrown) {
      if (!tolerant) throw thrown
      logs.delete(idbtrans)
      await applyUndo(db, undo)
      undo = []
      error = thrown instanceof Error ? thrown : new Error(String(thrown))
    }
    finally {
      logs.delete(idbtrans)
    }
  })
  return { result, undo, error }
}

/** Puts rows back as they were, newest write first. */
export async function applyUndo(db: AirplaneDexie, undo: UndoEntry[]) {
  await db.transaction('rw', db.tables, async () => {
    for (const entry of [...undo].reverse()) {
      // An insert logged without its key (by a version that did not record
      // generated keys), or into a table that is gone, cannot be taken back.
      const table = entry.key == null ? undefined : db.tables.find(t => t.name === entry.table)
      if (!table) continue
      if (entry.before === undefined) await table.delete(entry.key)
      else if (table.schema.primKey.keyPath) await table.put(entry.before)
      else await table.put(entry.before, entry.key)
    }
  })
}

/** Calls `fn` when the IndexedDB transaction the caller is running in commits. */
export function whenCommitted(fn: () => void) {
  (Dexie.currentTransaction.idbtrans as IDBTransaction).addEventListener('complete', fn)
}
