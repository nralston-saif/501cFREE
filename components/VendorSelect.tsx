'use client'

import { useId, useState } from 'react'
import { createVendorInline } from '@/lib/actions/contacts'
import type { ContactKind } from '@/lib/supabase/types/database'

interface ContactOption {
  id: string
  display_name: string
}

interface VendorSelectProps {
  name: string
  /** Id for the vendor <select>, so a <label htmlFor> can name it. */
  id?: string
  contacts: ContactOption[]
  defaultValue?: string | null
  placeholder?: string
  /** Prefills the "add new vendor" name, e.g. the payee read off an invoice. */
  suggestedName?: string | null
  /** Called with the selected vendor id whenever it changes. */
  onChange?: (vendorId: string) => void
  /** Called after a vendor is created from the inline panel. */
  onCreated?: (vendor: ContactOption) => void
}

const ADD_NEW = '__add_new__'
const labelClass = 'block text-xs font-medium text-gray-600 mb-1'

/**
 * Vendor picker with an inline "add new vendor" panel, so a vendor can be
 * created without leaving a half-filled expense form. The chosen vendor id is
 * submitted via a hidden input named `name`; the inline-form inputs are
 * unnamed React state so they never post with the surrounding expense form.
 */
export default function VendorSelect({
  name,
  id,
  contacts,
  defaultValue,
  placeholder = 'Select a vendor…',
  suggestedName,
  onChange,
  onCreated,
}: VendorSelectProps) {
  const [options, setOptions] = useState<ContactOption[]>(contacts)
  // Pick up vendors the parent learns about (e.g. created from another row),
  // adjusting state during render when the prop changes. Options are only
  // ever added: vendors created here stay listed.
  const [prevContacts, setPrevContacts] = useState(contacts)
  if (contacts !== prevContacts) {
    setPrevContacts(contacts)
    setOptions((prev) => {
      const known = new Set(prev.map((o) => o.id))
      const added = contacts.filter((c) => !known.has(c.id))
      return added.length === 0
        ? prev
        : [...prev, ...added].sort((a, b) => a.display_name.localeCompare(b.display_name))
    })
  }
  const [selected, setSelected] = useState<string>(defaultValue ?? '')
  const [adding, setAdding] = useState(false)
  const fieldId = useId()

  const [vName, setVName] = useState('')
  const [vType, setVType] = useState<ContactKind>('organization')
  const [vTaxId, setVTaxId] = useState('')
  const [vW9, setVW9] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const openAddPanel = () => {
    setError('')
    if (!vName && suggestedName) setVName(suggestedName)
    setAdding(true)
  }

  const cancelAdd = () => {
    setAdding(false)
    setError('')
    setVName('')
    setVType('organization')
    setVTaxId('')
    setVW9(false)
  }

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === ADD_NEW) {
      openAddPanel()
      return // leave `selected` unchanged; controlled <select> snaps back
    }
    setSelected(e.target.value)
    onChange?.(e.target.value)
  }

  const saveVendor = async () => {
    setError('')
    if (!vName.trim()) {
      setError('Vendor name is required')
      return
    }
    setSaving(true)
    const result = await createVendorInline({
      name: vName,
      kind: vType,
      tax_id: vTaxId,
      w9_on_file: vW9,
    })
    setSaving(false)

    if (!result.ok) {
      setError(result.error)
      return
    }

    setOptions((prev) =>
      [...prev, result.vendor].sort((a, b) => a.display_name.localeCompare(b.display_name))
    )
    setSelected(result.vendor.id)
    onChange?.(result.vendor.id)
    onCreated?.(result.vendor)
    cancelAdd()
  }

  return (
    <div>
      <input type="hidden" name={name} value={selected} />

      <select
        id={id}
        className="input"
        aria-label={id ? undefined : 'Vendor'}
        value={selected}
        onChange={handleSelectChange}
      >
        <option value="">{placeholder}</option>
        <option value={ADD_NEW}>+ Add new vendor…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.display_name}
          </option>
        ))}
      </select>

      {adding && (
        <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-700 mb-2">New vendor</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor={`${fieldId}-name`} className={labelClass}>
                Vendor name
              </label>
              <input
                id={`${fieldId}-name`}
                type="text"
                value={vName}
                autoFocus
                onChange={(e) => setVName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault() // don't submit the expense form
                    void saveVendor()
                  }
                }}
                className="input"
                placeholder="e.g. Acme Consulting LLC"
              />
            </div>

            <div>
              <label htmlFor={`${fieldId}-type`} className={labelClass}>
                Type
              </label>
              <select
                id={`${fieldId}-type`}
                value={vType}
                onChange={(e) => setVType(e.target.value as ContactKind)}
                className="input"
              >
                <option value="organization">Organization</option>
                <option value="person">Person</option>
              </select>
            </div>

            <div>
              <label htmlFor={`${fieldId}-tax-id`} className={labelClass}>
                EIN / Tax ID (optional)
              </label>
              <input
                id={`${fieldId}-tax-id`}
                type="text"
                value={vTaxId}
                onChange={(e) => setVTaxId(e.target.value)}
                className="input"
                placeholder="12-3456789"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={vW9}
                  onChange={(e) => setVW9(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300"
                />
                W-9 on file
              </label>
            </div>
          </div>

          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void saveVendor()}
              disabled={saving}
              className="btn btn-primary"
            >
              {saving ? 'Saving…' : 'Save vendor'}
            </button>
            <button type="button" onClick={cancelAdd} disabled={saving} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
