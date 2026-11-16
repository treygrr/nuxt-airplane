// The lab's side door into the server: its chaos settings and resets, over
// plain REST (/api/lab) so they work whatever the chaos is doing to GraphQL.

import type { Chaos } from '../../server/utils/lab'

export function useLab() {
  const chaos = useState<Chaos | null>('lab:chaos', () => null)

  async function load() {
    chaos.value = (await $fetch<{ chaos: Chaos }>('/api/lab')).chaos
  }

  /** Changes the settings given and leaves the others. */
  async function set(patch: Partial<Chaos>) {
    chaos.value = await $fetch<Chaos>('/api/lab/chaos', { method: 'POST', body: patch })
  }

  /** Fresh server data (of `products` products, or the stress catalog), calm settings, zeroed counters. */
  async function reset(body: { products?: number, stress?: boolean } = {}) {
    await $fetch('/api/lab/reset', { method: 'POST', body })
    await load()
  }

  return { chaos, load, set, reset }
}
