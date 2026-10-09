'use client'

import { useState } from 'react'
import { updatePerson } from '@/lib/actions/contacts'
import type { Contact } from '@/lib/supabase/types/database'
import Modal from '@/components/crm/Modal'
import { Field } from '@/components/crm/ProfileFields'
import IntroducerPicker from './IntroducerPicker'
import type { Introducer } from './PersonView'

/** Quick edit of the Relationship panel without opening the full form. */
export default function RelationshipModal({
  person,
  introducer,
  onClose,
  onSaved,
}: {
  person: Contact
  introducer: Introducer | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    first_met_date: person.first_met_date ?? '',
    how_we_met: person.how_we_met ?? '',
    relationship_notes: person.relationship_notes ?? '',
  })
  const [intro, setIntro] = useState<Introducer | null>(introducer)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const res = await updatePerson(person.id, { ...form, introduced_by: intro?.id ?? null })
    setBusy(false)
    if (!res.ok) setError(res.error)
    else onSaved()
  }

  return (
    <Modal
      title="Relationship"
      subtitle={person.display_name}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={busy} className="btn btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} className="btn btn-primary">
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      {error && <p className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">{error}</p>}
      <div className="space-y-4">
        <IntroducerPicker personId={person.id} value={intro} onChange={setIntro} />
        <Field label="First met">
          <input
            type="date"
            value={form.first_met_date}
            onChange={(e) => setForm({ ...form, first_met_date: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="How we met">
          <textarea
            rows={2}
            value={form.how_we_met}
            onChange={(e) => setForm({ ...form, how_we_met: e.target.value })}
            placeholder="e.g. Met at a sector convening…"
            className="input"
          />
        </Field>
        <Field label="Relationship notes">
          <textarea
            rows={3}
            value={form.relationship_notes}
            onChange={(e) => setForm({ ...form, relationship_notes: e.target.value })}
            placeholder="Ongoing notes about the relationship…"
            className="input"
          />
        </Field>
      </div>
    </Modal>
  )
}
