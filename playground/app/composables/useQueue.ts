// The queue of changes waiting for the server, as the UI shows it: each row
// with its state and how deep it sits under what it depends on, and the
// bulk actions (retry every failure, clear them).

import type { MutationRow } from '#nuxt-airplane'

export type QueueState = 'pending' | 'syncing' | 'failed' | 'held'

export interface QueueRow {
  row: MutationRow
  state: QueueState
  /** How many links deep it sits: under the change it depends on or comes after. */
  depth: number
}

/** Whether the pending-changes drawer is open, wherever it is opened from. */
export const useQueueDrawer = () => useState('queue-drawer', () => false)

export function useQueue() {
  const sync = useSync()

  /** What a row waits on: the ones it depends on, and the ones it only has to come after. */
  const links = (m: MutationRow) => [...(m.dependsOn ?? []), ...(m.after ?? [])]

  const rows = computed<QueueRow[]>(() => {
    const pending = sync.pending.value
    const byId = new Map(pending.map(m => [m.id, m]))
    // Held back: below a failed change, directly or through others.
    const held = new Set(sync.failed.value.map(m => m.id))
    for (const m of pending) if (links(m).some(id => held.has(id))) held.add(m.id)
    const depths = new Map<number, number>()
    const depth = (m: MutationRow): number => {
      if (depths.has(m.id)) return depths.get(m.id)!
      const parents = links(m).map(id => byId.get(id)).filter((p): p is MutationRow => !!p)
      const d = parents.length ? 1 + Math.max(...parents.map(depth)) : 0
      depths.set(m.id, d)
      return d
    }
    return pending.map(row => ({
      row,
      depth: depth(row),
      state: row.status === 'pending' && held.has(row.id) ? 'held' : row.status,
    }))
  })

  const failed = computed(() => rows.value.filter(r => r.state === 'failed').map(r => r.row))

  /**
   * What clearing the failures takes away: each failed change, and the ones
   * below it that cannot go on without it. The module decides the last part
   * as it rolls back; this is the most it can be.
   */
  const clearable = computed(() => {
    const ids = new Set<number>()
    for (const m of failed.value) {
      ids.add(m.id)
      for (const d of sync.dependents(m.id)) ids.add(d.id)
    }
    return sync.pending.value.filter(m => ids.has(m.id))
  })

  /** Rolls back every failed change, oldest first. Resolves with every change dropped. */
  async function clearFailures() {
    const dropped: MutationRow[] = []
    for (const m of [...failed.value]) {
      // An earlier rollback may have taken this one with it.
      if (!sync.pending.value.some(p => p.id === m.id)) continue
      dropped.push(...await sync.rollback(m.id))
    }
    return dropped
  }

  async function retryFailed() {
    for (const m of [...failed.value]) await sync.retry(m.id)
  }

  return { ...sync, rows, failed, clearable, clearFailures, retryFailed }
}
