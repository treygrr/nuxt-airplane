// The engine: everything that writes to the tables.
//
// It applies queued mutations, stores responses, and keeps the two layers
// apart. It knows nothing of the network or of Vue: the client decides what
// to send and when, and asks the engine for each write, directly or, when the
// engine runs in a web worker, with a message.

import { Dexie } from 'dexie'
import { hash } from 'ohash'
import { BOOKKEEPING_TABLES, MODULE_STORES, createDb, describeChanges, putRow, quietly, record, thingPath, track, type RowChange } from './db'
import type { IndexableType } from 'dexie'
import { TEMP_IDS_KEY, QUERY_TABLES_KEY, humanize, keyed, mergeStores, newTempId, queryKey, queuedBefore, queuedRows, readQueryTableMap, readTempIdMap, requeueStuckRows, sameRow, splitVariables, substituteTempIds, uuid } from './helpers'
import type {
  AirplaneDexie,
  AirplaneEngine,
  AirplaneStores,
  EntityInfo,
  Locals,
  MutationHandler,
  MutationHandlers,
  MutationRow,
  OperationDocument,
  QueryHandler,
  QueryHandlers,
  ReconcileContext,
} from './types'

/** What the engine is built from: the database's name and shape, the documents and the handlers. */
export interface AirplaneEngineOptions {
  dbName: string
  /** Deploy-specific part of the cache key; see the `database.cacheKey` module option. */
  cacheKey?: string
  documents: Record<string, OperationDocument>
  /** Hash of the compiled documents, mixed into the cache key. */
  documentsHash: string
  /** Types the documents select with an id; each gets a table keyed on it. */
  entities?: Record<string, EntityInfo>
  /** Names of inferred tables left out because nothing in the app mentions them. */
  unusedEntities?: string[]
  mutationHandlers: MutationHandlers
  queryHandlers: QueryHandlers
  stores: AirplaneStores
}

/** Deploy key from config plus the documents hash: either changing busts the cache. */
export const cacheKeyOf = (options: Pick<AirplaneEngineOptions, 'cacheKey' | 'documentsHash'>) => `${options.cacheKey ?? ''}:${options.documentsHash}`

/** The database, declared from the entities and the app's own stores, and the promise of it being open. */
export function openDatabase(options: Pick<AirplaneEngineOptions, 'dbName' | 'entities' | 'unusedEntities' | 'stores'>) {
  const db = createDb(options.dbName, mergeStores(options.entities ?? {}, options.stores.stores), options.stores.version)

  // A table that was left out reads as `undefined` on `db`. Say why instead.
  for (const name of options.unusedEntities ?? []) {
    if (name in db) continue
    Object.defineProperty(db, name, {
      configurable: true,
      get() {
        throw new Error(`[nuxt-airplane] The table "${name}" was not created because nothing in the app mentions it. Use it as \`db.${name}\`, or list it in defineAirplaneStores({ ${name}: '' }) if it is only reached by a computed name.`)
      },
    })
  }

  // A schema that no longer matches what is on disk (lowered version, changed
  // primary key) cannot be opened. This is a cache, so start over rather than
  // leave the app without storage.
  const opened = db.open().catch(async (error: Error) => {
    if (!['VersionError', 'UpgradeError', 'SchemaError'].includes(error.name)) throw error
    console.warn(`[nuxt-airplane] Could not open "${options.dbName}" (${error.name}), recreating it. Bump the store version to migrate instead.`)
    await db.delete()
    await db.open()
  })

  return { db, opened }
}

export function createEngine(options: AirplaneEngineOptions, { db, opened }: { db: AirplaneDexie, opened: Promise<unknown> } = openDatabase(options)): AirplaneEngine {
  const { documents, mutationHandlers, queryHandlers } = options

  const cacheKey = cacheKeyOf(options)

  /** Empties the tables and the fetch records but keeps the outbox, which is applied again on the empty tables. */
  async function clearCache() {
    const tables = db.tables.filter(t => !BOOKKEEPING_TABLES.has(t.name))
    await quietly(db, async () => {
      for (const table of tables) await table.clear()
      // The server versions went with the tables: every row is the queue's own now.
      await db.base.clear()
      await raise(await queued())
    })
  }

  /**
   * Resolves once the cache is known to belong to the current key. Writes
   * wait for it so a response stored by an old deploy's key is never mixed
   * with data stored under the new one.
   */
  let readying: Promise<void> | undefined
  const ready = () => readying ??= opened.then(async () => {
    const stored = (await db.meta.get('cacheKey'))?.value
    if (stored !== undefined && stored !== cacheKey) {
      if (import.meta.dev) console.info(`[nuxt-airplane] Cache key changed, clearing cached data (outbox kept).`)
      await clearCache()
    }
    if (stored !== cacheKey) await db.meta.put({ key: 'cacheKey', value: cacheKey })
    await requeueStuck()
  })

  const requeueStuck = () => requeueStuckRows(db)

  function document(name: string) {
    const doc = documents[name]
    if (!doc) throw new Error(`[nuxt-airplane] Unknown GraphQL document "${name}"`)
    return doc
  }

  function queryHandler(name: string): QueryHandler | undefined {
    return (queryHandlers as Record<string, QueryHandler | undefined>)[name]
  }

  function mutationHandler(name: string): MutationHandler | undefined {
    return (mutationHandlers as Record<string, MutationHandler | undefined>)[name]
  }

  const queued = () => queuedRows(db)

  /** A queued mutation's local variables: the ones it was queued with over the handler's defaults. */
  const localOf = (row: Pick<MutationRow, 'document' | 'local'>): Locals => ({ ...mutationHandler(row.document)?.local, ...row.local })

  /**
   * Writes a response through the `store` handler and records the fetch. A
   * query with neither `store` nor `read` leaves nothing behind.
   *
   * Server data belongs under the queue. Where the response carries a row a
   * queued mutation has changed, it becomes that row's server version and the
   * queue is put on again. The same happens while a queued mutation has
   * found nothing to change yet, since this response may bring its row. Any
   * other response, a page of a catalog nobody is editing, is written
   * straight through at no extra cost.
   */
  async function storeResponse(name: string, variables: unknown, data: unknown) {
    const h = queryHandler(name)
    if (!h?.store && !h?.read) return
    const key = queryKey(name, variables)
    const fetched = (rows?: [string, IndexableType][]) =>
      db.queries.put({ key, document: name, variables, updatedAt: Date.now(), ...(rows && { rows }) })
    if (!h.store) {
      await fetched()
      return
    }
    const store = () => h.store!({ db, variables: variables as never }, data as never)
    await quietly(db, async () => {
      // A queued mutation that found nothing to change may find its row in this response.
      let again = (await db.mutations.where('unkeyed').equals(1).toArray()).some(m => mutationHandler(m.document)?.apply)
      const brought = track()
      // No row has a server version set aside: there is no second layer to keep apart.
      if (!await db.base.count()) await store()
      else {
        const { changes } = await record(db, store)
        for (const { table, key, after } of changes) {
          if (!await db.base.get([table, key])) continue
          await db.base.put(after === undefined ? { table, key, absent: 1 } : { table, key, row: after })
          again = true
        }
      }
      brought.stop()
      if (again) await rebuild()
      // The record keeps the rows of earlier fetches too, so one the server stopped returning can still be dropped.
      for (const row of (await db.queries.get(key))?.rows ?? []) {
        if (!brought.rows.has(sameRow(row))) brought.rows.set(sameRow(row), row)
      }
      const rows = [...brought.rows.values()]
      await learnTables(name, rows)
      await fetched(rows)
    })
  }

  // --------------------------------------------------------------------------
  // Which tables a query fills (meta table)
  //
  // Learned from what its `store` writes, and kept: after a sync, a query is
  // refetched when a mutation changed a table it fills.
  // --------------------------------------------------------------------------

  let knownTables: Record<string, string[]> | undefined

  const readQueryTables = () => readQueryTableMap(db)

  async function learnTables(name: string, rows: [string, IndexableType][]) {
    knownTables ??= await readQueryTables()
    const known = knownTables[name] ?? []
    const added = [...new Set(rows.map(([table]) => table))].filter(table => !known.includes(table))
    if (!added.length) return
    knownTables = { ...knownTables, [name]: [...known, ...added] }
    await db.meta.put({ key: QUERY_TABLES_KEY, value: JSON.stringify(knownTables) })
  }

  // --------------------------------------------------------------------------
  // Room
  //
  // A cache that only grows meets the browser's allowance sooner or later.
  // Each fetch record lists the rows its `store` wrote, so the least recently
  // fetched can go, rows and record together, when room runs out. A row the
  // queue has changed, or that a record being kept lists too, stays.
  // --------------------------------------------------------------------------

  async function evict(keep: string[] = []): Promise<number> {
    return quietly(db, async () => {
      const kept = new Set(keep)
      const records = await db.queries.orderBy('updatedAt').toArray()
      const candidates = records.filter(r => !kept.has(r.key) && r.rows?.length)
      // The oldest quarter: enough to matter, not the whole cache at once.
      const out = candidates.slice(0, Math.ceil(candidates.length / 4))
      if (!out.length) return 0
      const going = new Set(out.map(r => r.key))
      const held = new Set<string>()
      for (const r of records) {
        if (!going.has(r.key)) r.rows?.forEach(row => held.add(sameRow(row)))
      }
      for (const m of await queued()) m.keys?.forEach(row => held.add(sameRow(row)))
      let dropped = 0
      for (const { rows } of out) {
        for (const row of rows!) {
          if (held.has(sameRow(row))) continue
          held.add(sameRow(row))
          await putRow(db, row[0], row[1], undefined)
          dropped++
        }
      }
      await db.queries.bulkDelete(out.map(r => r.key))
      if (import.meta.dev) console.info(`[nuxt-airplane] Storage is running low: dropped ${dropped} cached rows from the ${out.length} least recently fetched queries.`)
      return dropped
    })
  }

  /**
   * Runs `apply` for a queued mutation on top of the tables. The first time
   * the queue changes a row, the row as it was goes to `base` as the server's
   * version. The outbox row gets the rows it changed and what it created and
   * wrote. Returns what it touched and wrote.
   */
  async function applyMutation(row: MutationRow, { tolerant = false } = {}): Promise<{ touched: Set<string>, wrote: Set<string> }> {
    const h = mutationHandler(row.document)
    if (!h?.apply) {
      if (row.keys?.length) await db.mutations.update(row.id, { ...keyed([]), creates: [], writes: [] })
      return { touched: new Set(), wrote: new Set() }
    }
    // Ids minted on the first apply are handed out again each time, in the
    // same order, so a re-applied create keeps the id later mutations reference.
    const tempIds = [...(row.tempIds ?? [])]
    let minted = 0
    const tempId = () => (tempIds[minted] ??= newTempId(), tempIds[minted++]!)
    const { changes, error } = await record(db, () =>
      h.apply!({ db, variables: row.variables as never, local: localOf(row), tempId }), { tolerant })
    // Said once per mutation, not every time the queue is put back on.
    if (!error) skipped.delete(row.id)
    else if (!skipped.has(row.id)) {
      skipped.add(row.id)
      console.warn(`[nuxt-airplane] "${row.document}" could not be applied again on the current data, so its change is not shown locally until it syncs:`, error)
    }
    await keepBase(changes)
    const { created, touched, wrote } = describeChanges(changes)
    await db.mutations.update(row.id, { tempIds, ...keyed(changes.map(c => [c.table, c.key])), creates: [...created], writes: [...wrote] })
    return { touched, wrote }
  }

  /** Queued mutations whose last re-apply threw. */
  const skipped = new Set<number>()

  /**
   * Applies a queued mutation again when the queue is put back on. A handler
   * that throws on what it now finds must not take the others down with it,
   * or keep a response from being stored: what it wrote is taken back, the
   * mutation stays queued with nothing applied, and the next time tries again.
   */
  function reapply(row: MutationRow) {
    return applyMutation(row, { tolerant: true })
  }

  // --------------------------------------------------------------------------
  // The two layers
  //
  // The tables show server data with the queue applied. `base` holds the
  // server's version of each row the queue changed. Taking the queue off is
  // putting those rows back; putting it on is applying it in order.
  // --------------------------------------------------------------------------

  /** Keeps the server's version of each row in `changes` that the queue had not changed before. */
  async function keepBase(changes: RowChange[]) {
    for (const { table, key, before } of changes) {
      if (await db.base.get([table, key])) continue
      await db.base.put(before === undefined ? { table, key, absent: 1 } : { table, key, row: before })
    }
  }

  /** Takes the queue off: every row it changed goes back to the server's version. */
  async function lower(keys?: [string, IndexableType][]) {
    const entries = keys ? (await db.base.bulkGet(keys)).filter(e => !!e) : await db.base.toArray()
    for (const entry of entries) await putRow(db, entry.table, entry.key, entry.absent ? undefined : entry.row)
    if (keys) await db.base.bulkDelete(keys)
    else await db.base.clear()
  }

  /** Puts mutations on, oldest first. */
  async function raise(rows: MutationRow[]) {
    for (const row of rows) await reapply(row)
  }

  /** Takes the whole queue off and puts it back on, with `between` run on server data alone. */
  function rebuild(between?: () => Promise<unknown>) {
    return quietly(db, async () => {
      await lower()
      await between?.()
      await raise(await queued())
    })
  }

  /** The other queued mutations that changed a row `row` changed too, oldest first. */
  async function sharers(row: MutationRow) {
    if (!row.rows?.length) return []
    const found = await db.mutations.where('rows').anyOf(row.rows).distinct().toArray()
    return found.filter(m => m.id !== row.id).sort((a, b) => (queuedBefore(a, b) ? -1 : 1))
  }

  /** Whether any of `rows` changed a row that `row` changed too. */
  function sharesRows(row: MutationRow, rows: MutationRow[]) {
    const mine = new Set(row.keys?.map(sameRow))
    return rows.some(m => m.keys?.some(k => mine.has(sameRow(k))))
  }

  /**
   * The server accepted a mutation: its change is server data now. Where no
   * other queued mutation changed the same rows, those rows as they stand are
   * the server's version, and their `base` entries simply go. Otherwise the
   * queue comes off, the accepted change is applied to the server data, and
   * the rest goes back on.
   */
  function acknowledge(id: number) {
    return quietly(db, async () => {
      const row = await db.mutations.get(id)
      if (!row) return
      await db.mutations.delete(id)
      // The usual case, and what a long queue rests on: found by index, the queue is not read.
      if (!(await sharers(row)).length) {
        if (row.keys?.length) await db.base.bulkDelete(row.keys)
        return
      }
      const rest = await queued()
      await lower()
      const h = mutationHandler(row.document)
      const ids = [...(row.tempIds ?? [])]
      if (h?.apply) await record(db, () => h.apply!({ db, variables: row.variables as never, local: localOf(row), tempId: () => ids.shift() ?? newTempId() }), { tolerant: true })
      await raise(rest)
    })
  }

  // --------------------------------------------------------------------------
  // Temp id map (meta table), see `substituteTempIds`
  // --------------------------------------------------------------------------

  /**
   * Resolved ids are kept after the outbox drains: a component may still hold
   * a temp id it read before the create synced. The map is capped instead,
   * oldest first, which is far more than one outbox would ever carry.
   */
  const TEMP_IDS_MAX = 1000

  const readTempIds = () => readTempIdMap(db)

  async function resolveTempId(tempId: string, id: string) {
    await quietly(db, async () => {
      // A create that reaches the server twice (a tab closed mid-sync) is
      // handed the id its first run resolved to. That is a real row now, not
      // a placeholder: pointing it at the duplicate would redirect later
      // mutations from one server row to another.
      if (tempId === id || Object.values(await readTempIds()).includes(tempId)) return
      await moveRow(tempId, id)
      await rewriteQueue(tempId, id)
      const entries = Object.entries(await readTempIds()).filter(([key]) => key !== tempId)
      entries.push([tempId, id])
      await db.meta.put({ key: TEMP_IDS_KEY, value: JSON.stringify(Object.fromEntries(entries.slice(-TEMP_IDS_MAX))) })
    })
  }

  /**
   * Points the queued mutations that carry a placeholder at the server's id
   * instead: in their variables, so applying them again targets the row
   * where `moveRow` put it; in the minted ids of the mutation that created
   * it, so applying the create again writes the same row; and in the rows
   * and things they are recorded as having changed, which moved with it.
   */
  async function rewriteQueue(tempId: string, id: string) {
    const ids = { [tempId]: id }
    await db.mutations.toCollection().modify((row: MutationRow) => {
      const { value, replaced } = substituteTempIds(row.variables, ids)
      if (replaced) row.variables = value
      // A placeholder in a local variable is what `apply` reads too.
      if (row.local) {
        const local = substituteTempIds(row.local, ids)
        if (local.replaced) row.local = local.value
      }
      if (row.tempIds?.includes(tempId)) row.tempIds = row.tempIds.map(t => (t === tempId ? id : t))
      if (row.keys) Object.assign(row, keyed(row.keys.map(([table, key]) => [table, key === tempId ? id : key])))
      if (row.creates) row.creates = row.creates.map(path => rekeyThing(path, tempId, id))
      if (row.writes) row.writes = row.writes.map(path => rekeyThing(path, tempId, id))
    })
  }

  /** A thing's path, moved with the row `moveRow` re-keyed. */
  function rekeyThing(path: string, tempId: string, id: string) {
    for (const table of db.tables) {
      const from = thingPath([table.name, tempId])
      if (path === from || path.startsWith(`${from}/`) || path.startsWith(`${from}#`)) return thingPath([table.name, String(id)]) + path.slice(from.length)
    }
    return path
  }

  /** A copy of `row` with its primary key, kept at `keyPath`, set to `id`. */
  function rekeyed<T extends object>(row: T, keyPath: string, id: string): T {
    const copy = Dexie.deepClone(row)
    Dexie.setByKeyPath(copy, keyPath, id)
    return copy
  }

  /**
   * Re-keys the row created under a placeholder, in whichever table holds
   * it, inferred or declared, and its entry in `base` with it, so the row
   * stays put once the server has named it. A copy of it nested in another
   * row, or a reference to it there, is left to the next refetch.
   */
  async function moveRow(tempId: string, id: string) {
    for (const table of db.tables.filter(t => !(t.name in MODULE_STORES))) {
      const { keyPath } = table.schema.primKey
      // A lone placeholder is never the whole of a compound key.
      if (Array.isArray(keyPath)) continue
      const row = await table.get(tempId)
      if (row !== undefined) {
        await table.delete(tempId)
        if (keyPath) await table.put(rekeyed(row, keyPath, id))
        else await table.put(row, id)
      }
      const entry = await db.base.get([table.name, tempId])
      if (!entry) continue
      await db.base.delete([table.name, tempId])
      await db.base.put({ ...entry, key: id, row: keyPath && entry.row ? rekeyed(entry.row as object, keyPath, id) : entry.row })
    }
  }

  /** The context `reconcile` runs with. */
  function reconcileContext(variables: unknown, local: Locals, tempIds: string[] = []): ReconcileContext<never, never> {
    return { db, variables: variables as never, local: local as never, tempIds, resolve: resolveTempId }
  }

  /**
   * What a new mutation is linked to in the queue. It depends on the rows
   * that minted a placeholder its variables carry, and on those that created
   * something its `apply` touched (a row, or an element of a list inside
   * one): the server has seen neither yet. And it comes after the rows that
   * wrote a piece it writes too. A placeholder already resolved is a real id
   * by the time the mutation is sent, so it links nothing. A placeholder in
   * a local variable links as well: `apply` reads it like the others.
   */
  async function linksOf(id: number, variables: unknown, local: Locals | undefined, { touched, wrote }: { touched: Set<string>, wrote: Set<string> }) {
    const { unresolved } = substituteTempIds([variables, local], await readTempIds())
    // By index: a queue of thousands is not read to link one more to it.
    const ids = async (index: 'tempIds' | 'creates' | 'writes', values: Iterable<string>) =>
      (await db.mutations.where(index).anyOf([...values]).distinct().primaryKeys()).filter(found => found !== id)
    const dependsOn = [...new Set([...await ids('tempIds', unresolved), ...await ids('creates', touched)])].sort((a, b) => a - b)
    const after = (await ids('writes', wrote)).filter(found => !dependsOn.includes(found)).sort((a, b) => a - b)
    return { dependsOn, after }
  }

  async function describeMutation(name: string, variables: unknown, local: Locals) {
    const { describe } = mutationHandler(name) ?? {}
    if (typeof describe === 'string') return describe
    if (describe) return describe({ db, variables: variables as never, local: local as never })
    return humanize(name)
  }

  const union = <T>(a: T[] = [], b: T[] = []) => [...new Set([...a, ...b])]

  /**
   * Folds the mutation just queued into an earlier one of the same document,
   * if its `merge` takes the two as one. Its effect is on the tables already,
   * so the earlier one only takes over the variables and what it changed.
   * Resolves with the merged row, or nothing when the two stay apart.
   *
   * The earlier one is looked for among the mutations that changed a row the
   * new one changed too, newest first: two changes to the same thing share
   * its row, and those are found by index however long the queue is. A
   * mutation that changed nothing is looked for among those of its document.
   * Only a mutation that has never been sent is merged into: the server may
   * have seen one that was, and would take a changed version of it for a
   * retry. And only when nothing queued between the two has to do with the
   * new one, the new one minted nothing, and both carry the same local
   * variables: `merge` sees only the variables, so two mutations whose
   * local ones differ are not the same change.
   */
  async function fold(row: MutationRow) {
    const merge = mutationHandler(row.document)?.merge as ((a: unknown, b: unknown) => unknown) | undefined
    if (!merge || row.tempIds?.length) return
    const shared = await sharers(row)
    const candidates = row.rows?.length
      ? shared
      : (await db.mutations.where('document').equals(row.document).sortBy('createdAt')).filter(m => m.id !== row.id)
    let into: MutationRow | undefined
    let merged: unknown
    for (const m of candidates.reverse()) {
      if (m.document !== row.document || m.status !== 'pending' || m.attempts || hash(m.local ?? {}) !== hash(row.local ?? {})) continue
      merged = merge(m.variables, row.variables)
      if (!merged) continue
      into = m
      break
    }
    if (!into) return
    // Between the two: anything that shares a row with the new one, is linked
    // to it, or could be about anything.
    const target = into
    const between = (m: MutationRow) => m.id !== row.id && m.id !== target.id && queuedBefore(target, m)
    if (shared.some(between)) return
    const links = [...(row.dependsOn ?? []), ...(row.after ?? [])]
    if ((await db.mutations.bulkGet(links)).some(m => m && between(m))) return
    if ((await db.mutations.where('unkeyed').equals(1).toArray()).some(between)) return
    const others = (ids?: number[]) => ids?.filter(id => id !== target.id)
    await db.mutations.delete(row.id)
    await db.mutations.update(target.id, {
      variables: merged,
      ...keyed([...new Map([...(target.keys ?? []), ...(row.keys ?? [])].map(k => [sameRow(k), k])).values()]),
      creates: union(target.creates, row.creates),
      writes: union(target.writes, row.writes),
      dependsOn: union(target.dependsOn, others(row.dependsOn)),
      after: union(target.after, others(row.after)),
    })
    return (await db.mutations.get(target.id))!
  }

  /** The last mutation being queued: the next one waits for it. */
  let queuing: Promise<unknown> = Promise.resolve()

  /**
   * Mutations are queued, and applied, in the order they were called, one at
   * a time: two fired without awaiting the first (add an item, then put it in
   * a cart) land as written, whichever is quicker to describe.
   */
  function enqueueLocal(name: string, input: unknown) {
    const row = queuing.then(() => enqueueNext(name, input))
    queuing = row.catch(() => {})
    return row
  }

  async function enqueueNext(name: string, input: unknown) {
    if (document(name).kind !== 'mutation') throw new Error(`[nuxt-airplane] "${name}" is not a mutation`)
    await ready()
    // What is sent, and what only the handler gets.
    const split = splitVariables(name, input, { declared: document(name).variables, local: mutationHandler(name)?.local })
    // A placeholder the server has already named is its real id from the start.
    const tempIdMap = await readTempIds()
    const named = substituteTempIds(split.server, tempIdMap).value
    const namedLocal = substituteTempIds(split.local, tempIdMap).value
    const description = await describeMutation(name, named, namedLocal)
    // One transaction: the mutation is queued with its effect applied and its
    // dependencies known, or not at all if `apply` throws, and no rebase can
    // find it half-queued.
    let queuedAs: number | undefined
    const idempotencyKey = uuid()
    let folded = false
    const row = await db.transaction('rw', db.tables, async () => {
      const ids = await readTempIds()
      const variables = substituteTempIds(named, ids).value
      const local = Object.keys(namedLocal).length ? substituteTempIds(namedLocal, ids).value : undefined
      // The queue is ordered by this, so it must not step back with the clock.
      const createdAt = Math.max(Date.now(), (await db.mutations.orderBy('createdAt').last())?.createdAt ?? 0)
      const id = queuedAs = await db.mutations.add({ document: name, variables, ...(local && { local }), description, status: 'pending', createdAt, idempotencyKey, unkeyed: 1 } as MutationRow)
      const did = await applyMutation((await db.mutations.get(id))!)
      await db.mutations.update(id, await linksOf(id, variables, local, did))
      const row = (await db.mutations.get(id))!
      const into = await fold(row)
      folded = !!into
      return into ?? row
    }).catch(async (error) => {
      // An abort removes the row. An `apply` that awaited something other
      // than a Dexie operation made the transaction commit instead, row
      // included: the caller is told it failed, so it must not be sent. By
      // its key as well as its id: IndexedDB hands the id of an aborted row
      // to the next one, which is another mutation and stays.
      if (queuedAs !== undefined) await db.mutations.where('id').equals(queuedAs).and(m => m.idempotencyKey === idempotencyKey).delete()
      throw error
    })
    if (!folded) return row
    // Said in words outside the transaction, as `describe` may await anything.
    // Skipped if another change was folded in meanwhile: that one says it.
    const said = await describeMutation(name, row.variables, localOf(row))
    await db.mutations.where('id').equals(row.id).modify((m: MutationRow) => {
      if (hash(m.variables) === hash(row.variables)) m.description = said
    })
    return (await db.mutations.get(row.id)) ?? row
  }

  /**
   * Undo a queued mutation and drop it from the outbox. Where no later
   * mutation changed the same rows or is linked to it, its rows go back to
   * the server's version and that is all. Otherwise the queue comes off and
   * goes back on without it.
   *
   * A mutation that depended on a dropped one is dropped with it when it has
   * nothing left to do: it carries a placeholder that will now never resolve,
   * or applying it again changes nothing (a quantity set on an item that is
   * gone). One that still does something stays queued on its own, such as a
   * corrected save of the same row. Resolves with the mutations it dropped.
   */
  async function rollbackLocal(id: number): Promise<MutationRow[]> {
    const target = await db.mutations.get(id)
    if (!target || target.status === 'syncing') return []
    // The hook is for what `apply` did outside the database, so it runs outside the transaction.
    await mutationHandler(target.document)?.revert?.({ db, variables: target.variables as never, local: localOf(target) as never })
    const dropped = await quietly(db, async () => {
      const rows = await queued()
      const row = rows.find(m => m.id === id)
      if (!row || row.status === 'syncing') return []
      const others = rows.filter(m => m.id !== id)
      await db.mutations.delete(id)
      const linked = others.some(m => m.dependsOn?.includes(id) || m.after?.includes(id))
      if (!linked && !sharesRows(row, others)) {
        if (row.keys?.length) await lower(row.keys)
        return [row]
      }
      await lower()
      const gone = [row]
      const lost = (ids?: number[]) => !!ids?.some(d => gone.some(m => m.id === d))
      for (const m of others) {
        const orphan = lost(m.dependsOn)
        const placeholders = gone.flatMap(d => d.tempIds ?? [])
        const stuck = orphan && substituteTempIds([m.variables, m.local], {}).unresolved.some(t => placeholders.includes(t))
        if (!stuck && ((await reapply(m)).touched.size || !orphan)) {
          if (orphan || lost(m.after)) {
            const left = (ids?: number[]) => ids?.filter(d => !gone.some(x => x.id === d))
            await db.mutations.update(m.id, { dependsOn: left(m.dependsOn), after: left(m.after) })
          }
          continue
        }
        await db.mutations.delete(m.id)
        gone.push(m)
      }
      return gone
    })
    return dropped
  }

  /** Runs a mutation's `reconcile` with the server's answer. */
  async function reconcileLocal(name: string, variables: unknown, tempIds: string[], result: unknown, local?: Locals) {
    await mutationHandler(name)?.reconcile?.(reconcileContext(variables, localOf({ document: name, local }), tempIds), result as never)
  }

  /** Empties every table, including the outbox. */
  async function clearLocal() {
    await db.transaction('rw', db.tables, async () => {
      for (const table of db.tables) await table.clear()
    })
    knownTables = undefined
    await db.meta.put({ key: 'cacheKey', value: cacheKey })
  }

  return {
    ready,
    storeResponse,
    enqueue: enqueueLocal,
    acknowledge,
    rollback: rollbackLocal,
    reconcile: reconcileLocal,
    clearCache,
    clear: clearLocal,
    evict,
  }
}
