'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createPersonAtOrganization, setAffiliationEnded } from '@/lib/actions/contacts'
import {
  contactRoles,
  ENTITY_TYPE_LABELS,
  LEADERSHIP_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  ROLE_BADGE_CLASSES,
  ROLE_FLAGS,
} from '@/lib/contacts/crm'
import { TAX_STATUS_LABELS } from '@/lib/utils/tax-status'
import { formatDate } from '@/lib/utils/dates'
import type { AffiliationRelationship, Contact } from '@/lib/supabase/types/database'
import Avatar from '@/components/crm/Avatar'
import AddPersonModal from '@/components/crm/AddPersonModal'
import EditAffiliationModal from '@/components/crm/EditAffiliationModal'
import { ensureProtocol, locationOf, type OrgMember } from '@/components/crm/types'
import OrganizationEditForm from './OrganizationEditForm'

const badge = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium'
const sectionTitle = 'text-lg font-semibold text-gray-900'

function BackLink() {
  return (
    <Link href="/organizations" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-6">
      <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      Back to Organizations
    </Link>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900 break-words">{children}</dd>
    </div>
  )
}

const EMPTY_LEADER = { first_name: '', last_name: '', email: '', title: '', relationship: 'executive' as AffiliationRelationship }

export default function OrganizationView({
  organization: org,
  imageUrl,
  members,
  startEditing,
  actions,
  funding,
  documents,
  notes,
}: {
  organization: Contact
  imageUrl: string | null
  members: OrgMember[]
  startEditing: boolean
  actions: ReactNode
  funding: ReactNode
  documents: ReactNode
  notes: ReactNode
}) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(startEditing)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)
  const [showAddLeader, setShowAddLeader] = useState(false)
  const [newLeader, setNewLeader] = useState(EMPTY_LEADER)
  const [addingLeader, setAddingLeader] = useState(false)
  const [showAddPerson, setShowAddPerson] = useState(false)
  const [editing, setEditing] = useState<OrgMember | null>(null)

  const isLeadership = (m: OrgMember) => LEADERSHIP_RELATIONSHIPS.includes(m.relationship)
  const leaders = members.filter((m) => isLeadership(m) && !m.end_date)
  const formerLeaders = members.filter((m) => isLeadership(m) && m.end_date)
  const team = members.filter((m) => !isLeadership(m) && !m.end_date)
  const formerTeam = members.filter((m) => !isLeadership(m) && m.end_date)
  const roles = contactRoles(org)
  const location = locationOf(org)
  const address = [org.address_line1, org.address_line2, [org.city, org.state, org.postal_code].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')

  async function addLeader(e: React.FormEvent) {
    e.preventDefault()
    setAddingLeader(true)
    setMessage(null)
    const res = await createPersonAtOrganization({ organizationId: org.id, ...newLeader })
    setAddingLeader(false)
    if (!res.ok) {
      setMessage({ kind: 'error', text: res.error })
      return
    }
    setNewLeader(EMPTY_LEADER)
    setShowAddLeader(false)
    setMessage({ kind: 'success', text: 'Added to leadership' })
    router.refresh()
  }

  async function markFormer(m: OrgMember) {
    if (!confirm(`Mark ${m.person.display_name} as former ${RELATIONSHIP_LABELS[m.relationship].toLowerCase()}?`)) return
    setMessage(null)
    const res = await setAffiliationEnded(m.id, true)
    if (!res.ok) setMessage({ kind: 'error', text: res.error })
    else router.refresh()
  }

  const roleLine = (m: OrgMember) => m.title || m.person.title || RELATIONSHIP_LABELS[m.relationship]

  return (
    <div className="max-w-5xl mx-auto">
      <BackLink />

      {/* Header */}
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-6 min-w-0">
          <Avatar name={org.display_name} src={imageUrl} shape="square" size="xl" />
          <div className="min-w-0">
            <h1 className="text-3xl font-bold text-gray-900 break-words">{org.display_name}</h1>
            {org.previous_names.length > 0 && (
              <p className="text-sm text-gray-500 mt-1">Formerly: {org.previous_names.join(', ')}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {org.entity_type && <span className={`${badge} bg-gray-100 text-gray-800`}>{ENTITY_TYPE_LABELS[org.entity_type]}</span>}
              {roles.map((flag) => (
                <span key={flag} className={`${badge} ${ROLE_BADGE_CLASSES[flag]}`}>
                  {ROLE_FLAGS.find((r) => r.flag === flag)?.label}
                </span>
              ))}
              {!org.is_active && <span className={`${badge} bg-red-50 text-red-700`}>Archived</span>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {actions}
          {!isEditing && (
            <button type="button" onClick={() => setIsEditing(true)} className="btn btn-primary whitespace-nowrap">
              Edit organization
            </button>
          )}
        </div>
      </div>

      {message && (
        <div className={`mb-6 rounded-md p-4 ${message.kind === 'error' ? 'bg-red-50' : 'bg-green-50'}`} role="status">
          <p className={`text-sm ${message.kind === 'error' ? 'text-red-800' : 'text-green-800'}`}>{message.text}</p>
        </div>
      )}

      {isEditing ? (
        <OrganizationEditForm
          organization={org}
          imageUrl={imageUrl}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false)
            setMessage({ kind: 'success', text: 'Organization updated' })
            router.refresh()
          }}
        />
      ) : (
        <div className="space-y-6">
          {/* About */}
          <div className="card p-6">
            <h2 className={`${sectionTitle} mb-4`}>About</h2>
            {org.description ? (
              <p className="text-gray-700 mb-6 whitespace-pre-wrap">{org.description}</p>
            ) : (
              <p className="text-gray-500 italic mb-6">No description yet</p>
            )}
            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {org.website && (
                <Detail label="Website">
                  <a href={ensureProtocol(org.website)} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">
                    {org.website}
                  </a>
                </Detail>
              )}
              {location && <Detail label="Location">{location}</Detail>}
              {org.email && (
                <Detail label="Email">
                  <a href={`mailto:${org.email}`} className="underline hover:text-gray-700">
                    {org.email}
                  </a>
                </Detail>
              )}
              {org.phone && <Detail label="Phone">{org.phone}</Detail>}
              {address && <Detail label="Mailing address">{address}</Detail>}
              {org.legal_name && <Detail label="Legal name">{org.legal_name}</Detail>}
              {org.tax_id && <Detail label="Tax ID / EIN">{org.tax_id}</Detail>}
              {org.tax_status && <Detail label="Tax status">{TAX_STATUS_LABELS[org.tax_status]}</Detail>}
              {(org.is_vendor || org.is_grantee || org.w9_on_file) && (
                <Detail label="W-9">{org.w9_on_file ? 'On file' : 'Not on file'}</Detail>
              )}
            </dl>
          </div>

          {org.tags.length > 0 && (
            <div className="card p-6">
              <h2 className={`${sectionTitle} mb-4`}>Tags</h2>
              <div className="flex flex-wrap gap-2">
                {org.tags.map((tag) => (
                  <span key={tag} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Leadership */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className={sectionTitle}>Leadership</h2>
              {!showAddLeader && (
                <button type="button" onClick={() => setShowAddLeader(true)} className="text-sm text-gray-600 hover:text-gray-900 underline">
                  + Add leader
                </button>
              )}
            </div>

            {showAddLeader && (
              <form onSubmit={addLeader} className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                <h3 className="text-sm font-semibold text-gray-900">Add a new leader</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input
                    placeholder="First name *"
                    aria-label="First name"
                    required
                    value={newLeader.first_name}
                    onChange={(e) => setNewLeader({ ...newLeader, first_name: e.target.value })}
                    className="input"
                  />
                  <input
                    placeholder="Last name"
                    aria-label="Last name"
                    value={newLeader.last_name}
                    onChange={(e) => setNewLeader({ ...newLeader, last_name: e.target.value })}
                    className="input"
                  />
                  <input
                    type="email"
                    placeholder="Email (optional)"
                    aria-label="Email"
                    value={newLeader.email}
                    onChange={(e) => setNewLeader({ ...newLeader, email: e.target.value })}
                    className="input"
                  />
                  <input
                    placeholder="Title (e.g. Executive Director)"
                    aria-label="Title"
                    value={newLeader.title}
                    onChange={(e) => setNewLeader({ ...newLeader, title: e.target.value })}
                    className="input"
                  />
                  <select
                    aria-label="Relationship"
                    value={newLeader.relationship}
                    onChange={(e) => setNewLeader({ ...newLeader, relationship: e.target.value as AffiliationRelationship })}
                    className="input"
                  >
                    {LEADERSHIP_RELATIONSHIPS.map((r) => (
                      <option key={r} value={r}>
                        {RELATIONSHIP_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="text-xs text-gray-500">
                  Already in your contacts? Use <strong>+ Add person</strong> under Team and pick a leadership relationship.
                </p>
                <div className="flex gap-2">
                  <button type="submit" disabled={addingLeader} className="btn btn-primary text-sm">
                    {addingLeader ? 'Adding…' : 'Add leader'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddLeader(false)
                      setNewLeader(EMPTY_LEADER)
                    }}
                    className="btn btn-secondary text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}

            {leaders.length === 0 ? (
              !showAddLeader && <p className="text-sm text-gray-500 italic">No founders or executives recorded yet.</p>
            ) : (
              <div className="space-y-5">
                {leaders.map((m) => (
                  <div key={m.id} className="flex items-start gap-4">
                    <Link href={`/people/${m.person.id}`} className="hover:opacity-80 transition-opacity">
                      <Avatar name={m.person.display_name} src={m.person.imageUrl} size="lg" />
                    </Link>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link href={`/people/${m.person.id}`} className="text-sm font-semibold text-gray-900 hover:underline">
                            {m.person.display_name}
                          </Link>
                          <p className="text-sm text-gray-600">
                            {roleLine(m)}
                            {m.is_primary_contact && (
                              <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Primary contact</span>
                            )}
                          </p>
                        </div>
                        <div className="flex gap-3 flex-shrink-0">
                          <button type="button" onClick={() => setEditing(m)} className="text-xs text-gray-500 hover:text-gray-700">
                            Edit
                          </button>
                          <button type="button" onClick={() => markFormer(m)} className="text-xs text-red-600 hover:text-red-800">
                            Remove
                          </button>
                        </div>
                      </div>
                      {m.person.description && <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{m.person.description}</p>}
                      {locationOf(m.person) && <p className="mt-1 text-xs text-gray-500">{locationOf(m.person)}</p>}
                      {(m.person.linkedin_url || m.person.twitter_url) && (
                        <div className="mt-2 flex gap-3">
                          {m.person.linkedin_url && (
                            <a href={ensureProtocol(m.person.linkedin_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 hover:text-gray-900 underline">
                              LinkedIn
                            </a>
                          )}
                          {m.person.twitter_url && (
                            <a href={ensureProtocol(m.person.twitter_url)} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-600 hover:text-gray-900 underline">
                              Twitter / X
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {formerLeaders.length > 0 && (
            <div className="card p-6">
              <h2 className={`${sectionTitle} mb-4`}>Former leadership</h2>
              <MemberList members={formerLeaders} former onEdit={setEditing} roleLine={roleLine} />
            </div>
          )}

          {/* Team */}
          <div className="card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className={sectionTitle}>Team</h2>
              <button type="button" onClick={() => setShowAddPerson(true)} className="text-sm text-gray-600 hover:text-gray-900 underline">
                + Add person
              </button>
            </div>
            {team.length > 0 ? (
              <MemberList members={team} onEdit={setEditing} roleLine={roleLine} />
            ) : (
              <p className="text-sm text-gray-500 italic">No team members yet. Click &ldquo;Add person&rdquo; to add someone.</p>
            )}
            {formerTeam.length > 0 && (
              <div className="mt-6 pt-4 border-t border-gray-100">
                <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Former</h3>
                <MemberList members={formerTeam} former onEdit={setEditing} roleLine={roleLine} />
              </div>
            )}
          </div>

          {funding}
          {documents}
          {notes}
        </div>
      )}

      {showAddPerson && (
        <AddPersonModal
          organizationId={org.id}
          organizationName={org.display_name}
          existingPersonIds={members.filter((m) => !m.end_date).map((m) => m.person.id)}
          onClose={() => setShowAddPerson(false)}
          onAdded={() => {
            setShowAddPerson(false)
            router.refresh()
          }}
        />
      )}

      {editing && (
        <EditAffiliationModal
          affiliation={editing}
          personName={editing.person.display_name}
          organizationName={org.display_name}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function MemberList({
  members,
  former = false,
  onEdit,
  roleLine,
}: {
  members: OrgMember[]
  former?: boolean
  onEdit: (m: OrgMember) => void
  roleLine: (m: OrgMember) => string
}) {
  return (
    <div className="space-y-3">
      {members.map((m) => (
        <div key={m.id} className={`flex items-center gap-3 ${former ? 'opacity-60' : ''}`}>
          <Link href={`/people/${m.person.id}`} className="hover:opacity-80 transition-opacity">
            <Avatar name={m.person.display_name} src={m.person.imageUrl} size="md" />
          </Link>
          <div className="flex-1 min-w-0">
            <Link href={`/people/${m.person.id}`} className="text-sm font-medium text-gray-900 hover:underline">
              {m.person.display_name}
            </Link>
            <p className="text-xs text-gray-500">
              {roleLine(m)}
              {m.title && m.title !== RELATIONSHIP_LABELS[m.relationship] && ` · ${RELATIONSHIP_LABELS[m.relationship]}`}
              {m.is_primary_contact && !former && ' · Primary contact'}
              {former && m.end_date && ` · Left ${formatDate(m.end_date)}`}
            </p>
          </div>
          <button type="button" onClick={() => onEdit(m)} className="text-xs text-gray-500 hover:text-gray-700">
            Edit
          </button>
        </div>
      ))}
    </div>
  )
}
