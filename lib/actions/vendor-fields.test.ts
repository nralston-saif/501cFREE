import { describe, expect, it } from 'vitest'
import { vendorFieldsFromInput } from './vendor-fields'
import { applicantFieldsFromInput } from './applicant-fields'
import { nameFieldsFor, parseContactKind } from '@/lib/contacts/names'

describe('vendorFieldsFromInput', () => {
  it('always flags the contact as a vendor and trims the name', () => {
    const f = vendorFieldsFromInput({ name: '  Acme Consulting LLC  ', kind: 'organization' })
    expect(f.is_vendor).toBe(true)
    expect(f.name).toBe('Acme Consulting LLC')
    expect(f.kind).toBe('organization')
    expect(f.first_name).toBeNull()
    expect(f.tax_id).toBeNull()
    expect(f.w9_on_file).toBe(false)
  })

  it('splits a person vendor into first and last name', () => {
    const f = vendorFieldsFromInput({ name: 'Jane  Q. Doe', kind: 'person' })
    expect(f.kind).toBe('person')
    expect(f).toMatchObject({ name: null, first_name: 'Jane', last_name: 'Q. Doe' })
  })

  it('normalizes a blank tax id to null and trims a real one', () => {
    expect(vendorFieldsFromInput({ name: 'X', kind: 'organization', tax_id: '   ' }).tax_id).toBeNull()
    expect(vendorFieldsFromInput({ name: 'X', kind: 'organization', tax_id: ' 12-3456789 ' }).tax_id).toBe(
      '12-3456789'
    )
  })

  it('coerces the W-9 flag to a boolean', () => {
    expect(vendorFieldsFromInput({ name: 'X', kind: 'organization', w9_on_file: true }).w9_on_file).toBe(true)
    expect(vendorFieldsFromInput({ name: 'X', kind: 'organization' }).w9_on_file).toBe(false)
  })
})

describe('applicantFieldsFromInput', () => {
  it('flags the contact as a grantee', () => {
    expect(applicantFieldsFromInput({ name: 'Helix Lab', kind: 'organization' })).toEqual({
      kind: 'organization',
      name: 'Helix Lab',
      first_name: null,
      last_name: null,
      is_grantee: true,
    })
  })
})

describe('contact name helpers', () => {
  it('keeps a one-word person name as a first name', () => {
    expect(nameFieldsFor('person', 'Cher')).toEqual({ name: null, first_name: 'Cher', last_name: null })
  })

  it('accepts the legacy "individual" kind', () => {
    expect(parseContactKind('individual')).toBe('person')
    expect(parseContactKind('organization')).toBe('organization')
    expect(parseContactKind(undefined)).toBe('organization')
  })
})
