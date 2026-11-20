import { computed, getCurrentInstance, onMounted, onScopeDispose, onServerPrefetch, ref, shallowRef, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { useNuxtApp } from '#app'
import { queryKey } from '../request'
import { GraphQLRequestError, OfflineError, type GraphQLError, type QueryName, type QueryResult, type QueryVariables } from '../types'
import type { AirplaneClient } from '../client'

export interface UseOnlineQueryOptions {
  /** Nothing is fetched while this is `false`; `data` keeps the last answer. Default `true`. */
  enabled?: MaybeRefOrGetter<boolean>
  /**
   * Send the query again once the app is back online when a run was skipped
   * offline, or got no answer from the network. Default `true`.
   */
  refetchOnReconnect?: boolean
  /**
   * Fetch while the page is rendered on the server and hand the answer to
   * the browser in the page, so the first render has `data` and the browser
   * does not ask again. Default `true`.
   */
  server?: boolean
}

export interface UseOnlineQueryReturn<T> {
  /** The last answer from the server, or `null`. Kept through errors, while off, and while new variables are on their way. */
  data: Ref<T | null>
  /** Why the last run has no answer: the server's errors, the network, or `OfflineError`. Cleared by an answer. */
  error: Ref<Error | null>
  /** `true` while a request is on its way. */
  fetching: Ref<boolean>
  /** When `data` came from the server, or `null`. */
  updatedAt: Ref<number | null>
  /** Asks the server again with the current variables. Does nothing while off. */
  refresh: () => Promise<void>
}

/** What server-side rendering asks with; provided by the module's server plugin. */
export interface AirplaneServer {
  ask: <T>(name: string, variables: unknown) => Promise<T>
}

/** What the server leaves in the page for the browser: an answer, or the error that stood for one. */
type PayloadEntry
  = | { data: unknown, updatedAt: number }
    | { error: { name: string, message: string, status?: number, errors?: GraphQLError[] } }

/** An `Error` cannot go into the page as it is; its parts can. */
function toEntryError(e: unknown): Extract<PayloadEntry, { error: unknown }>['error'] {
  const error = e instanceof Error ? e : new Error(String(e))
  const { status } = error as Error & { status?: unknown }
  return {
    name: error.name,
    message: error.message,
    ...(typeof status === 'number' && { status }),
    ...(error instanceof GraphQLRequestError && { errors: error.errors }),
  }
}

function fromEntryError({ name, message, status, errors }: Extract<PayloadEntry, { error: unknown }>['error']): Error {
  if (errors) return new GraphQLRequestError(errors, status)
  return Object.assign(new Error(message), { name, ...(status !== undefined && { status }) })
}

/**
 * A query that is only ever answered by the server: a search, a report,
 * live prices. It never touches the tables, needs no handler, and works
 * during server-side rendering.
 */
export function useOnlineQuery<N extends QueryName>(
  name: N,
  variables?: MaybeRefOrGetter<QueryVariables<N> | undefined>,
  options: UseOnlineQueryOptions = {},
): UseOnlineQueryReturn<QueryResult<N>> {
  const nuxtApp = useNuxtApp()
  const data = shallowRef(null) as Ref<QueryResult<N> | null>
  const error = shallowRef<Error | null>(null)
  const updatedAt = ref<number | null>(null)

  const vars = computed(() => toValue(variables))
  /**
   * The one value watched: the name and the variables compared by value,
   * or `''` while off. Watching the variables themselves would run again on
   * every new object with the same contents.
   */
  const key = computed(() => (toValue(options.enabled ?? true) ? queryKey(name, vars.value) : ''))
  const slot = (k: string) => `airplane:${k}`
  const payload = () => nuxtApp.payload.data as Record<string, PayloadEntry | undefined>

  /** Takes in what the server left in the page. */
  function apply(entry: PayloadEntry) {
    if ('error' in entry) {
      error.value = fromEntryError(entry.error)
      return
    }
    data.value = entry.data as QueryResult<N>
    updatedAt.value = entry.updatedAt
    error.value = null
  }

  // --------------------------------------------------------------------------
  // On the server: fetch while rendering, and leave the answer in the page.
  // --------------------------------------------------------------------------

  if (import.meta.server) {
    const server = (nuxtApp as unknown as { $airplaneServer?: AirplaneServer }).$airplaneServer
    const k = key.value
    const fetchHere = !!k && options.server !== false && !!server && !!getCurrentInstance()
    const fetching = ref(!!k)
    if (fetchHere) {
      onServerPrefetch(async () => {
        // A component before this one may have asked the same already.
        let entry = payload()[slot(k)]
        if (!entry) {
          entry = await server!.ask<QueryResult<N>>(name, vars.value).then(
            (answer): PayloadEntry => ({ data: answer, updatedAt: Date.now() }),
            // A failed query never fails the page: it renders with the error.
            (e): PayloadEntry => ({ error: toEntryError(e) }),
          )
          payload()[slot(k)] = entry
        }
        apply(entry)
        fetching.value = false
      })
    }
    return { data, error, fetching, updatedAt, refresh: async () => {} }
  }

  // --------------------------------------------------------------------------
  // In the browser.
  // --------------------------------------------------------------------------

  const client = (nuxtApp as unknown as { $airplane?: AirplaneClient }).$airplane
  const fetching = ref(!!key.value)

  // Rendered on the server: start from what it left in the page, so the
  // first render matches. An answer, or an error, settles it: nothing more
  // is sent until something changes.
  const hydrating = !!(nuxtApp.isHydrating && nuxtApp.payload.serverRendered)
  const fromServer = hydrating && key.value ? payload()[slot(key.value)] : undefined
  if (fromServer) {
    apply(fromServer)
    fetching.value = false
  }

  if (!client) return { data, error, fetching, updatedAt, refresh: async () => {} }

  /** Each run's number: an answer to an older one is dropped. */
  let seq = 0
  /** The last run was skipped offline, or the network gave no answer: one to make up on reconnect. */
  let missed = false

  async function run() {
    const k = key.value
    if (!k) return
    const id = ++seq
    if (!client!.state.online) {
      error.value = new OfflineError(name)
      missed = true
      fetching.value = false
      return
    }
    fetching.value = true
    try {
      const answer = await client!.ask<QueryResult<N>>(name, vars.value)
      if (id !== seq) return
      data.value = answer
      updatedAt.value = Date.now()
      error.value = null
      missed = false
    }
    catch (e) {
      if (id !== seq) return
      error.value = e as Error
      // The server answered (errors, or an HTTP status): that is the answer. Anything else never arrived.
      missed = !(e instanceof GraphQLRequestError) && typeof (e as { status?: unknown } | null)?.status !== 'number'
    }
    finally {
      if (id === seq) fetching.value = false
    }
  }

  let unmount: (() => void) | undefined
  function follow(k: string, ask: boolean) {
    unmount?.()
    unmount = undefined
    seq++
    missed = false
    if (!k) {
      fetching.value = false
      return
    }
    // Mounted, so a mutation whose `refetch` names this query asks it again.
    unmount = client!.mount(k, run, { online: true })
    if (ask) void run()
  }

  let started = false
  watch(key, (k) => {
    if (started) follow(k, true)
  })

  function start() {
    started = true
    follow(key.value, !fromServer)
  }
  // While hydrating, wait for the page to be mounted so the first render is the server's.
  if (hydrating && getCurrentInstance()) onMounted(start)
  else start()

  watch(() => client.state.online, (online) => {
    if (online && missed && options.refetchOnReconnect !== false) void run()
  })

  onScopeDispose(() => {
    unmount?.()
    seq++
  })

  return { data, error, fetching, updatedAt, refresh: run }
}
