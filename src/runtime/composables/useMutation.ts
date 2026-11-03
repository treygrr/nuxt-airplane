import { ref, shallowRef, type Ref } from 'vue'
import type { MutationName, MutationRow, MutationVariables } from '../types'
import { useAirplane } from './useAirplane'

export interface UseMutationReturn<V> {
  /**
   * Applies the mutation to the local cache and queues it for the server.
   * Resolves with the outbox entry as soon as the change is visible locally;
   * the request itself is sent in the background by the sync loop.
   */
  mutate: (variables: V) => Promise<MutationRow>
  /** `true` while the local `apply` handler runs. */
  loading: Ref<boolean>
  error: Ref<Error | null>
}

export function useMutation<N extends MutationName>(name: N): UseMutationReturn<MutationVariables<N>> {
  const loading = ref(false)
  const error = shallowRef<Error | null>(null)
  const client = useAirplane()

  async function mutate(variables: MutationVariables<N>) {
    if (!client) throw new Error('[nuxt-airplane] Mutations can only run on the client')
    loading.value = true
    error.value = null
    try {
      return await client.enqueue(name, variables)
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
