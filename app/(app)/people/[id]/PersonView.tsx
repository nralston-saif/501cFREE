'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { contactRoles, RELATIONSHIP_LABELS, ROLE_BADGE_CLASSES, ROLE_FLAGS } from '@/lib/contacts/crm'
import { formatDate, formatDateLong } from '@/lib/utils/dates'
import type { Contact, ContactKind } from '@/lib/supabase/types/database'
import Avatar from '@/components/crm/Avatar'
import { ensureProtocol, locationOf, type PersonOrg } from '@/components/crm/types'
import PersonEditForm from './PersonEditForm'
import RelationshipModal from './RelationshipModal'

const badge = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium'
const sectionTitle = 'text-lg font-semibold text-gray-900'
const pill =
  'inline-flex items-center px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition'

export type Introducer = { id: string; name: string; kind: ContactKind }

function MailIcon() {
  return (
    <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  )
}

/** Email pill with a copy-to-clipboard button. */
function EmailPill({ email }: { email: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="inline-flex items-center border border-gray-300 rounded-lg overflow-hidden">
      <a href={`mailto:${email}`} className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
        <MailIcon />
        {email}
      </a>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(email)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          } catch {
            // clipboard unavailable; nothing to do
          }
        }}
        className="px-3 py-2 border-l border-gray-300 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition"
        title="Copy email"
        aria-label={`Copy ${email}`}
      >
        {copied ? (
          <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
        )}
      </button>
    </div>
  )
}

function OrgCard({ o, former = false }: { o: PersonOrg; former?: boolean }) {
  return (
    <Link
      href={`/organizations/${o.organization.id}`}
      className={`flex items-center gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition ${former ? 'opacity-70' : ''}`}
    >
      <Avatar name={o.organization.display_name} src={o.organization.imageUrl} shape="square" size="lg" />
      <div className="min-w-0">
        <p className="font-semibold text-gray-900">{o.organization.display_name}</p>
        <p className="text-sm text-gray-600">
          {o.title || RELATIONSHIP_LABELS[o.relationship]}
          {o.title && <span className="text-gray-400"> · {RELATIONSHIP_LABELS[o.relationship]}</span>}
          {former && o.end_date && <span className="text-gray-400"> · Left {formatDate(o.end_date)}</span>}
          {o.is_primary_contact && !former && (
            <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">Primary contact</span>
          )}
        </p>
      </div>
    </Link>
  )
}

export default function PersonView({
  person,
  imageUrl,
  organizations,
  introducer,
  startEditing,
  actions,
  funding,
  documents,
  notes,
}: {
  person: Contact
  imageUrl: string | null
  organizations: PersonOrg[]
  introducer: Introducer | null
  startEditing: boolean
  actions: ReactNode
  funding: ReactNode
  documents: ReactNode
  notes: ReactNode
}) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(startEditing)
  const [editingRelationship, setEditingRelationship] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)

  const roles = contactRoles(person)
  const location = locationOf(person)
  const current = organizations.filter((o) => !o.end_date)
  const past = organizations.filter((o) => o.end_date)
  const hasRelationship = !!(person.first_met_date || introducer || person.how_we_met || person.relationship_notes)
  const address = [
    person.address_line1,
    person.address_line2,
    [person.city, person.state, person.postal_code].filter(Boolean).join(' '),
    person.country,
  ]
    .filter(Boolean)
    .join(', ')
  const introducerHref = introducer
    ? introducer.kind === 'person'
      ? `/people/${introducer.id}`
      : `/organizations/${introducer.id}`
    : null

  return (
    <div className="max-w-5xl mx-auto">
      <Link href="/people" className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-6">
        <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to People
      </Link>

      {success && (
        <div className="mb-6 rounded-md bg-green-50 p-4" role="status">
          <p className="text-sm text-green-800">{success}</p>
        </div>
      )}

      {isEditing ? (
        <PersonEditForm
          person={person}
          imageUrl={imageUrl}
          organizations={organizations}
          introducer={introducer}
          onCancel={() => setIsEditing(false)}
          onSaved={() => {
            setIsEditing(false)
            setSuccess('Profile updated')
            router.refresh()
          }}
        />
      ) : (
        <>
          {/* Profile header */}
          <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
            <div className="flex items-start gap-6 min-w-0">
              <Avatar name={person.display_name} src={imageUrl} size="xl" />
              <div className="min-w-0">
                <h1 className="text-3xl font-bold text-gray-900 break-words">{person.display_name}</h1>
                {person.title && <p className="mt-1 text-lg text-gray-600">{person.title}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {current.slice(0, 2).map((o) => (
                    <span key={o.id} className={`${badge} bg-gray-100 text-gray-800`}>
                      {RELATIONSHIP_LABELS[o.relationship]}, {o.organization.display_name}
                    </span>
                  ))}
                  {roles.map((flag) => (
                    <span key={flag} className={`${badge} ${ROLE_BADGE_CLASSES[flag]}`}>
                      {ROLE_FLAGS.find((r) => r.flag === flag)?.label}
                    </span>
                  ))}
                  {!person.is_active && <span className={`${badge} bg-red-50 text-red-700`}>Archived</span>}
                  {location && <span className="text-sm text-gray-500">{location}</span>}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {actions}
              <button type="button" onClick={() => setIsEditing(true)} className="btn btn-primary whitespace-nowrap">
                Edit profile
              </button>
            </div>
          </div>

          <div className="space-y-6">
            {person.description && (
              <div className="card p-6">
                <h2 className={`${sectionTitle} mb-2`}>About</h2>
                <p className="text-gray-700 whitespace-pre-wrap">{person.description}</p>
              </div>
            )}

            {person.tags.length > 0 && (
              <div className="card p-6">
                <h2 className={`${sectionTitle} mb-2`}>Tags</h2>
                <div className="flex flex-wrap gap-2">
                  {person.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Relationship */}
            <div className="p-6 bg-blue-50 rounded-xl border border-blue-100">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-blue-900 flex items-center gap-2">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                  Relationship
                </h2>
                <button type="button" onClick={() => setEditingRelationship(true)} className="text-sm text-blue-700 hover:text-blue-900 underline">
                  Edit
                </button>
              </div>
              {hasRelationship ? (
                <div className="space-y-3">
                  {(person.first_met_date || introducer) && (
                    <div className="flex flex-wrap gap-4 text-sm">
                      {person.first_met_date && (
                        <div>
                          <span className="text-gray-500">First met:</span>{' '}
                          <span className="font-medium text-gray-900">{formatDateLong(person.first_met_date)}</span>
                        </div>
                      )}
                      {introducer && introducerHref && (
                        <div>
                          <span className="text-gray-500">Introduced by:</span>{' '}
                          <Link href={introducerHref} className="font-medium text-blue-600 hover:text-blue-800">
                            {introducer.name}
                          </Link>
                        </div>
                      )}
                    </div>
                  )}
                  {person.how_we_met && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">How we met:</p>
                      <p className="text-gray-700 whitespace-pre-wrap">{person.how_we_met}</p>
                    </div>
                  )}
                  {person.relationship_notes && (
                    <div>
                      <p className="text-sm text-gray-500 mb-1">Relationship notes:</p>
                      <p className="text-gray-700 whitespace-pre-wrap">{person.relationship_notes}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-blue-900/60 italic">How you met, who introduced you, and anything to remember.</p>
              )}
            </div>

            {/* Organizations */}
            <div className="card p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className={sectionTitle}>Organizations</h2>
                <button type="button" onClick={() => setIsEditing(true)} className="text-sm text-gray-600 hover:text-gray-900 underline">
                  Manage
                </button>
              </div>
              {current.length === 0 ? (
                <p className="text-sm text-gray-500 italic">Not linked to any organization.</p>
              ) : (
                <div className="space-y-3">
                  {current.map((o) => (
                    <OrgCard key={o.id} o={o} />
                  ))}
                </div>
              )}
              {past.length > 0 && (
                <div className="mt-6 pt-4 border-t border-gray-100">
                  <h3 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Past</h3>
                  <div className="space-y-3">
                    {past.map((o) => (
                      <OrgCard key={o.id} o={o} former />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Contact */}
            <div className="card p-6">
              <h2 className={`${sectionTitle} mb-4`}>Contact</h2>
              {!person.email && !person.alternative_emails.length && !person.phone && !person.linkedin_url && !person.twitter_url && !address ? (
                <p className="text-sm text-gray-500 italic">No contact details yet.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-3">
                    {person.email && <EmailPill email={person.email} />}
                    {person.alternative_emails.map((e) => (
                      <EmailPill key={e} email={e} />
                    ))}
                    {person.phone && (
                      <a href={`tel:${person.phone}`} className={pill}>
                        <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        {person.phone}
                      </a>
                    )}
                    {person.linkedin_url && (
                      <a href={ensureProtocol(person.linkedin_url)} target="_blank" rel="noopener noreferrer" className={pill}>
                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
                        </svg>
                        LinkedIn
                      </a>
                    )}
                    {person.twitter_url && (
                      <a href={ensureProtocol(person.twitter_url)} target="_blank" rel="noopener noreferrer" className={pill}>
                        <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                        </svg>
                        Twitter / X
                      </a>
                    )}
                  </div>
                  {address && (
                    <p className="mt-4 text-sm text-gray-600">
                      <span className="text-gray-500">Mailing address:</span> {address}
                    </p>
                  )}
                </>
              )}
            </div>

            {funding}
            {documents}
            {notes}
          </div>
        </>
      )}

      {editingRelationship && (
        <RelationshipModal
          person={person}
          introducer={introducer}
          onClose={() => setEditingRelationship(false)}
          onSaved={() => {
            setEditingRelationship(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}
