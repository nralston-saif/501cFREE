import { describe, expect, it } from 'vitest'
import { findVendorByNames, groupNewVendors, namesOf, type VendorCandidate } from './vendor-groups'

const c = (key: string, vendor_name: string | null, other: string[] = []): VendorCandidate => ({
  key,
  vendor_name,
  vendor_other_names: other,
  vendor_type: 'organization',
})

describe('groupNewVendors', () => {
  it('groups two invoices from the same new vendor into one', () => {
    const groups = groupNewVendors([
      c('july', 'Northwind Advisory Group, LLC', ['Riley Chen']),
      c('aug', 'Northwind Advisory Group LLC', ['Riley Chen']),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ name: 'Northwind Advisory Group, LLC', rowKeys: ['july', 'aug'] })
  })

  it('groups by the person name when the business name differs', () => {
    const groups = groupNewVendors([
      c('a', 'Northwind Advisory Group, LLC', ['Riley Chen']),
      c('b', 'Riley Chen'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].rowKeys).toEqual(['a', 'b'])
  })

  it('merges groups that a later file bridges', () => {
    const groups = groupNewVendors([
      c('a', 'Acme Consulting'),
      c('b', 'Jane Doe'),
      c('c', 'Acme Consulting LLC', ['Jane Doe']),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].rowKeys.sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps different vendors apart and skips nameless files', () => {
    const groups = groupNewVendors([c('a', 'Acme'), c('b', 'Northwind Hosting'), c('c', null)])
    expect(groups.map((g) => g.rowKeys)).toEqual([['a'], ['b']])
  })
})

describe('findVendorByNames', () => {
  const vendors = [{ id: 'v1', display_name: 'Northwind Advisory Group, LLC' }]

  it('matches any name on the document, ignoring suffixes and punctuation', () => {
    expect(findVendorByNames(namesOf(c('x', 'northwind advisory group')), vendors)?.id).toBe('v1')
    expect(findVendorByNames(namesOf(c('x', 'Northwind Advisory Group Inc.')), vendors)?.id).toBe('v1')
    expect(findVendorByNames(namesOf(c('x', 'Riley Chen', ['Northwind Advisory Group'])), vendors)?.id).toBe('v1')
  })

  it('returns null when nothing matches', () => {
    expect(findVendorByNames(namesOf(c('x', 'Someone Else')), vendors)).toBeNull()
  })
})
