// Which rows of a table a queued change has touched: what the UI marks as
// not yet on the server. Each outbox row lists the rows its `apply` changed.

export function usePendingRows(table: string) {
  const sync = useSync()
  return computed(() => {
    const keys = new Set<string>()
    for (const m of sync.pending.value) {
      for (const [t, key] of m.keys ?? []) if (t === table) keys.add(String(key))
    }
    return keys
  })
}

/** The failed mutations, newest first, for messages the user should see. */
export function useFailedMutations() {
  const sync = useSync()
  return computed(() => sync.pending.value.filter(m => m.status === 'failed').reverse())
}
