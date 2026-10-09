'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  addAffiliation,
  removeAffiliation,
  setAffiliationEnded,
  updatePerson,
  type ContactSearchHit,
} from '@/lib/actions/contacts'
import { RELATIONSHIP_LABELS, RELATIONSHIP_OPTIONS, ROLE_FLAGS, type ContactRoleFlag } from '@/lib/contacts/crm'
import { TAX_STATUS_OPTIONS } from '@/lib/utils/tax-status'
import { formatDate } from '@/lib/utils/dates'
import type { AffiliationRelationship, Contact, ContactTaxStatus } from '@/lib/supabase/types/database'
import TicketTagSelector from '@/components/TicketTagSelector'
import Avatar from '@/components/crm/Avatar'
import ContactSearch from '@/components/crm/ContactSearch'
import EditAffiliationModal from '@/components/crm/EditAffiliationModal'
import { DeleteContactSection, Field, FormCard, ImageEditor, RoleCheckboxes } from '@/components/crm/ProfileFields'
import type { PersonOrg } from '@/components/crm/types'
import IntroducerPicker from './IntroducerPicker'
import type { Introducer } from './PersonView'

function initialForm(p: Contact) {
  return {
    first_name: p.first_name ?? '',
    last_name: p.last_name ?? '',
    title: p.title ?? '',
    description: p.description ?? '',
    email: p.email ?? '',
    alternative_emails: p.alternative_emails.join(', '),
    phone: p.phone ?? '',
    linkedin_url: p.linkedin_url ?? '',
    twitter_url: p.twitter_url ?? '',
    address_line1: p.address_line1 ?? '',
    address_line2: p.address_line2 ?? '',
    city: p.city ?? '',
    state: p.state ?? '',
    postal_code: p.postal_code ?? '',
    country: p.country ?? '',
    legal_name: p.legal_name ?? '',
    tax_id: p.tax_id ?? '',
    tax_status: (p.tax_status ?? '') as ContactTaxStatus | '',
    w9_on_file: p.w9_on_file,
    first_met_date: p.first_met_date ?? '',
    how_we_met: p.how_we_met ?? '',
    relationship_notes: p.relationship_notes ?? '',
    is_active: p.is_active,
    tags: p.tags,
    roles: Object.fromEntries(ROLE_FLAGS.map(({ flag }) => [flag, p[flag]])) as Record<ContactRoleFlag, boolean>,
  }
}

export default function PersonEditForm({
  person,
  imageUrl,
  organizations,
  introducer,
  onCancel,
  onSaved,
}: {
  person: Contact
  imageUrl: string | null
  organizations: PersonOrg[]
  introducer: Introducer | null
  onCancel: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(() => initialForm(person))
  const [intro, setIntro] = useState<Introducer | null>(introducer)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof typeof form>(key: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await updatePerson(person.id, { ...form, introduced_by: intro?.id ?? null })
    setSaving(false)
    if (!res.ok) {
      setError(res.error)
      window.scrollTo({ top: 0, behavior: 'smooth' })
      return
    }
    onSaved()
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 p-4" role="alert">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      {/* Profile header */}
      <div className="flex flex-col sm:flex-row items-start gap-6">
        <ImageEditor contactId={person.id} name={person.display_name} src={imageUrl} shape="round" />
        <div className="flex-1 w-full space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="First name *">
              <input required value={form.first_name} onChange={set('first_name')} className="input" />
            </Field>
            <Field label="Last name">
              <input value={form.last_name} onChange={set('last_name')} className="input" />
            </Field>
          </div>
          <Field label="Title">
            <input value={form.title} onChange={set('title')} placeholder="e.g. Program Director" className="input" />
          </Field>
        </div>
      </div>

      <FormCard title="Basic information">
        <div className="space-y-4">
          <Field label="Bio">
            <textarea rows={4} value={form.description} onChange={set('description')} placeholder="Brief background…" className="input" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="City">
              <input value={form.city} onChange={set('city')} className="input" />
            </Field>
            <Field label="State / region">
              <input value={form.state} onChange={set('state')} className="input" />
            </Field>
            <Field label="Country">
              <input value={form.country} onChange={set('country')} className="input" />
            </Field>
          </div>
          <RoleCheckboxes value={form.roles} onChange={(roles) => setForm((f) => ({ ...f, roles }))} />
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">Tags</span>
            <TicketTagSelector selectedTags={form.tags} onChange={(tags) => setForm((f) => ({ ...f, tags }))} />
          </div>
        </div>
      </FormCard>

      <FormCard title="Contact information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email">
            <input type="email" value={form.email} onChange={set('email')} className="input" />
          </Field>
          <Field label="Phone">
            <input type="tel" value={form.phone} onChange={set('phone')} className="input" />
          </Field>
          <Field label="Alternative emails" hint="Separate multiple emails with commas" className="sm:col-span-2">
            <input value={form.alternative_emails} onChange={set('alternative_emails')} placeholder="other@example.org" className="input" />
          </Field>
          <Field label="LinkedIn URL">
            <input value={form.linkedin_url} onChange={set('linkedin_url')} placeholder="https://linkedin.com/in/username" className="input" />
          </Field>
          <Field label="Twitter / X URL">
            <input value={form.twitter_url} onChange={set('twitter_url')} placeholder="https://x.com/username" className="input" />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Relationship tracking" tone="blue">
        <div className="space-y-4">
          <IntroducerPicker personId={person.id} value={intro} onChange={setIntro} />
          <Field label="First met">
            <input type="date" value={form.first_met_date} onChange={set('first_met_date')} className="input" />
          </Field>
          <Field label="How we met">
            <textarea rows={2} value={form.how_we_met} onChange={set('how_we_met')} placeholder="e.g. Met at a sector convening…" className="input" />
          </Field>
          <Field label="Relationship notes">
            <textarea rows={2} value={form.relationship_notes} onChange={set('relationship_notes')} placeholder="Ongoing notes…" className="input" />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Mailing address and tax">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Address line 1" className="sm:col-span-2">
            <input value={form.address_line1} onChange={set('address_line1')} className="input" />
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            <input value={form.address_line2} onChange={set('address_line2')} className="input" />
          </Field>
          <Field label="Postal code">
            <input value={form.postal_code} onChange={set('postal_code')} className="input" />
          </Field>
          <Field label="Legal name" hint="If different, for letters and tax forms">
            <input value={form.legal_name} onChange={set('legal_name')} className="input" />
          </Field>
          <Field label="Tax ID">
            <input value={form.tax_id} onChange={set('tax_id')} className="input" />
          </Field>
          <Field label="Tax status">
            <select value={form.tax_status} onChange={set('tax_status')} className="input">
              <option value="">Not determined</option>
              {TAX_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.w9_on_file}
              onChange={(e) => setForm((f) => ({ ...f, w9_on_file: e.target.checked }))}
              className="rounded border-gray-300"
            />
            W-9 on file
          </label>
        </div>
      </FormCard>

      <AffiliationsEditor personId={person.id} personName={person.display_name} organizations={organizations} />

      <div className="card p-6">
        <label className="flex items-start gap-3 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={!form.is_active}
            onChange={(e) => setForm((f) => ({ ...f, is_active: !e.target.checked }))}
            className="mt-0.5 rounded border-gray-300"
          />
          <span>
            <span className="font-medium text-gray-900">Archived</span>
            <span className="block text-gray-500">Hidden from the main list; their history stays intact.</span>
          </span>
        </label>
      </div>

      <div className="flex items-center justify-between">
        <button type="button" onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn btn-primary px-6">
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      <DeleteContactSection contactId={person.id} name={person.display_name} kind="person" />
    </form>
  )
}

/** Organization links; each change saves immediately. */
function AffiliationsEditor({
  personId,
  personName,
  organizations,
}: {
  personId: string
  personName: string
  organizations: PersonOrg[]
}) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState<ContactSearchHit | null>(null)
  const [relationship, setRelationship] = useState<AffiliationRelationship>('employee')
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PersonOrg | null>(null)

  async function run(write: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    setBusy(true)
    setError(null)
    const res = await write()
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    after?.()
    router.refresh()
  }

  const resetAdd = () => {
    setAdding(false)
    setPicked(null)
    setRelationship('employee')
    setTitle('')
  }

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Organizations</h2>
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="text-sm text-gray-600 hover:text-gray-900">
            + Add organization
          </button>
        )}
      </div>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      {adding && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
          {picked ? (
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-900">{picked.display_name}</span>
              <button type="button" onClick={() => setPicked(null)} className="text-xs text-gray-500 hover:underline">
                Change
              </button>
            </div>
          ) : (
            <ContactSearch
              kind="organization"
              label="Search organizations"
              placeholder="Search organizations…"
              excludeIds={organizations.filter((o) => !o.end_date).map((o) => o.organization.id)}
              onPick={setPicked}
              autoFocus
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <select
              value={relationship}
              onChange={(e) => setRelationship(e.target.value as AffiliationRelationship)}
              aria-label="Relationship"
              className="input"
            >
              {RELATIONSHIP_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {RELATIONSHIP_LABELS[r]}
                </option>
              ))}
            </select>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" aria-label="Title" className="input" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={!picked || busy}
              onClick={() =>
                picked &&
                run(() => addAffiliation({ contactId: personId, otherId: picked.id, relationship, title }), resetAdd)
              }
              className="btn btn-primary text-sm"
            >
              {busy ? 'Adding…' : 'Add'}
            </button>
            <button type="button" onClick={resetAdd} className="btn btn-secondary text-sm">
              Cancel
            </button>
          </div>
        </div>
      )}

      {organizations.length === 0 ? (
        <p className="text-sm text-gray-500">No organization links</p>
      ) : (
        <div className="space-y-3">
          {organizations.map((o) => (
            <div
              key={o.id}
              className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg border border-gray-200 ${o.end_date ? 'bg-gray-50' : 'bg-white'}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <Avatar name={o.organization.display_name} src={o.organization.imageUrl} shape="square" size="sm" />
                <div className="min-w-0">
                  <p className={`text-sm font-medium ${o.end_date ? 'text-gray-500' : 'text-gray-900'}`}>
                    {o.organization.display_name}
                    {o.end_date && <span className="ml-2 text-xs text-gray-400">(Former)</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {o.title || RELATIONSHIP_LABELS[o.relationship]}
                    {o.is_primary_contact && ' · Primary contact'}
                    {o.end_date && ` · Left ${formatDate(o.end_date)}`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setEditing(o)} disabled={busy} className="text-xs text-gray-600 hover:text-gray-900">
                  Edit
                </button>
                {o.end_date ? (
                  <button
                    type="button"
                    onClick={() => run(() => setAffiliationEnded(o.id, false))}
                    disabled={busy}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Reinstate
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => run(() => setAffiliationEnded(o.id, true))}
                    disabled={busy}
                    className="text-xs text-amber-600 hover:text-amber-800"
                  >
                    Mark former
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => confirm(`Remove the link to ${o.organization.display_name}?`) && run(() => removeAffiliation(o.id))}
                  disabled={busy}
                  className="text-xs text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditAffiliationModal
          affiliation={editing}
          personName={personName}
          organizationName={editing.organization.display_name}
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
