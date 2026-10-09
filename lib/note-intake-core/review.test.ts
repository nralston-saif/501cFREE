import { describe, expect, it } from 'vitest'
import type { ProposedNote } from './proposal'
import { applyCreatedContacts, buildCreationPlan, draftNoteFromProposal, mergeDraftNotes } from './review'

let n = 0
const makeKey = () => `k${++n}`

function note(overrides: Partial<ProposedNote> = {}): ProposedNote {
  return {
    title: 'Meeting with Helix',
    meeting_date: null,
    summary: 'Summary',
    key_points: [],
    follow_ups: [],
    transcript: 'x',
    file_indexes: [0],
    links: [
      { entity_type: 'contact', entity_id: 'c-acme', label: 'Acme Labs, Inc.', contact_kind: 'organization', confidence: 'high', evidence: '' },
      { entity_type: 'contact', entity_id: 'p-jo', label: 'Jo Acme', contact_kind: 'person', confidence: 'high', evidence: '' },
    ],
    new_contacts: [
      { kind: 'organization', name: 'Helix Labs', email: null, organization: null, role_at_organization: null, title: null, suggested_role: 'grantee', evidence: 'header' },
      { kind: 'person', name: 'Tom Okafor', email: null, organization: 'Helix Labs', role_at_organization: 'founder', title: 'CTO', suggested_role: null, evidence: 'cofounder' },
      { kind: 'person', name: 'Ana Ruiz', email: 'ana@example.org', organization: 'Acme Labs', role_at_organization: null, title: null, suggested_role: 'donor', evidence: '' },
      { kind: 'person', name: 'Lee Park', email: null, organization: 'Unknown Co', role_at_organization: 'advisor', title: null, suggested_role: null, evidence: '' },
    ],
    ...overrides,
  }
}

describe('draftNoteFromProposal', () => {
  const draft = draftNoteFromProposal(note(), makeKey)
  const [helix, tom, ana, lee] = draft.newContacts

  it('puts a new person under the new organization Claude named', () => {
    expect(tom.org).toEqual({ type: 'new', key: helix.key })
    expect(tom.relationship).toBe('founder')
    expect(tom.title).toBe('CTO')
    // Inherits the organization's role when Claude gave none
    expect(tom.role).toBe('grantee')
  })

  it('matches an existing linked organization despite "Inc." and punctuation', () => {
    expect(ana.org).toEqual({ type: 'existing', id: 'c-acme', label: 'Acme Labs, Inc.' })
    expect(ana.relationship).toBe('employee')
  })

  it('keeps an unmatched organization name as a hint', () => {
    expect(lee.org).toEqual({ type: 'none' })
    expect(lee.organizationHint).toBe('Unknown Co')
    expect(lee.role).toBe('contact')
  })
})

describe('buildCreationPlan', () => {
  it('orders organizations first, dedupes across notes and flags missing org roles', () => {
    const a = draftNoteFromProposal(note(), makeKey)
    const b = draftNoteFromProposal(note(), makeKey)
    const plan = buildCreationPlan([a, b])
    expect(plan.items.map((i) => i.name)).toEqual(['Helix Labs', 'Tom Okafor', 'Ana Ruiz', 'Lee Park'])
    expect(plan.problems).toEqual([])
    expect(plan.items.find((i) => i.name === 'Lee Park')!.role).toBe('contact')
    a.newContacts[1].relationship = ''
    expect(buildCreationPlan([a]).problems).toEqual(["Pick Tom Okafor's role at their organization."])
    // Tom in note b points at note a's Helix (the one that gets created)
    const tom = plan.items.find((i) => i.name === 'Tom Okafor')!
    expect(tom.org).toEqual({ type: 'new', key: a.newContacts[0].key })
    expect(plan.keyMap.get(b.newContacts[1].key)).toBe(a.newContacts[1].key)
  })

  it('drops the affiliation when the organization is unchecked', () => {
    const d = draftNoteFromProposal(note(), makeKey)
    d.newContacts[0].include = false
    const tom = buildCreationPlan([d]).items.find((i) => i.name === 'Tom Okafor')!
    expect(tom.org).toBeNull()
    expect(tom.relationship).toBeNull()
  })
})

describe('applyCreatedContacts', () => {
  it('turns created cards into links and repoints people at created orgs', () => {
    const d = draftNoteFromProposal(note(), makeKey)
    const plan = buildCreationPlan([d])
    const helixKey = d.newContacts[0].key
    const [updated] = applyCreatedContacts([d], plan.keyMap, {
      [helixKey]: { id: 'c-helix', label: 'Helix Labs', kind: 'organization' },
    })
    expect(updated.links.find((l) => l.entity_id === 'c-helix')).toMatchObject({
      entity_type: 'contact',
      contact_kind: 'organization',
    })
    expect(updated.newContacts.map((c) => c.name)).toEqual(['Tom Okafor', 'Ana Ruiz', 'Lee Park'])
    expect(updated.newContacts[0].org).toEqual({ type: 'existing', id: 'c-helix', label: 'Helix Labs' })
  })
})

describe('mergeDraftNotes', () => {
  it('keeps one copy of each new contact and repoints people at the kept org', () => {
    const a = draftNoteFromProposal(note(), makeKey)
    const b = draftNoteFromProposal(note(), makeKey)
    const merged = mergeDraftNotes([a, b], makeKey)
    expect(merged.newContacts.map((c) => c.name)).toEqual(['Helix Labs', 'Tom Okafor', 'Ana Ruiz', 'Lee Park'])
    expect(merged.newContacts[1].org).toEqual({ type: 'new', key: merged.newContacts[0].key })
  })
})
