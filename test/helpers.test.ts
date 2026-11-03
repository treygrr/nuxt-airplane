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
