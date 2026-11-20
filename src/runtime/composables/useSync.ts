import { computed, type ComputedRef, type Ref } from 'vue'
import { useNuxtApp } from '#app'
import type { MutationRow } from '../types'
import { useAirplane } from './useAirplane'

export interface UseSyncReturn {
  /** Effective state: the browser reports a connection and `goOffline()` is not in effect. */
  online: Ref<boolean>
  /** What the browser reports, ignoring `goOffline()`. */
  networkOnline: Ref<boolean>
  /** `true` while held offline by `goOffline()`. */
  forcedOffline: Ref<boolean>
  /** A sync batch is being sent. */
  syncing: Ref<boolean>
  /** Nothing is queued and nothing is being sent. */
  synced: ComputedRef<boolean>
  /** Mutations still waiting to reach the server, oldest first. */
  pending: Ref<MutationRow[]>
  /** The pending mutations the server refused, oldest first. They wait for `retry` or `rollback`. */
  failed: ComputedRef<MutationRow[]>
  /** Pending mutations held back because one they depend on failed. */
  blocked: Ref<number>
  /** Size of the batch the current (or last) sync started with. */
  syncTotal: Ref<number>
  /** How many of that batch have been sent so far. */
  syncCount: Ref<number>
  /** Message of the network error that stopped the last sync, if any. */
  lastError: Ref<string | null>
  /** When the module will try again by itself after a sync that could not get through, as a timestamp, or `null`. */
  retryAt: Ref<number | null>
  /** Paginated queries currently being fetched to the end for offline use. */
  prefetching: Ref<number>
  /** Send the queue now. Does nothing while offline. */
  sync: () => Promise<void>
  /** Undo a queued mutation and remove it from the queue, with the ones that depend on it. Resolves with what it dropped. */
  rollback: (id: number) => Promise<MutationRow[]>
  /** The queued mutations that depend on one, directly or not: what rolling it back drops with it. */
  dependents: (id: number) => MutationRow[]
  /** Put a failed mutation back in the queue and sync. */
  retry: (id: number) => Promise<void>
  /** Hold the client offline regardless of the network until `goOnline()`. */
  goOffline: () => void
  /** Release `goOffline()` and sync the queue. */
  goOnline: () => void
}

export function useSync(): UseSyncReturn {
  const client = useAirplane()
  if (!client) {
    const off = async () => {}
    return {
      online: computed(() => true),
      networkOnline: computed(() => true),
      forcedOffline: computed(() => false),
      syncing: computed(() => false),
      synced: computed(() => true),
      pending: computed(() => []),
      failed: computed(() => []),
      blocked: computed(() => 0),
      syncTotal: computed(() => 0),
      syncCount: computed(() => 0),
      lastError: computed(() => null),
      retryAt: computed(() => null),
      prefetching: computed(() => 0),
      sync: off,
      rollback: async () => [],
      dependents: () => [],
      retry: off,
      goOffline: () => {},
      goOnline: () => {},
    }
  }
  const { state } = client
  // A page rendered on the server was rendered online, not held offline,
  // with nothing queued: until the first page has hydrated, say the same,
  // so it matches. The client knows better (a kept "work offline", what is
  // in the outbox) from the start, and says so right after.
  const asRendered = !!useNuxtApp().payload.serverRendered
  const live = <T>(value: () => T, rendered: T) => computed(() => (asRendered && !state.started ? rendered : value()))
  return {
    online: live(() => state.online, true),
    networkOnline: live(() => state.networkOnline, true),
    forcedOffline: live(() => state.forcedOffline, false),
    syncing: live(() => state.syncing, false),
    synced: live(() => client.synced.value, true),
    pending: live(() => state.pending, [] as MutationRow[]),
    failed: live(() => client.failed.value, [] as MutationRow[]),
    blocked: live(() => state.blocked, 0),
    syncTotal: live(() => state.syncTotal, 0),
    syncCount: live(() => state.syncCount, 0),
    lastError: live(() => state.lastError, null),
    retryAt: live(() => state.retryAt, null),
    prefetching: live(() => state.prefetching, 0),
    sync: client.sync,
    rollback: client.rollback,
    dependents: client.dependents,
    retry: client.retry,
    goOffline: client.goOffline,
    goOnline: client.goOnline,
  }
}
