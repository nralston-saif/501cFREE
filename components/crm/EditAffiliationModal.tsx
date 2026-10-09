'use client'

import { useState } from 'react'
import { removeAffiliation, updateAffiliation } from '@/lib/actions/contacts'
import { RELATIONSHIP_LABELS, RELATIONSHIP_OPTIONS } from '@/lib/contacts/crm'
import type { AffiliationRelationship } from '@/lib/supabase/types/database'
import Modal from './Modal'

export type AffiliationDraft = {
  id: string
  relationship: AffiliationRelationship
  title: string | null
  is_primary_contact: boolean
  start_date: string | null
  end_date: string | null
}

const fieldLabel = 'block text-sm font-medium text-gray-700 mb-1'

/**
 * Edit how a person relates to an organization. "Mark as former" sets an end
 * date (keeps the history); "Delete link" removes it entirely.
 */
export default function EditAffiliationModal({
  affiliation,
  personName,
  organizationName,
  onClose,
  onSaved,
}: {
  affiliation: AffiliationDraft
  personName: string
  organizationName: string
  onClose: () => void
  onSaved: () => void
}) {
  const [relationship, setRelationship] = useState(affiliation.relationship)
  const [title, setTitle] = useState(affiliation.title ?? '')
  const [primary, setPrimary] = useState(affiliation.is_primary_contact)
  const [startDate, setStartDate] = useState(affiliation.start_date ?? '')
  const [endDate, setEndDate] = useState(affiliation.end_date ?? '')
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(write: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true)
    setError(null)
    const res = await write()
    setBusy(false)
    if (!res.ok) setError(res.error)
    else onSaved()
  }

  // "Mark as former" ends the link today on the organization's calendar
  // (the server picks the date)
  const save = (overrides: { endDate?: null; endedToday?: boolean } = {}) =>
    run(() =>
      updateAffiliation(affiliation.id, {
        relationship,
        title,
        isPrimaryContact: primary,
        startDate: startDate || null,
        ...(overrides.endedToday
          ? { endedToday: true }
          : { endDate: overrides.endDate !== undefined ? overrides.endDate : endDate || null }),
      })
    )

  return (
    <Modal
      title="Edit relationship"
      subtitle={`${personName} at ${organizationName}`}
      onClose={onClose}
      busy={busy}
      size="sm"
      footer={
        confirmRemove ? (
          <>
            <span className="mr-auto text-sm text-gray-700">Delete this link entirely?</span>
            <button type="button" onClick={() => setConfirmRemove(false)} disabled={busy} className="btn btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={() => run(() => removeAffiliation(affiliation.id))} disabled={busy} className="btn btn-danger">
              {busy ? 'Deleting…' : 'Delete link'}
            </button>
          </>
        ) : (
          <>
            <div className="mr-auto flex flex-col items-start gap-1">
              {affiliation.end_date ? (
                <button type="button" onClick={() => save({ endDate: null })} disabled={busy} className="text-sm text-blue-600 hover:text-blue-800">
                  Reinstate as current
                </button>
              ) : (
                <button type="button" onClick={() => save({ endedToday: true })} disabled={busy} className="text-sm text-amber-700 hover:text-amber-900">
                  Mark as former
                </button>
              )}
              <button type="button" onClick={() => setConfirmRemove(true)} disabled={busy} className="text-sm text-red-600 hover:text-red-800">
                Delete link
              </button>
            </div>
            <button type="button" onClick={onClose} disabled={busy} className="btn btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={() => save()} disabled={busy} className="btn btn-primary">
              {busy ? 'Saving…' : 'Save'}
            </button>
          </>
        )
      }
    >
      {error && <p className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">{error}</p>}
      <div className="space-y-4">
        <label className="block">
          <span className={fieldLabel}>Relationship</span>
          <select
            value={relationship}
            onChange={(e) => setRelationship(e.target.value as AffiliationRelationship)}
            disabled={busy}
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
            disabled={busy}
            placeholder="e.g. Executive Director"
            className="input"
          />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className={fieldLabel}>Started</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={busy} className="input" />
          </label>
          <label className="block">
            <span className={fieldLabel}>Ended</span>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={busy} className="input" />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={primary}
            onChange={(e) => setPrimary(e.target.checked)}
            disabled={busy}
            className="rounded border-gray-300"
          />
          Primary contact for {organizationName}
        </label>
      </div>
    </Modal>
  )
}
