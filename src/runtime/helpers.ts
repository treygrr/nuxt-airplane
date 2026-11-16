import { hash } from 'ohash'
import type { IndexableType } from 'dexie'
import { rowKey } from './db'
import type { AirplaneDexie, EntityInfo, MutationRow } from './types'

/** `ArchiveSite` → `Archive site`, `SendHTTPRequest` → `Send http request`, for mutations without a `describe`. */
export function humanize(name: string) {
  const words = name
    .replace(/[_-]+/g, ' ')
    // Acronym followed by a word: `HTTPRequest` → `HTTP Request`.
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `undefined`, `null` and `{}` all mean "no variables" and share a key. */
export function queryKey(name: string, variables: unknown) {
  const normalized = variables && typeof variables === 'object' && Object.keys(variables).length ? variables : null
  return `${name}:${hash(normalized)}`
}

// ---------------------------------------------------------------------------
// Temp ids
//
// A row created offline has no server id yet. `apply` mints a placeholder
// with `tempId()`; mutations queued after it carry that placeholder in their
// variables. Once the server has answered the create, `reconcile` maps the
// placeholder to the real id and every queued mutation that carries it is
// rewritten, in its variables and in the rows it is recorded as having changed, to point at the real row.
//
// A placeholder is also a dependency: a mutation that carries one cannot
// succeed before the one that minted it has. So is anything a queued
// mutation created locally, a row or an element of a list inside one: a
// mutation whose `apply` touches it cannot succeed before it exists on the
// server. The outbox row records both (`dependsOn`) and the chain is the
// unit of failure: a rejected mutation holds back the rows below it and
// nothing else, and rolling one back drops the ones that have nothing left
// to do without it.
//
// Two mutations that wrote the same piece of the same thing (two renames of
// one site) are ordered too (`after`): the later one waits while the earlier
// one is failed, so the server never sees them the wrong way round. That is
// order only. Rolling the earlier one back leaves the later one queued.
// ---------------------------------------------------------------------------

const TEMP_ID_PREFIX = 'tmp-'
const TEMP_ID_RE = /^tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function uuid() {
  return typeof crypto === 'object' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })
}

/** A fresh placeholder id: `tmp-` plus a UUID. */
export function newTempId() {
  return `${TEMP_ID_PREFIX}${uuid()}`
}

/** Whether a value is an id minted by `tempId()`. */
export function isTempId(value: unknown): value is string {
  return typeof value === 'string' && TEMP_ID_RE.test(value)
}

/**
 * Replaces, anywhere in `value`, every string that is a key of `ids` with its
 * mapped id. Reports whether anything changed and which minted temp ids are
 * still in there with no mapping.
 */
export function substituteTempIds<T>(value: T, ids: Record<string, string>): { value: T, replaced: boolean, unresolved: string[] } {
  let replaced = false
  const unresolved = new Set<string>()
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (Object.hasOwn(ids, v)) {
        replaced = true
        return ids[v]
      }
      if (isTempId(v)) unresolved.add(v)
      return v
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
      const out: Record<string, unknown> = {}
      for (const [k, item] of Object.entries(v)) out[k] = walk(item)
      return out
    }
    return v
  }
  const next = walk(value) as T
  return { value: replaced ? next : value, replaced, unresolved: [...unresolved] }
}

/** A mutation about to be sent still carries a temp id the server never assigned. */
export class UnresolvedTempIdError extends Error {
  override name = 'UnresolvedTempIdError'
}

/**
 * `ids` plus every outbox row that depends on one of them, directly or
 * through another row. With `ordered`, rows that only have to come after one
 * count too. A link always points at an older row, so one pass in id order
 * finds the whole closure.
 */
export function withDependents(rows: MutationRow[], ids: Iterable<number>, ordered = false): Set<number> {
  const set = new Set(ids)
  for (const row of [...rows].sort((a, b) => a.id - b.id)) {
    if (row.dependsOn?.some(id => set.has(id)) || (ordered && row.after?.some(id => set.has(id)))) set.add(row.id)
  }
  return set
}

/** The failed rows and every row that depends on one or has to come after one: what a sync leaves queued. */
export function heldBack(rows: MutationRow[]): Set<number> {
  return withDependents(rows, rows.filter(row => row.status === 'failed').map(row => row.id), true)
}

/**
 * The tables to open: one per entity keyed on its id, plus the user's. A
 * user entry for an entity table lists extra indexes; the key is implied.
 */
export function mergeStores(entities: Record<string, EntityInfo>, user: Record<string, string>) {
  const stores: Record<string, string> = {}
  for (const [name, { key }] of Object.entries(entities)) stores[name] = `&${key}`
  for (const [name, spec] of Object.entries(user)) {
    const entity = entities[name]
    if (!entity) {
      stores[name] = spec
      continue
    }
    const extra = spec.split(',').map(s => s.trim()).filter(s => s && s.replace(/^[&+*]+/, '') !== entity.key)
    stores[name] = [`&${entity.key}`, ...extra].join(', ')
  }
  return stores
}

// ---------------------------------------------------------------------------
// What the client and the engine both read
// ---------------------------------------------------------------------------

/** A row's identity, from the `[table, key]` pair an outbox row or a fetch record lists. */
export const sameRow = ([table, key]: [string, IndexableType]) => rowKey(table, key)

/** The rows a mutation changed as an outbox row keeps them: the pairs, and what the indexes are built from. */
export function keyed(keys: [string, IndexableType][]): Pick<MutationRow, 'keys' | 'rows' | 'unkeyed'> {
  return { keys, rows: keys.map(sameRow), unkeyed: keys.length ? 0 : 1 }
}

/** Whether `a` comes before `b` in the queue. */
export const queuedBefore = (a: MutationRow, b: MutationRow) => a.createdAt < b.createdAt || (a.createdAt === b.createdAt && a.id < b.id)

/** The outbox, oldest first: the order mutations are applied and sent in. */
export function queuedRows(db: AirplaneDexie) {
  return db.mutations.orderBy('createdAt').toArray()
}

/**
 * A tab closed mid-sync leaves rows marked `syncing`; they were never
 * confirmed, so they go back in the queue. (Sends are idempotent from the
 * outbox's point of view only if the API is; see the docs on retries.)
 */
export async function requeueStuckRows(db: AirplaneDexie) {
  await db.mutations.where('status').equals('syncing').modify({ status: 'pending' })
}

export const TEMP_IDS_KEY = 'tempIds'

/** The placeholder ids the server has named so far, each with its real id. */
export async function readTempIdMap(db: AirplaneDexie): Promise<Record<string, string>> {
  const raw = (await db.meta.get(TEMP_IDS_KEY))?.value
  return raw ? JSON.parse(raw) as Record<string, string> : {}
}

export const QUERY_TABLES_KEY = 'queryTables'

/** Per query document, the tables its `store` has been seen to fill. */
export async function readQueryTableMap(db: AirplaneDexie): Promise<Record<string, string[]>> {
  const raw = (await db.meta.get(QUERY_TABLES_KEY))?.value
  return raw ? JSON.parse(raw) as Record<string, string[]> : {}
}
