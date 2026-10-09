'use client'

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createOrganization, type RoleFlags } from '@/lib/actions/crm-create'
import { ENTITY_TYPE_LABELS, ROLE_FLAGS } from '@/lib/contacts/crm'
import type { ContactEntityType } from '@/lib/supabase/types/database'

const EMPTY = {
  name: '',
  entity_type: '' as ContactEntityType | '',
  description: '',
  website: '',
  city: '',
  state: '',
  country: '',
}

export default function AddOrganizationModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const id = useId()
  const [form, setForm] = useState(EMPTY)
  const [roles, setRoles] = useState<RoleFlags>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const close = () => {
    if (!saving) onClose()
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const result = await createOrganization({
      ...form,
      entity_type: form.entity_type || null,
      roles,
    })
    if (!result.ok) {
      setError(result.error)
      setSaving(false)
      return
    }
    router.push(`/organizations/${result.organization.id}`)
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-title`}
        className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 id={`${id}-title`} className="text-xl font-semibold text-gray-900">
              Add New Organization
            </h2>
            <button type="button" onClick={close} className="text-gray-400 hover:text-gray-600" aria-label="Close">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor={`${id}-name`} className="block text-sm font-medium text-gray-700 mb-1">
                Name <span className="text-red-500">*</span>
              </label>
              <input
                id={`${id}-name`}
                type="text"
                required
                autoFocus
                value={form.name}
                onChange={set('name')}
                className="input"
                placeholder="Example Community Foundation"
              />
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 mb-1">Roles</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ROLE_FLAGS.map(({ flag, label }) => (
                  <label key={flag} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={roles[flag] === true}
                      onChange={(e) => setRoles((r) => ({ ...r, [flag]: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div>
              <label htmlFor={`${id}-entity`} className="block text-sm font-medium text-gray-700 mb-1">
                Entity type
              </label>
              <select id={`${id}-entity`} value={form.entity_type} onChange={set('entity_type')} className="input">
                <option value="">Not set</option>
                {(Object.keys(ENTITY_TYPE_LABELS) as ContactEntityType[]).map((t) => (
                  <option key={t} value={t}>
                    {ENTITY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor={`${id}-description`} className="block text-sm font-medium text-gray-700 mb-1">
                Description
              </label>
              <textarea
                id={`${id}-description`}
                rows={3}
                value={form.description}
                onChange={set('description')}
                className="input"
                placeholder="Brief description of what the organization does..."
              />
            </div>

            <div>
              <label htmlFor={`${id}-website`} className="block text-sm font-medium text-gray-700 mb-1">
                Website
              </label>
              <input
                id={`${id}-website`}
                type="text"
                inputMode="url"
                value={form.website}
                onChange={set('website')}
                className="input"
                placeholder="https://example.org"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label htmlFor={`${id}-city`} className="block text-sm font-medium text-gray-700 mb-1">
                  City
                </label>
                <input id={`${id}-city`} type="text" value={form.city} onChange={set('city')} className="input" />
              </div>
              <div>
                <label htmlFor={`${id}-state`} className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <input id={`${id}-state`} type="text" value={form.state} onChange={set('state')} className="input" />
              </div>
              <div>
                <label htmlFor={`${id}-country`} className="block text-sm font-medium text-gray-700 mb-1">
                  Country
                </label>
                <input
                  id={`${id}-country`}
                  type="text"
                  value={form.country}
                  onChange={set('country')}
                  className="input"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
              <button type="button" onClick={close} className="btn btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={saving || !form.name.trim()} className="btn btn-primary">
                {saving ? 'Creating...' : 'Create Organization'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
