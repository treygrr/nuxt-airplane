import { Dexie } from 'dexie'
import type { DBCoreIndex, DBCoreMutateRequest, DBCoreTable, DBCoreTransaction, IndexableType } from 'dexie'
import type { OfflineDexie, UndoEntry } from './types'

export const MODULE_STORES = {
  queries: '&key, document, updatedAt',
  mutations: '++id, status, createdAt',
}

export function createDb(name: string, stores: Record<string, string> = {}, version = 1): OfflineDexie {
  const db = new Dexie(name) as OfflineDexie
  db.version(version).stores({ ...MODULE_STORES, ...stores })
  installUndoLog(db)
  return db
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

async function recordBefore(table: DBCoreTable, req: DBCoreMutateRequest): Promise<{ entries: UndoEntry[], afterMutate?: (keys: unknown[]) => void }> {
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

  // add / put
  const keys = req.keys ?? keysOf(pk, req.values)
  if (!keys) {
    // Outbound auto-increment keys are only known after the write: they are new rows.
    const entries: UndoEntry[] = []
    return { entries, afterMutate: result => result.forEach(key => entries.push({ table: name, key: key as IndexableType })) }
  }
  const before = await table.getMany({ trans, keys })
  return { entries: keys.map((key, i) => ({ table: name, key, before: before[i] })) }
}

function installUndoLog(db: Dexie) {
  db.use({
    stack: 'dbcore',
    name: 'nuxt-offline-undo',
    create: core => ({
      ...core,
      table(name) {
        const table = core.table(name)
        // The outbox itself is bookkeeping, never part of a mutation's effect.
        if (name === 'mutations') return table
        return {
          ...table,
          async mutate(req) {
            const log = logs.get(req.trans as object)
            if (!log) return table.mutate(req)
            const { entries, afterMutate } = await recordBefore(table, req)
            const res = await table.mutate(req)
            afterMutate?.(res.results ?? [])
            log.push(...entries)
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
 */
export async function withUndoLog<T>(db: OfflineDexie, fn: () => Promise<T> | T): Promise<{ result: T, undo: UndoEntry[] }> {
  const undo: UndoEntry[] = []
  const result = await db.transaction('rw', db.tables, async () => {
    const idbtrans = Dexie.currentTransaction.idbtrans as object
    logs.set(idbtrans, undo)
    try {
      return await fn()
    }
    finally {
      logs.delete(idbtrans)
    }
  })
  return { result, undo }
}

/** Puts rows back as they were, newest write first. */
export async function applyUndo(db: OfflineDexie, undo: UndoEntry[]) {
  await db.transaction('rw', db.tables, async () => {
    for (const entry of [...undo].reverse()) {
      const table = db.table(entry.table)
      if (entry.before === undefined) await table.delete(entry.key)
      else if (table.schema.primKey.keyPath) await table.put(entry.before)
      else await table.put(entry.before, entry.key)
    }
  })
}
