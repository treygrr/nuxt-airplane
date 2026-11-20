import { ref, shallowRef, type Ref } from 'vue'
import type { MutationInput, MutationName, MutationResult, MutationRow } from '../types'
import { useAirplane } from './useAirplane'

export interface UseMutationOptions {
  /**
   * `false` sends the mutation directly instead of queuing it: `mutate`
   * resolves with the server's data, runs no `apply`, and rejects while
   * offline. For mutations that cannot wait in the outbox, such as a checkout
   * or anything whose response the UI needs. Default `true`.
   */
  queue?: boolean
}

export interface UseMutationReturn<V, R = MutationRow> {
  /**
   * Applies the mutation to the local cache and queues it for the server.
   * Resolves with the outbox entry as soon as the change is visible locally;
   * the request itself is sent in the background by the sync loop.
   *
   * With `queue: false` it sends the request now and resolves with the data
   * the server returned.
   *
   * Takes the mutation's variables and any of the local variables its
   * handler declares. Only the mutation's own are sent; the local ones reach
   * the handler's hooks and are kept on the outbox row.
   */
  mutate: (variables: V) => Promise<R>
  /** `true` while the local `apply` handler runs, or while the request is in flight with `queue: false`. */
  loading: Ref<boolean>
  error: Ref<Error | null>
}

export function useMutation<N extends MutationName>(name: N, options?: UseMutationOptions & { queue?: true }): UseMutationReturn<MutationInput<N>>
export function useMutation<N extends MutationName>(name: N, options: UseMutationOptions & { queue: false }): UseMutationReturn<MutationInput<N>, MutationResult<N>>
export function useMutation<N extends MutationName>(name: N, options: UseMutationOptions = {}): UseMutationReturn<MutationInput<N>, unknown> {
  const loading = ref(false)
  const error = shallowRef<Error | null>(null)
  const client = useAirplane()
  const queue = options.queue ?? true

  async function mutate(variables: MutationInput<N>) {
    if (!client) throw new Error('[nuxt-airplane] Mutations can only run on the client')
    loading.value = true
    error.value = null
    try {
      return queue ? await client.enqueue(name, variables) : await client.execute<MutationResult<N>>(name, variables)
    }
    catch (e) {
      error.value = e as Error
      throw e
    }
    finally {
      loading.value = false
    }
  }

  return { mutate, loading, error }
}
