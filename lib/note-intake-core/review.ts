import { mergeNotes } from './proposal'
import type {
  ContactKind,
  ContactRole,
  NoteIntakeProposal,
  OrgRelationship,
  ProposedLink,
  ProposedNote,
} from './proposal'

// The review screen's editable state (autosaved to note_intakes.draft)
// and the pure helpers around it. Client-safe.

export type OrgRef =
  | { type: 'none' }
  /** A new organization proposed in the same note, by DraftContact.key */
  | { type: 'new'; key: string }
  /** An organization already in contacts (one of the note's organization links) */
  | { type: 'existing'; id: string; label: string }

export type DraftContact = {
  key: string
  /** Create this contact when filing */
  include: boolean
  kind: ContactKind
  name: string
  email: string
  /** Relationship to your organization */
  role: ContactRole
  // People only
  org: OrgRef
  relationship: OrgRelationship | ''
  title: string
  /** Claude's organization name when it matched nothing we can link */
  organizationHint: string | null
  evidence: string
}

export type DraftNote = {
  key: string
  title: string
  meeting_date: string
  summary: string
  keyPoints: string
  followUps: string
  transcript: string
  file_indexes: number[]
  links: ProposedLink[]
  newContacts: DraftContact[]
}

export type ReviewDraft = { version: 1; notes: DraftNote[] }

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\b(inc|llc|ltd|corp|co|pbc|foundation)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function sameOrg(a: string, b: string): boolean {
  const x = normalizeName(a)
  const y = normalizeName(b)
  return x.length > 0 && x === y
}

type KeyFn = () => string

/** Existing organizations among a note's links */
export function linkedOrganizations(links: ProposedLink[]): ProposedLink[] {
  return links.filter((l) => l.entity_type === 'contact' && l.contact_kind === 'organization')
}

export function draftNoteFromProposal(note: ProposedNote, makeKey: KeyFn): DraftNote {
  const organizations: DraftContact[] = note.new_contacts
    .filter((c) => c.kind === 'organization')
    .map((c) => ({
      key: makeKey(),
      include: true,
      kind: 'organization',
      name: c.name,
      email: '',
      role: c.suggested_role ?? 'contact',
      org: { type: 'none' },
      relationship: '',
      title: '',
      organizationHint: null,
      evidence: c.evidence,
    }))

  const linkedOrgs = linkedOrganizations(note.links)

  const people: DraftContact[] = note.new_contacts
    .filter((c) => c.kind === 'person')
    .map((c) => {
      let org: OrgRef = { type: 'none' }
      let hint: string | null = null
      if (c.organization) {
        const newOrg = organizations.find((o) => sameOrg(o.name, c.organization!))
        const linked = linkedOrgs.find((l) => sameOrg(l.label, c.organization!))
        if (newOrg) org = { type: 'new', key: newOrg.key }
        else if (linked) org = { type: 'existing', id: linked.entity_id, label: linked.label }
        else hint = c.organization
      }
      const orgRole = org.type === 'new' ? organizations.find((o) => o.key === org.key)?.role : undefined
      return {
        key: makeKey(),
        include: true,
        kind: 'person',
        name: c.name,
        email: c.email ?? '',
        role: c.suggested_role ?? orgRole ?? 'contact',
        org,
        relationship: c.role_at_organization ?? (org.type === 'none' ? '' : 'employee'),
        title: c.title ?? '',
        organizationHint: hint,
        evidence: c.evidence,
      }
    })

  return {
    key: makeKey(),
    title: note.title,
    meeting_date: note.meeting_date ?? '',
    summary: note.summary,
    keyPoints: note.key_points.join('\n'),
    followUps: note.follow_ups.join('\n'),
    transcript: note.transcript,
    file_indexes: note.file_indexes,
    links: note.links,
    newContacts: [...organizations, ...people],
  }
}

export function draftFromProposal(proposal: NoteIntakeProposal, makeKey: KeyFn): ReviewDraft {
  return { version: 1, notes: proposal.notes.map((n) => draftNoteFromProposal(n, makeKey)) }
}

export function isReviewDraft(value: unknown): value is ReviewDraft {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as ReviewDraft).version === 1 &&
    Array.isArray((value as ReviewDraft).notes)
  )
}

export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*[-•*]\s*/, '').trim())
    .filter(Boolean)
}

/** Back to the proposal shape (used when merging notes). */
export function draftNoteToProposed(note: DraftNote): ProposedNote {
  return {
    title: note.title,
    meeting_date: note.meeting_date || null,
    summary: note.summary,
    key_points: splitLines(note.keyPoints),
    follow_ups: splitLines(note.followUps),
    transcript: note.transcript,
    file_indexes: note.file_indexes,
    links: note.links,
    new_contacts: [],
  }
}

/** Merge several notes into one, keeping (and deduplicating) their new contacts. */
export function mergeDraftNotes(notes: DraftNote[], makeKey: KeyFn): DraftNote {
  const base = draftNoteFromProposal(mergeNotes(notes.map(draftNoteToProposed)), makeKey)
  const kept: DraftContact[] = []
  const remap = new Map<string, string>()
  for (const c of notes.flatMap((n) => n.newContacts)) {
    const dup = kept.find((k) => k.kind === c.kind && normalizeName(k.name) === normalizeName(c.name))
    if (dup) remap.set(c.key, dup.key)
    else kept.push(c)
  }
  return {
    ...base,
    newContacts: kept.map((c) =>
      c.org.type === 'new' && remap.has(c.org.key) ? { ...c, org: { type: 'new' as const, key: remap.get(c.org.key)! } } : c
    ),
  }
}

// ---------------------------------------------------------------------------
// Creating the new contacts
// ---------------------------------------------------------------------------

export type ContactToCreate = {
  /** Stable key for this unique contact across the whole drop */
  key: string
  kind: ContactKind
  name: string
  email: string | null
  role: ContactRole
  // People only
  org: { type: 'new'; key: string } | { type: 'existing'; id: string } | null
  relationship: OrgRelationship | null
  title: string | null
}

export type CreationPlan = {
  items: ContactToCreate[]
  /** DraftContact.key → ContactToCreate.key (the same contact proposed in two notes creates once) */
  keyMap: Map<string, string>
  problems: string[]
}

function identity(c: DraftContact): string {
  return c.kind === 'person' && c.email.trim()
    ? `person:email:${c.email.trim().toLowerCase()}`
    : `${c.kind}:${normalizeName(c.name)}`
}

/** Everything the reviewer left checked, deduplicated, organizations before people. */
export function buildCreationPlan(notes: DraftNote[]): CreationPlan {
  const byIdentity = new Map<string, ContactToCreate>()
  const keyMap = new Map<string, string>()
  const problems: string[] = []

  const included = notes.flatMap((n) => n.newContacts.filter((c) => c.include))

  // Organizations first, so people can point at them
  for (const c of included.filter((x) => x.kind === 'organization')) {
    if (!c.name.trim()) problems.push('A new organization has no name.')
    const id = identity(c)
    const existing = byIdentity.get(id)
    if (existing) {
      keyMap.set(c.key, existing.key)
      continue
    }
    byIdentity.set(id, {
      key: c.key,
      kind: 'organization',
      name: c.name.trim(),
      email: null,
      role: c.role || 'contact',
      org: null,
      relationship: null,
      title: null,
    })
    keyMap.set(c.key, c.key)
  }

  for (const c of included.filter((x) => x.kind === 'person')) {
    if (!c.name.trim()) problems.push('A new person has no name.')
    let org: ContactToCreate['org'] = null
    if (c.org.type === 'existing') org = { type: 'existing', id: c.org.id }
    if (c.org.type === 'new') {
      const target = keyMap.get(c.org.key)
      // The organization was unchecked: create the person without the affiliation
      if (target) org = { type: 'new', key: target }
    }
    if (org && !c.relationship) problems.push(`Pick ${c.name}'s role at their organization.`)
    const id = identity(c)
    const existing = byIdentity.get(id)
    if (existing) {
      keyMap.set(c.key, existing.key)
      continue
    }
    byIdentity.set(id, {
      key: c.key,
      kind: 'person',
      name: c.name.trim(),
      email: c.email.trim() || null,
      role: c.role || 'contact',
      org,
      relationship: org ? (c.relationship || null) : null,
      title: org ? c.title.trim() || null : null,
    })
    keyMap.set(c.key, c.key)
  }

  return { items: [...byIdentity.values()], keyMap, problems: [...new Set(problems)] }
}

export type CreatedContact = { id: string; label: string; kind: ContactKind }

/**
 * After contacts are created: turn each created card into a link on its note
 * and drop the card, so a retry never creates it twice.
 */
export function applyCreatedContacts(
  notes: DraftNote[],
  keyMap: Map<string, string>,
  created: Record<string, CreatedContact>
): DraftNote[] {
  return notes.map((note) => {
    const links = [...note.links]
    const remaining: DraftContact[] = []
    for (const c of note.newContacts) {
      const result = c.include ? created[keyMap.get(c.key) ?? ''] : undefined
      if (!result) {
        remaining.push(c)
        continue
      }
      if (!links.some((l) => l.entity_type === 'contact' && l.entity_id === result.id)) {
        links.push({
          entity_type: 'contact',
          entity_id: result.id,
          label: result.label,
          contact_kind: result.kind,
          confidence: 'high',
          evidence: c.evidence,
        })
      }
    }
    // People pointing at a now-created organization keep working after reload
    const fixed = remaining.map((c) => {
      if (c.org.type !== 'new') return c
      const result = created[keyMap.get(c.org.key) ?? '']
      return result ? { ...c, org: { type: 'existing' as const, id: result.id, label: result.label } } : c
    })
    return { ...note, links, newContacts: fixed }
  })
}
