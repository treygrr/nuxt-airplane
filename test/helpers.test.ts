import { describe, it, expect } from 'vitest'
import { humanize, queryKey } from '../src/runtime/client'

describe('queryKey', () => {
  it('treats undefined, null and {} as the same empty variables', () => {
    const key = queryKey('GetSites', undefined)
    expect(queryKey('GetSites', null)).toBe(key)
    expect(queryKey('GetSites', {})).toBe(key)
  })

  it('is stable across property order and distinct per value', () => {
    expect(queryKey('GetSite', { id: '1', x: 2 })).toBe(queryKey('GetSite', { x: 2, id: '1' }))
    expect(queryKey('GetSite', { id: '1' })).not.toBe(queryKey('GetSite', { id: '2' }))
  })

  it('namespaces by document', () => {
    expect(queryKey('A', { id: '1' })).not.toBe(queryKey('B', { id: '1' }))
    expect(queryKey('GetSites', {})).toMatch(/^GetSites:/)
  })
})

describe('humanize', () => {
  it('turns operation names into sentences', () => {
    expect(humanize('ArchiveSite')).toBe('Archive site')
    expect(humanize('UpdateSiteItemOnHand')).toBe('Update site item on hand')
    expect(humanize('createV2Order')).toBe('Create v2 order')
    expect(humanize('delete_user')).toBe('Delete user')
  })

  it('splits acronyms from the word that follows', () => {
    expect(humanize('SendHTTPRequest')).toBe('Send http request')
    expect(humanize('ExportCSVReport')).toBe('Export csv report')
    expect(humanize('UpdateSKU')).toBe('Update sku')
  })
})

describe('hasFields', () => {
  it('says whether a row holds every field asked for, null counting as held', async () => {
    const { hasFields } = await import('../src/runtime/hasFields')
    const row: { id: string, name?: string, owner?: { id: string } | null } = { id: 's1', owner: null }
    expect(hasFields(row, 'id')).toBe(true)
    expect(hasFields(row, 'owner')).toBe(true)
    expect(hasFields(row, 'owner', 'name')).toBe(false)
    expect(hasFields({ ...row, name: undefined }, 'name')).toBe(false)
    expect(hasFields(undefined as typeof row | undefined, 'id')).toBe(false)
    expect(hasFields(null as typeof row | null, 'id')).toBe(false)
    // Narrowed: the fields are there to use.
    if (hasFields(row, 'name')) expect(row.name.length).toBeGreaterThan(0)
  })
})
