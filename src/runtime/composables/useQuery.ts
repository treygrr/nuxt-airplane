import { computed, getCurrentInstance, onMounted, onScopeDispose, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { hash } from 'ohash'
import type { QueryInput, QueryName, QueryResult } from '../types'
import { useAirplane } from './useAirplane'

export interface UseQueryOptions {
  /** Set to `false` to only read the cache, never the network. */
  fetch?: boolean
}

export interface UseQueryReturn<T> {
  /**
   * The query's result, built live from the tables by its `read` handler, so
   * a mutation that touches them shows at once. A query without `read` gets
   * what the last fetch returned, and nothing while offline.
   */
  data: Ref<T | null>
  /** `true` until the tables have been read and (if online) the first fetch is done. */
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
  /**
   * The query's variables, and any of the local variables its handler
   * declares. Only the query's own are sent and make up the query key; a
   * change to a local one runs `read` again and fetches nothing.
   */
  variables?: MaybeRefOrGetter<QueryInput<N> | undefined>,
  options: UseQueryOptions = {},
): UseQueryReturn<QueryResult<N>> {
  const data = shallowRef(null) as Ref<QueryResult<N> | null>
  const loading = ref(true)
  const fetching = ref(false)
  const error = shallowRef<Error | null>(null)
  const updatedAt = ref<number | null>(null)

  const client = useAirplane()
  if (!client) {
    // Server side: nothing to read from, the client will hydrate from IndexedDB.
    return { data, loading, fetching, error, updatedAt, refresh: async () => {} }
  }

  const vars = computed(() => toValue(variables))
  const split = computed(() => client.splitQuery(name, vars.value))
  const key = computed(() => split.value.key)
  /** Changes when a local variable does and nothing else: `read` runs again, nothing is fetched. */
  const localKey = computed(() => `${key.value}|${hash(split.value.local)}`)
  const readable = client.readable(name)

  async function refresh() {
    if (options.fetch === false || !client!.state.online) {
      // Nothing is coming from the network, and without `read` there is nothing else to show.
      if (!readable) {
        loading.value = false
        if (!client!.state.online) error.value = new Error(`[nuxt-airplane] "${name}" has no query handler with \`read\`, so there is nothing to show offline`)
      }
      return
    }
    fetching.value = true
    try {
      const result = await client!.fetchQuery<QueryResult<N>>(name, vars.value)
      if (!readable) {
        data.value = result
        updatedAt.value = Date.now()
      }
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
    const { snapshot, unsubscribe } = client!.watchQuery(name, vars.value)
    const stop = watch(snapshot, (s) => {
      data.value = (s.data as QueryResult<N>) ?? null
      updatedAt.value = s.updatedAt
      // Something is cached, so don't keep the page waiting on the network.
      if (s.cached) loading.value = false
    }, { immediate: true })
    stopWatch = () => {
      stop()
      unsubscribe()
    }
  }

  let unmount: (() => void) | undefined
  watch(key, (next) => {
    unmount?.()
    unmount = client.mount(next, refresh)
    loading.value = true
    if (!readable) data.value = null
    subscribe()
    void refresh()
  })
  // Only a local variable changed: the same fetch record, read again.
  watch(localKey, (next, prev) => {
    if (next.slice(0, next.indexOf('|')) === prev.slice(0, prev.indexOf('|')) && unmount) subscribe()
  })

  function start() {
    unmount = client!.mount(key.value, refresh)
    subscribe()
    void refresh()
  }
  // Inside a component, wait for hydration so the first render matches the server's.
  if (getCurrentInstance()) onMounted(start)
  else start()

  onScopeDispose(() => {
    unmount?.()
    stopWatch?.()
  })

  return { data, loading, fetching, error, updatedAt, refresh }
}
