// Claude's proposal for a batch of dropped files, and the validation that
// stands between it and the database. Client-safe (the review screen edits
// these shapes).

/** note_links.entity_type values the inbox files onto */
export type LinkEntityType = 'contact' | 'grant_proposal' | 'pri'
export type ContactKind = 'person' | 'organization'
export type Confidence = 'high' | 'medium' | 'low'
/**
 * Relationship to your organization. 'contact' is a general contact (no
 * flag); the others map to the contacts is_lead / is_grantee / … flags.
 */
export type ContactRole = 'contact' | 'lead' | 'grantee' | 'donor' | 'funder' | 'vendor'

export const CONTACT_ROLES: { value: ContactRole; label: string; hint: string }[] = [
  { value: 'contact', label: 'Contact', hint: 'A general contact' },
  { value: 'lead', label: 'Lead', hint: 'A potential grantee' },
  { value: 'grantee', label: 'Grantee', hint: '' },
  { value: 'donor', label: 'Donor', hint: '' },
  { value: 'funder', label: 'Funder', hint: '' },
  { value: 'vendor', label: 'Vendor', hint: '' },
]
/** A person's role at an organization: the affiliations.relationship values */
export type OrgRelationship =
  | 'employee'
  | 'founder'
  | 'executive'
  | 'board_member'
  | 'advisor'
  | 'contact'
  | 'other'

export const ORG_RELATIONSHIPS: { value: OrgRelationship; label: string }[] = [
  { value: 'employee', label: 'Employee' },
  { value: 'founder', label: 'Founder' },
  { value: 'executive', label: 'Executive' },
  { value: 'board_member', label: 'Board member' },
  { value: 'advisor', label: 'Advisor' },
  { value: 'contact', label: 'Contact' },
  { value: 'other', label: 'Other' },
]

/** What the server knows about an id it handed the model */
export type KnownEntity = { label: string; kind?: ContactKind }

export type ProposedLink = {
  entity_type: LinkEntityType
  entity_id: string
  /** Display name, filled in server-side from the search results (never from the model) */
  label: string
  /** Contacts only: person or organization, from the server's records */
  contact_kind?: ContactKind
  confidence: Confidence
  /** Why: a short quote or reason from the source */
  evidence: string
}

export type ProposedNewContact = {
  kind: ContactKind
  name: string
  email: string | null
  /** People: the organization they're with, by name */
  organization: string | null
  /** People: their relationship to that organization */
  role_at_organization: OrgRelationship | null
  /** People: job title, e.g. "CTO" */
  title: string | null
  suggested_role: ContactRole | null
  evidence: string
}

export type ProposedNote = {
  title: string
  meeting_date: string | null
  summary: string
  key_points: string[]
  follow_ups: string[]
  transcript: string
  /** 0-based indexes into the intake's files (ordered by upload) */
  file_indexes: number[]
  links: ProposedLink[]
  new_contacts: ProposedNewContact[]
}

export type NoteIntakeProposal = {
  notes: ProposedNote[]
  /** Anything the reader should know: unreadable pages, illegible handwriting, … */
  warnings: string[]
}

const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const ORG_RELATIONSHIP_VALUES = ORG_RELATIONSHIPS.map((r) => r.value)

/** JSON schema for output_config.format (no numeric/length constraints — unsupported). */
export const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['notes', 'warnings'],
  properties: {
    notes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'title', 'meeting_date', 'summary', 'key_points', 'follow_ups', 'transcript',
          'file_indexes', 'links', 'new_contacts',
        ],
        properties: {
          title: { type: 'string', description: 'Short title, e.g. "Call with Jane Doe (Example Org)"' },
          meeting_date: { ...nullableString, description: 'YYYY-MM-DD if the source states or clearly implies it, else null' },
          summary: { type: 'string', description: 'Two to four sentences' },
          key_points: { type: 'array', items: { type: 'string' } },
          follow_ups: { type: 'array', items: { type: 'string' }, description: 'Action items, with owner when stated' },
          transcript: { type: 'string', description: 'Faithful transcription of the source content for this note' },
          file_indexes: { type: 'array', items: { type: 'integer' }, description: '0-based indexes of the files this note came from' },
          links: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['entity_type', 'entity_id', 'confidence', 'evidence'],
              properties: {
                entity_type: { type: 'string', enum: ['contact', 'grant_proposal', 'pri'] },
                entity_id: { type: 'string', description: 'An id returned by search_contacts or listed in the records' },
                confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                evidence: { type: 'string' },
              },
            },
          },
          new_contacts: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['kind', 'name', 'email', 'organization', 'role_at_organization', 'title', 'suggested_role', 'evidence'],
              properties: {
                kind: { type: 'string', enum: ['person', 'organization'] },
                name: { type: 'string' },
                email: nullableString,
                organization: { ...nullableString, description: 'People only: the organization they are with, by name' },
                role_at_organization: {
                  anyOf: [{ type: 'string', enum: ORG_RELATIONSHIP_VALUES }, { type: 'null' }],
                  description: 'People only: their relationship to that organization',
                },
                title: { ...nullableString, description: 'People only: job title if stated, e.g. "CTO"' },
                suggested_role: {
                  anyOf: [{ type: 'string', enum: ['contact', 'lead', 'grantee', 'donor', 'funder', 'vendor'] }, { type: 'null' }],
                  description:
                    'Relationship to your organization: lead = potential grantee not yet applying; grantee, donor, funder, vendor; contact = anyone else',
                },
                evidence: { type: 'string' },
              },
            },
          },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const CONFIDENCE: Confidence[] = ['high', 'medium', 'low']
const ROLES: ContactRole[] = ['contact', 'lead', 'grantee', 'donor', 'funder', 'vendor']
const RELATIONSHIPS: OrgRelationship[] = ORG_RELATIONSHIP_VALUES

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map(str).filter(Boolean) : []
}

function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return null
  const d = new Date(`${v}T00:00:00Z`)
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v
}

/**
 * Validate the model's raw JSON. Links survive only if their id is one the
 * server actually handed the model (search results or the records list),
 * keyed `${entity_type}:${id}`. Labels and contact kinds always come from
 * that map, never from the model.
 */
export function parseProposal(
  raw: unknown,
  opts: { knownEntities: Map<string, KnownEntity>; fileCount: number }
): NoteIntakeProposal {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawNotes = Array.isArray(obj.notes) ? obj.notes : []
  const warnings = strList(obj.warnings)

  const notes: ProposedNote[] = rawNotes.flatMap((n): ProposedNote[] => {
    if (!n || typeof n !== 'object') return []
    const note = n as Record<string, unknown>

    const seen = new Set<string>()
    const links: ProposedLink[] = (Array.isArray(note.links) ? note.links : []).flatMap((l): ProposedLink[] => {
      const link = (l ?? {}) as Record<string, unknown>
      const key = `${str(link.entity_type)}:${str(link.entity_id)}`
      const known = opts.knownEntities.get(key)
      if (!known || seen.has(key)) return []
      seen.add(key)
      return [{
        entity_type: str(link.entity_type) as LinkEntityType,
        entity_id: str(link.entity_id),
        label: known.label,
        ...(known.kind ? { contact_kind: known.kind } : {}),
        confidence: CONFIDENCE.includes(link.confidence as Confidence) ? (link.confidence as Confidence) : 'low',
        evidence: str(link.evidence),
      }]
    })

    const newContacts: ProposedNewContact[] = (Array.isArray(note.new_contacts) ? note.new_contacts : []).flatMap(
      (c): ProposedNewContact[] => {
        const contact = (c ?? {}) as Record<string, unknown>
        const name = str(contact.name)
        if (!name) return []
        const isPerson = contact.kind !== 'organization'
        const organization = isPerson ? str(contact.organization) || null : null
        const role = str(contact.role_at_organization)
        return [{
          kind: isPerson ? 'person' : 'organization',
          name,
          email: isPerson ? str(contact.email) || null : null,
          organization,
          // A role we don't track at a named organization becomes 'other'
          role_at_organization: !isPerson || !role
            ? null
            : RELATIONSHIPS.includes(role as OrgRelationship)
              ? (role as OrgRelationship)
              : organization ? 'other' : null,
          title: isPerson ? str(contact.title) || null : null,
          suggested_role: ROLES.includes(contact.suggested_role as ContactRole)
            ? (contact.suggested_role as ContactRole)
            : null,
          evidence: str(contact.evidence),
        }]
      }
    )

    const fileIndexes = [...new Set(
      (Array.isArray(note.file_indexes) ? note.file_indexes : []).filter(
        (i): i is number => Number.isInteger(i) && (i as number) >= 0 && (i as number) < opts.fileCount
      )
    )]

    const summary = str(note.summary)
    const transcript = str(note.transcript)
    if (!summary && !transcript) return []

    return [{
      title: str(note.title) || 'Untitled note',
      meeting_date: validDate(note.meeting_date),
      summary,
      key_points: strList(note.key_points),
      follow_ups: strList(note.follow_ups),
      transcript,
      // A note with no stated source gets every file (never drop the originals)
      file_indexes: fileIndexes.length ? fileIndexes : Array.from({ length: opts.fileCount }, (_, i) => i),
      links,
      new_contacts: newContacts,
    }]
  })

  if (rawNotes.length > 0 && notes.length === 0) {
    warnings.push('Claude returned notes with no readable content.')
  }
  return { notes, warnings }
}

/** Merge several proposed notes into one (review-screen "merge"). */
export function mergeNotes(notes: ProposedNote[]): ProposedNote {
  const [first, ...rest] = notes
  if (!first) throw new Error('Nothing to merge')
  const seenLinks = new Set<string>()
  const seenContacts = new Set<string>()
  return {
    title: first.title,
    meeting_date: first.meeting_date ?? rest.find((n) => n.meeting_date)?.meeting_date ?? null,
    summary: notes.map((n) => n.summary).filter(Boolean).join('\n\n'),
    key_points: notes.flatMap((n) => n.key_points),
    follow_ups: notes.flatMap((n) => n.follow_ups),
    transcript: notes.map((n) => n.transcript).filter(Boolean).join('\n\n———\n\n'),
    file_indexes: [...new Set(notes.flatMap((n) => n.file_indexes))].sort((a, b) => a - b),
    links: notes.flatMap((n) => n.links).filter((l) => {
      const key = `${l.entity_type}:${l.entity_id}`
      if (seenLinks.has(key)) return false
      seenLinks.add(key)
      return true
    }),
    new_contacts: notes.flatMap((n) => n.new_contacts).filter((c) => {
      const key = `${c.kind}:${c.name.toLowerCase()}`
      if (seenContacts.has(key)) return false
      seenContacts.add(key)
      return true
    }),
  }
}
