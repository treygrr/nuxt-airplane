// useAirplaneQuery against a real client: a local variable runs `read` again and
// fetches nothing; a variable of the query fetches.
import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { createAirplaneClient, type AirplaneClient } from '../src/runtime/client'
import type { AirplaneDexie, OperationDocument, QueryHandlers } from '../src/runtime/types'

let client: AirplaneClient | undefined
vi.mock('#app', () => ({ useNuxtApp: () => ({ $airplane: client }) }))

const { useAirplaneQuery } = await import('../src/runtime/composables/useAirplaneQuery')

const documents: Record<string, OperationDocument> = {
  GetItems: { name: 'GetItems', kind: 'query', source: 'query GetItems($siteId: ID!) { items(siteId: $siteId) { id siteId qty } }', variables: ['siteId'] },
}
interface Item { id: string, siteId: string, qty: number }

async function until(check: () => boolean, what: string) {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > 3000) throw new Error(`Timed out waiting for ${what}`)
    await new Promise(r => setTimeout(r, 10))
  }
}

describe('useAirplaneQuery with local variables', () => {
  it('reads again on a local change, and fetches only when a variable of the query changes', async () => {
    const items: Item[] = [{ id: 'a', siteId: 's1', qty: 0 }, { id: 'b', siteId: 's1', qty: 5 }, { id: 'c', siteId: 's2', qty: 0 }]
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const { variables } = JSON.parse(init!.body as string) as { variables: { siteId: string } }
      return Response.json({ data: { items: items.filter(i => i.siteId === variables.siteId) } })
    })
    const table = (db: AirplaneDexie) => db.table<Item, string>('Item')
    client = createAirplaneClient({
      endpoint: 'http://api.test/graphql',
      dbName: 'use-query-local',
      documentsHash: 'h',
      documents,
      entities: { Item: { key: 'id' } },
      mutationHandlers: {},
      queryHandlers: {
        GetItems: {
          local: { empty: false },
          store: ({ db }: { db: AirplaneDexie }, data: { items: Item[] }) => table(db).bulkPut(data.items),
          read: async ({ db, variables, local }: { db: AirplaneDexie, variables: { siteId: string }, local: { empty: boolean } }) => ({
            items: (await table(db).where('id').above('').toArray()).filter(i => i.siteId === variables.siteId && (!local.empty || i.qty === 0)),
          }),
        },
      } as unknown as QueryHandlers,
      stores: { stores: {} },
      request: { fetch: fetch as unknown as typeof globalThis.fetch },
    })

    const siteId = ref('s1')
    const empty = ref(false)
    const scope = effectScope()
    const q = scope.run(() => useAirplaneQuery('GetItems' as never, (() => ({ siteId: siteId.value, empty: empty.value })) as never))!
    const ids = () => (q.data.value as { items: Item[] } | null)?.items.map(i => i.id)

    await until(() => ids()?.length === 2 && !q.loading.value, 'the first fetch')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string).variables).toEqual({ siteId: 's1' })

    empty.value = true
    await nextTick()
    expect(q.loading.value).toBe(false)
    await until(() => ids()?.length === 1, 'read with the local filter')
    expect(ids()).toEqual(['a'])
    expect(fetch).toHaveBeenCalledTimes(1)

    siteId.value = 's2'
    await until(() => fetch.mock.calls.length === 2 && ids()?.[0] === 'c', 'the fetch for the other site')
    expect(JSON.parse(fetch.mock.calls[1]![1]!.body as string).variables).toEqual({ siteId: 's2' })

    scope.stop()
    expect(client.active.size).toBe(0)
  })

  it('while not enabled, reads nothing and fetches nothing; enabled, it starts; off again, it clears', async () => {
    const fetch = vi.fn(async () => Response.json({ data: { items: [{ id: 'a', siteId: 's1', qty: 0 }] } }))
    const read = vi.fn(async ({ db }: { db: AirplaneDexie }) => ({ items: await db.table<Item, string>('Item').toArray() }))
    client = createAirplaneClient({
      endpoint: 'http://api.test/graphql',
      dbName: 'use-query-enabled',
      documentsHash: 'h',
      documents,
      entities: { Item: { key: 'id' } },
      mutationHandlers: {},
      queryHandlers: { GetItems: { store: ({ db }: { db: AirplaneDexie }, data: { items: Item[] }) => db.table('Item').bulkPut(data.items), read } } as unknown as QueryHandlers,
      stores: { stores: {} },
      request: { fetch: fetch as unknown as typeof globalThis.fetch },
    })
    const siteId = ref<string | null>(null)
    const scope = effectScope()
    const q = scope.run(() => useAirplaneQuery('GetItems' as never, (() => ({ siteId: siteId.value })) as never, { enabled: () => !!siteId.value }))!
    expect(q.loading.value).toBe(false)
    await new Promise(r => setTimeout(r, 30))
    expect(fetch).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    await q.refresh()
    expect(fetch).not.toHaveBeenCalled()

    siteId.value = 's1'
    await until(() => !!q.data.value && !q.loading.value, 'the query once enabled')
    expect(fetch).toHaveBeenCalledTimes(1)

    siteId.value = null
    await nextTick()
    expect(q.data.value).toBeNull()
    expect(q.loading.value).toBe(false)
    expect(client.active.size).toBe(0)
    scope.stop()
  })
})
