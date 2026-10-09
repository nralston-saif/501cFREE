'use client'

import { useState } from 'react'
import { updateOrganization } from '@/lib/actions/contacts'
import { ENTITY_TYPE_LABELS, ROLE_FLAGS, type ContactRoleFlag } from '@/lib/contacts/crm'
import { TAX_STATUS_OPTIONS } from '@/lib/utils/tax-status'
import type { Contact, ContactEntityType, ContactTaxStatus } from '@/lib/supabase/types/database'
import TicketTagSelector from '@/components/TicketTagSelector'
import { DeleteContactSection, Field, FormCard, ImageEditor, RoleCheckboxes } from '@/components/crm/ProfileFields'

function initialForm(org: Contact) {
  return {
    name: org.name ?? org.display_name,
    previous_names: org.previous_names.join(', '),
    description: org.description ?? '',
    website: org.website ?? '',
    entity_type: (org.entity_type ?? '') as ContactEntityType | '',
    email: org.email ?? '',
    alternative_emails: org.alternative_emails.join(', '),
    phone: org.phone ?? '',
    address_line1: org.address_line1 ?? '',
    address_line2: org.address_line2 ?? '',
    city: org.city ?? '',
    state: org.state ?? '',
    postal_code: org.postal_code ?? '',
    country: org.country ?? '',
    legal_name: org.legal_name ?? '',
    tax_id: org.tax_id ?? '',
    tax_status: (org.tax_status ?? '') as ContactTaxStatus | '',
    w9_on_file: org.w9_on_file,
    is_active: org.is_active,
    tags: org.tags,
    roles: Object.fromEntries(ROLE_FLAGS.map(({ flag }) => [flag, org[flag]])) as Record<ContactRoleFlag, boolean>,
  }
}

export default function OrganizationEditForm({
  organization: org,
  imageUrl,
  onCancel,
  onSaved,
}: {
  organization: Contact
  imageUrl: string | null
  onCancel: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState(() => initialForm(org))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof typeof form>(key: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const res = await updateOrganization(org.id, form)
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

      <FormCard title="Organization information">
        <div className="flex flex-col sm:flex-row gap-6">
          <ImageEditor contactId={org.id} name={org.display_name} src={imageUrl} shape="square" />
          <div className="flex-1 space-y-4">
            <Field label="Name *">
              <input required value={form.name} onChange={set('name')} className="input" />
            </Field>
            <Field label="Former names" hint="Separate multiple names with commas">
              <input value={form.previous_names} onChange={set('previous_names')} placeholder="e.g. Old Name Foundation" className="input" />
            </Field>
          </div>
        </div>
        <div className="mt-4 space-y-4">
          <Field label="Description">
            <textarea
              rows={3}
              value={form.description}
              onChange={set('description')}
              placeholder="What the organization does…"
              className="input"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Website">
              <input value={form.website} onChange={set('website')} placeholder="https://example.org" className="input" />
            </Field>
            <Field label="Entity type">
              <select value={form.entity_type} onChange={set('entity_type')} className="input">
                <option value="">Not set</option>
                {(Object.keys(ENTITY_TYPE_LABELS) as ContactEntityType[]).map((t) => (
                  <option key={t} value={t}>
                    {ENTITY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <RoleCheckboxes value={form.roles} onChange={(roles) => setForm((f) => ({ ...f, roles }))} />
          <div>
            <span className="block text-sm font-medium text-gray-700 mb-1">Tags</span>
            <TicketTagSelector selectedTags={form.tags} onChange={(tags) => setForm((f) => ({ ...f, tags }))} />
          </div>
        </div>
      </FormCard>

      <FormCard title="Contact and address">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Email">
            <input type="email" value={form.email} onChange={set('email')} className="input" />
          </Field>
          <Field label="Phone">
            <input type="tel" value={form.phone} onChange={set('phone')} className="input" />
          </Field>
          <Field label="Other emails" hint="Separate with commas" className="sm:col-span-2">
            <input value={form.alternative_emails} onChange={set('alternative_emails')} className="input" />
          </Field>
          <Field label="Address line 1" className="sm:col-span-2">
            <input value={form.address_line1} onChange={set('address_line1')} className="input" />
          </Field>
          <Field label="Address line 2" className="sm:col-span-2">
            <input value={form.address_line2} onChange={set('address_line2')} className="input" />
          </Field>
          <Field label="City">
            <input value={form.city} onChange={set('city')} className="input" />
          </Field>
          <Field label="State / region">
            <input value={form.state} onChange={set('state')} className="input" />
          </Field>
          <Field label="Postal code">
            <input value={form.postal_code} onChange={set('postal_code')} className="input" />
          </Field>
          <Field label="Country">
            <input value={form.country} onChange={set('country')} className="input" />
          </Field>
        </div>
      </FormCard>

      <FormCard title="Tax and compliance">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Legal name" hint="If different, for letters and tax forms" className="sm:col-span-2">
            <input value={form.legal_name} onChange={set('legal_name')} className="input" />
          </Field>
          <Field label="Tax ID / EIN">
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
            <span className="block text-gray-500">Hidden from the main list; its history stays intact.</span>
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

      <DeleteContactSection contactId={org.id} name={org.display_name} kind="organization" />
    </form>
  )
}
