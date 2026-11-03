import { liveQuery } from 'dexie'
import { hash } from 'ohash'
import { reactive, computed, shallowRef, readonly } from 'vue'
import { createDb } from './db'
import {
  GraphQLRequestError,
  type CacheApi,
  type GraphQLResponse,
  type MutationHandlers,
  type MutationHandler,
  type MutationRow,
  type OfflineDexie,
  type OfflineRuntimeConfig,
  type OperationDocument,
  type QueryName,
  type QueryRow,
  type Updater,
} from './types'

export interface OfflineClientOptions extends OfflineRuntimeConfig {
  documents: Record<string, OperationDocument>
  handlers: MutationHandlers
}

export function queryKey(name: string, variables: unknown) {
  return `${name}:${hash(variables ?? null)}`
}

export type OfflineClient = ReturnType<typeof createOfflineClient>

export function createOfflineClient(options: OfflineClientOptions) {
  const db = createDb(options.dbName)
  const { documents, handlers } = options

  const state = reactive({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncing: false,
    /** Mutations still waiting to be sent, oldest first. */
    pending: [] as MutationRow[],
    /** Size of the batch the current (or last) sync started with. */
    syncTotal: 0,
    /** Mutations of that batch that have reached the server so far. */
    syncCount: 0,
    /** Current pending list could not be sent because of a network error */
    lastError: null as string | null,
  })

  const synced = computed(() => !state.syncing && state.pending.length === 0)

  // Keep the pending list live from the outbox table.
  liveQuery(() => db.mutations.orderBy('createdAt').toArray())
    .subscribe({ next: rows => (state.pending = rows) })

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      state.online = true
      void sync()
    })
    window.addEventListener('offline', () => (state.online = false))
  }

  // --------------------------------------------------------------------------
  // Network
  // --------------------------------------------------------------------------

  function document(name: string) {
    const doc = documents[name]
    if (!doc) throw new Error(`[nuxt-offline] Unknown GraphQL document "${name}"`)
    return doc
  }

  async function request<T>(name: string, variables: unknown): Promise<T> {
    const res = await fetch(options.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: document(name).source, variables: variables ?? undefined }),
    })
    const body = await res.json() as GraphQLResponse<T>
    if (body.errors?.length) throw new GraphQLRequestError(body.errors)
    if (!res.ok) throw new Error(`[nuxt-offline] ${res.status} ${res.statusText}`)
    return body.data as T
  }

  // --------------------------------------------------------------------------
  // Queries
  // --------------------------------------------------------------------------

  /** Refresh callbacks of the queries currently mounted somewhere. */
  const active = new Map<string, () => Promise<void>>()

  async function fetchQuery<T>(name: string, variables: unknown): Promise<T> {
    const data = await request<T>(name, variables)
    await db.queries.put({ key: queryKey(name, variables), document: name, variables, data, updatedAt: Date.now() })
    return data
  }

  function watchQuery(name: string, variables: unknown) {
    const row = shallowRef<QueryRow | undefined>()
    const subscription = liveQuery(() => db.queries.get(queryKey(name, variables)))
      .subscribe({ next: r => (row.value = r) })
    return { row: readonly(row), unsubscribe: () => subscription.unsubscribe() }
  }

  async function refetchActive(only?: QueryName[]) {
    await Promise.allSettled(
      [...active.entries()]
        .filter(([key]) => !only || only.some(name => key.startsWith(`${name}:`)))
        .map(([, refresh]) => refresh()),
    )
  }

  // --------------------------------------------------------------------------
  // Cache API handed to mutation handlers
  // --------------------------------------------------------------------------

  /**
   * Builds the cache helper for one handler run. Every row it touches is
   * recorded (as it was before the first touch) so the change can be undone.
   */
  function createCacheApi(touched?: Map<string, QueryRow | undefined>): CacheApi {
    async function remember(rows: (QueryRow | undefined)[], keys: string[]) {
      if (!touched) return
      keys.forEach((key, i) => {
        if (!touched.has(key)) touched.set(key, rows[i] ? structuredClone(rows[i]) : undefined)
      })
    }

    async function updateRows(rows: QueryRow[], updater: Updater<unknown>) {
      await remember(rows, rows.map(r => r.key))
      const next = rows.map((row) => {
        const data = structuredClone(row.data)
        const returned = updater(data, row.variables)
        return { ...row, data: returned === undefined ? data : returned }
      })
      await db.queries.bulkPut(next)
    }

    return {
      async update(name: string, variablesOrUpdater: unknown, maybeUpdater?: Updater<unknown>) {
        if (typeof variablesOrUpdater === 'function') {
          const rows = await db.queries.where('document').equals(name).toArray()
          await updateRows(rows, variablesOrUpdater as Updater<unknown>)
        }
        else {
          const row = await db.queries.get(queryKey(name, variablesOrUpdater))
          if (row) await updateRows([row], maybeUpdater!)
        }
      },
      async get(name: string, variables?: unknown) {
        return (await db.queries.get(queryKey(name, variables)))?.data as never
      },
      async set(name: string, variables: unknown, data: unknown) {
        const key = queryKey(name, variables)
        await remember([await db.queries.get(key)], [key])
        await db.queries.put({ key, document: name, variables, data, updatedAt: Date.now() })
      },
      async invalidate(name: string) {
        const rows = await db.queries.where('document').equals(name).toArray()
        await remember(rows, rows.map(r => r.key))
        await db.queries.bulkDelete(rows.map(r => r.key))
        await refetchActive([name as QueryName])
      },
    } as CacheApi
  }

  /** Put rows back as they were. Rows that did not exist (`data: undefined`) are deleted. */
  async function restore(snapshot: Map<string, QueryRow | undefined> | QueryRow[]) {
    const entries = snapshot instanceof Map
      ? [...snapshot.entries()]
      : snapshot.map(r => [r.key, r.data === undefined ? undefined : r] as const)
    await db.transaction('rw', db.queries, async () => {
      for (const [key, row] of entries) {
        if (row) await db.queries.put(row)
        else await db.queries.delete(key)
      }
    })
  }

  // --------------------------------------------------------------------------
  // Mutations / outbox
  // --------------------------------------------------------------------------

  function handler(name: string): MutationHandler | undefined {
    return (handlers as Record<string, MutationHandler | undefined>)[name]
  }

  /** Runs `apply` for a queued mutation and stores the snapshot it needs to be undone. */
  async function applyMutation(row: MutationRow) {
    const h = handler(row.document)
    if (!h?.apply) return
    const touched = new Map<string, QueryRow | undefined>()
    try {
      await h.apply({ db, cache: createCacheApi(touched), variables: row.variables })
    }
    catch (error) {
      await restore(touched)
      throw error
    }
    // Rows that were absent are kept too, with their key, so they can be deleted again.
    const snapshot = [...touched.entries()].map(([key, r]) => r ?? { key, document: row.document, variables: null, data: undefined, updatedAt: 0 })
    await db.mutations.update(row.id, { snapshot })
  }

  async function enqueue(name: string, variables: unknown) {
    if (document(name).kind !== 'mutation') throw new Error(`[nuxt-offline] "${name}" is not a mutation`)
    const id = await db.mutations.add({ document: name, variables, status: 'pending', createdAt: Date.now() } as MutationRow)
    const row = (await db.mutations.get(id))!
    await applyMutation(row)
    void sync()
    return row
  }

  /** Undo a queued mutation and drop it from the outbox. */
  async function rollback(id: number) {
    const row = await db.mutations.get(id)
    if (!row) return
    const h = handler(row.document)
    const later = (await db.mutations.where('createdAt').above(row.createdAt).toArray())
      .filter(m => m.status !== 'syncing')

    if (h?.revert) {
      await h.revert({ db, cache: createCacheApi(), variables: row.variables })
      await db.mutations.delete(id)
      return
    }

    // Snapshot mode: rewind the rows this mutation touched, then replay the
    // mutations queued after it on top of the restored data.
    if (row.snapshot) await restore(row.snapshot)
    await db.mutations.delete(id)
    for (const m of later) await applyMutation(m)
  }

  async function retry(id: number) {
    await db.mutations.update(id, { status: 'pending', error: undefined })
    await sync()
  }

  let syncPromise: Promise<void> | null = null

  /** Send every pending mutation, oldest first. Stops at the first network failure. */
  function sync() {
    if (syncPromise) return syncPromise
    syncPromise = runSync().finally(() => (syncPromise = null))
    return syncPromise
  }

  async function runSync() {
    if (!state.online) return
    const queue = await db.mutations.where('status').equals('pending').sortBy('createdAt')
    if (!queue.length) return

    state.syncing = true
    state.syncTotal = queue.length
    state.syncCount = 0
    state.lastError = null
    const refetch = new Set<QueryName>()
    let refetchAll = false

    try {
      for (const row of queue) {
        await db.mutations.update(row.id, { status: 'syncing' })
        try {
          const result = await request(row.document, row.variables)
          const h = handler(row.document)
          await h?.reconcile?.({ db, cache: createCacheApi(), variables: row.variables }, result as never)
          if (h?.refetch) h.refetch.forEach(n => refetch.add(n))
          else refetchAll = true
          await db.mutations.delete(row.id)
          state.syncCount++
        }
        catch (error) {
          if (error instanceof GraphQLRequestError) {
            // The server rejected it: park it so the user can retry or roll it back.
            await db.mutations.update(row.id, { status: 'failed', error: error.message })
            continue
          }
          // Network trouble: leave the rest queued for the next attempt.
          await db.mutations.update(row.id, { status: 'pending' })
          state.lastError = error instanceof Error ? error.message : String(error)
          break
        }
      }
    }
    finally {
      state.syncing = false
    }
    if (state.syncCount) await refetchActive(refetchAll ? undefined : [...refetch])
  }

  async function clear() {
    await db.transaction('rw', db.queries, db.mutations, async () => {
      await db.queries.clear()
      await db.mutations.clear()
    })
  }

  // Attempt to drain anything left over from a previous session.
  void sync()

  return {
    db: db as OfflineDexie,
    state,
    synced,
    documents,
    active,
    fetchQuery,
    watchQuery,
    refetchActive,
    enqueue,
    rollback,
    retry,
    sync,
    clear,
  }
}
