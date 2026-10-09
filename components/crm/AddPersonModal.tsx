'use client'

import { useState } from 'react'
import { addAffiliation, createPersonAtOrganization, type ContactSearchHit } from '@/lib/actions/contacts'
import { RELATIONSHIP_LABELS, RELATIONSHIP_OPTIONS } from '@/lib/contacts/crm'
import type { AffiliationRelationship } from '@/lib/supabase/types/database'
import Modal from './Modal'
import ContactSearch from './ContactSearch'

const fieldLabel = 'block text-sm font-medium text-gray-700 mb-1'

/** Link an existing person to an organization, or create one and link them. */
export default function AddPersonModal({
  organizationId,
  organizationName,
  existingPersonIds,
  defaultRelationship = 'employee',
  onClose,
  onAdded,
}: {
  organizationId: string
  organizationName: string
  existingPersonIds: string[]
  defaultRelationship?: AffiliationRelationship
  onClose: () => void
  onAdded: () => void
}) {
  const [tab, setTab] = useState<'search' | 'create'>('search')
  const [relationship, setRelationship] = useState<AffiliationRelationship>(defaultRelationship)
  const [title, setTitle] = useState('')
  const [primary, setPrimary] = useState(false)
  const [picked, setPicked] = useState<ContactSearchHit | null>(null)
  const [person, setPerson] = useState({ first_name: '', last_name: '', email: '', phone: '', linkedin_url: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const res =
      tab === 'search'
        ? picked
          ? await addAffiliation({
              contactId: organizationId,
              otherId: picked.id,
              relationship,
              title,
              isPrimaryContact: primary,
            })
          : { ok: false as const, error: 'Pick a person first' }
        : await createPersonAtOrganization({
            organizationId,
            ...person,
            title,
            relationship,
            isPrimaryContact: primary,
          })
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    onAdded()
  }

  const canSubmit = tab === 'search' ? !!picked : !!person.first_name.trim()

  return (
    <Modal
      title={`Add person to ${organizationName}`}
      subtitle="Link an existing person or create a new one"
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={busy || !canSubmit} className="btn btn-primary">
            {busy ? 'Adding…' : tab === 'search' ? 'Add person' : 'Create & add'}
          </button>
        </>
      }
    >
      {error && <p className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">{error}</p>}

      <div className="flex border-b border-gray-200 mb-4" role="tablist">
        {(['search', 'create'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'search' ? 'Search existing' : 'Create new'}
          </button>
        ))}
      </div>

      {/* Relationship and title apply to either tab */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4 pb-4 border-b border-gray-200">
        <label className="block">
          <span className={fieldLabel}>Relationship *</span>
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as AffiliationRelationship)}
            className="input"
          >
            {RELATIONSHIP_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>Title at organization</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Executive Director"
            className="input"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 sm:col-span-2">
          <input
            type="checkbox"
            checked={primary}
            onChange={(e) => setPrimary(e.target.checked)}
            className="rounded border-gray-300"
          />
          Primary contact for {organizationName}
        </label>
      </div>

      {tab === 'search' ? (
        picked ? (
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-medium text-gray-700">Selected person</span>
              <button type="button" onClick={() => setPicked(null)} className="text-sm text-gray-500 hover:text-gray-700">
                Change
              </button>
            </div>
            <p className="font-semibold text-gray-900">{picked.display_name}</p>
            {picked.email && <p className="text-sm text-gray-500">{picked.email}</p>}
            {picked.title && <p className="text-sm text-gray-600">{picked.title}</p>}
          </div>
        ) : (
          <div>
            <span className={fieldLabel}>Search by name or email</span>
            <ContactSearch
              kind="person"
              label="Search people by name or email"
              excludeIds={existingPersonIds}
              onPick={setPicked}
              autoFocus
              onNoResults={() => (
                <button
                  type="button"
                  onClick={() => setTab('create')}
                  className="mt-2 text-sm text-gray-900 hover:underline font-medium"
                >
                  Create a new person instead
                </button>
              )}
            />
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={fieldLabel}>First name *</span>
            <input
              value={person.first_name}
              onChange={(e) => setPerson({ ...person, first_name: e.target.value })}
              className="input"
              autoFocus
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Last name</span>
            <input
              value={person.last_name}
              onChange={(e) => setPerson({ ...person, last_name: e.target.value })}
              className="input"
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Email</span>
            <input
              type="email"
              value={person.email}
              onChange={(e) => setPerson({ ...person, email: e.target.value })}
              placeholder="name@example.org"
              className="input"
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Phone</span>
            <input
              type="tel"
              value={person.phone}
              onChange={(e) => setPerson({ ...person, phone: e.target.value })}
              className="input"
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={fieldLabel}>LinkedIn</span>
            <input
              value={person.linkedin_url}
              onChange={(e) => setPerson({ ...person, linkedin_url: e.target.value })}
              placeholder="https://linkedin.com/in/…"
              className="input"
            />
          </label>
        </div>
      )}
    </Modal>
  )
}
