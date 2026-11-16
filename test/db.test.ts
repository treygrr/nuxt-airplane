// The Dexie layer on fake-indexeddb: the development-only check that warns
// when a boolean lands in an indexed key path.
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDb } from '../src/runtime/db'
import type { AirplaneDexie } from '../src/runtime/types'

interface Site { id: string, siteId?: string, archived?: unknown, done?: unknown, note?: unknown }

let n = 0
let db: AirplaneDexie
let warn: ReturnType<typeof vi.spyOn>

function sites() {
  return db.table<Site>('sites')
}

beforeEach(() => {
  db = createDb(`db-test-${++n}`, { sites: '&id, archived, [siteId+done]' }, 1, { warnOnBooleanIndex: true })
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
  warn.mockRestore()
  await db.delete()
})

describe('boolean index warning', () => {
  it('warns once per table and index when a boolean is written to an indexed key', async () => {
    await sites().put({ id: 's1', archived: true })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toBe('[nuxt-airplane] Table "sites": index "archived" received a boolean, and IndexedDB cannot index booleans; store it as 0 | 1 (see the docs on stores).')

    await sites().put({ id: 's2', archived: false })
    await sites().add({ id: 's3', archived: true })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not warn for 0 | 1 or for booleans in unindexed fields', async () => {
    await sites().put({ id: 's1', archived: 0 })
    await sites().put({ id: 's2', archived: 1 })
    await sites().put({ id: 's3', archived: 1, note: true })
    await sites().bulkPut([{ id: 's4', archived: 0 }, { id: 's5' }])
    expect(warn).not.toHaveBeenCalled()
  })

  it('warns for a boolean in a compound index part, naming the index', async () => {
    await sites().put({ id: 's1', siteId: 'a', done: true })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0]![0]).toContain('index "[siteId+done]" at "done" received a boolean')
  })

  it('is off by default outside dev mode', async () => {
    const quiet = createDb(`db-test-quiet-${n}`, { sites: '&id, archived' })
    await quiet.table('sites').put({ id: 's1', archived: true })
    expect(warn).not.toHaveBeenCalled()
    await quiet.delete()
  })
})
