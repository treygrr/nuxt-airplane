import { computed, getCurrentInstance, onMounted, onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { queryKey } from '../client'
import type { QueryName, QueryResult, QueryVariables } from '../types'
import { useOffline } from './useOffline'

export interface UseQueryOptions {
  /** Set to `false` to only read the cache, never the network. */
  fetch?: boolean
}

export interface UseQueryReturn<T> {
  /** Live data from the local cache. Updates when mutations touch it. */
  data: Ref<T | null>
  /** `true` until the cache has been read and (if online) the first fetch is done. */
  loading: Ref<boolean>
  /** `true` while a network request is in flight. */
  fetching: Ref<boolean>
  error: Ref<Error | null>
  /** When the cached data was last fetched from the server, or `null`. */
  updatedAt: Ref<number | null>
  refresh: () => Promise<void>
}

export function useQuery<N extends QueryName>(
  name: N,
  variables?: MaybeRefOrGetter<QueryVariables<N> | undefined>,
  options: UseQueryOptions = {},
): UseQueryReturn<QueryResult<N>> {
  const data = shallowRef(null) as Ref<QueryResult<N> | null>
  const loading = ref(true)
  const fetching = ref(false)
  const error = shallowRef<Error | null>(null)
  const updatedAt = ref<number | null>(null)

  const client = useOffline()
  if (!client) {
    // Server side: nothing to read from, the client will hydrate from IndexedDB.
    return { data, loading, fetching, error, updatedAt, refresh: async () => {} }
  }

  const vars = computed(() => toValue(variables))
  const key = computed(() => queryKey(name, vars.value))

  async function refresh() {
    if (options.fetch === false || !client!.state.online) return
    fetching.value = true
    try {
      await client!.fetchQuery(name, vars.value)
      error.value = null
    }
    catch (e) {
      error.value = e as Error
    }
    finally {
      fetching.value = false
      loading.value = false
    }
  }

  let stopWatch: (() => void) | undefined
  function subscribe() {
    stopWatch?.()
    const { row, unsubscribe } = client!.watchQuery(name, vars.value)
    const stop = watch(row, (r) => {
      data.value = (r?.data as QueryResult<N>) ?? null
      updatedAt.value = r?.updatedAt ?? null
      // Something is cached, so don't keep the page waiting on the network.
      if (r) loading.value = false
    }, { immediate: true })
    stopWatch = () => {
      stop()
      unsubscribe()
    }
  }

  watch(key, (next, prev) => {
    client.active.delete(prev)
    client.active.set(next, refresh)
    loading.value = true
    subscribe()
    void refresh()
  })

  function start() {
    client!.active.set(key.value, refresh)
    subscribe()
    void refresh()
  }
  // Inside a component, wait for hydration so the first render matches the server's.
  if (getCurrentInstance()) onMounted(start)
  else start()

  onScopeDispose(() => {
    client.active.delete(key.value)
    stopWatch?.()
  })

  return { data, loading, fetching, error, updatedAt, refresh }
}
