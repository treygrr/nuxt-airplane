import { Dexie } from 'dexie'
import type { OfflineDexie } from './types'

export function createDb(name: string): OfflineDexie {
  const db = new Dexie(name) as OfflineDexie
  db.version(1).stores({
    queries: '&key, document, updatedAt',
    mutations: '++id, status, createdAt',
  })
  return db
}
