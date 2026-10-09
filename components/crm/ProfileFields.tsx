'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteContact, removeContactImage, uploadContactImage } from '@/lib/actions/contacts'
import { CONTACT_IMAGE_TYPES, ROLE_FLAGS, type ContactRoleFlag } from '@/lib/contacts/crm'
import type { ContactKind } from '@/lib/supabase/types/database'
import Avatar from './Avatar'
import Modal from './Modal'

// Building blocks shared by the Organization and Person edit forms.

export function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-500">{hint}</span>}
    </label>
  )
}

export function FormCard({ title, tone = 'plain', children }: { title: string; tone?: 'plain' | 'blue'; children: React.ReactNode }) {
  return (
    <div className={tone === 'blue' ? 'rounded-xl border border-blue-100 bg-blue-50 p-6' : 'card p-6'}>
      <h2 className={`text-lg font-semibold mb-4 ${tone === 'blue' ? 'text-blue-900' : 'text-gray-900'}`}>{title}</h2>
      {children}
    </div>
  )
}

export function RoleCheckboxes({
  value,
  onChange,
}: {
  value: Record<ContactRoleFlag, boolean>
  onChange: (next: Record<ContactRoleFlag, boolean>) => void
}) {
  return (
    <fieldset>
      <legend className="block text-sm font-medium text-gray-700 mb-2">Roles</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {ROLE_FLAGS.map(({ flag, label }) => (
          <label key={flag} className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={value[flag]}
              onChange={(e) => onChange({ ...value, [flag]: e.target.checked })}
              className="rounded border-gray-300"
            />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** Logo/photo with upload and remove; saves immediately. */
export function ImageEditor({
  contactId,
  name,
  src,
  shape,
}: {
  contactId: string
  name: string
  src: string | null
  shape: 'round' | 'square'
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noun = shape === 'round' ? 'photo' : 'logo'

  async function upload(file: File) {
    setBusy(true)
    setError(null)
    const formData = new FormData()
    formData.set('file', file)
    const res = await uploadContactImage(contactId, formData)
    setBusy(false)
    if (!res.ok) setError(res.error)
    else router.refresh()
  }

  async function remove() {
    setBusy(true)
    setError(null)
    const res = await removeContactImage(contactId)
    setBusy(false)
    if (!res.ok) setError(res.error)
    else router.refresh()
  }

  return (
    <div className="flex-shrink-0">
      <Avatar name={name} src={src} shape={shape} size="xl" />
      <div className="mt-2 flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="btn btn-secondary text-xs px-3 py-1"
        >
          {busy ? 'Saving…' : `Change ${noun}`}
        </button>
        {src && (
          <button type="button" onClick={remove} disabled={busy} className="text-xs text-red-600 hover:text-red-800">
            Remove {noun}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={CONTACT_IMAGE_TYPES.join(',')}
          aria-label={`Upload ${noun}`}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) upload(file)
          }}
        />
        {error && <p className="text-xs text-red-600 max-w-40">{error}</p>}
      </div>
    </div>
  )
}

/** "Delete this organization/person" link with a confirmation dialog. */
export function DeleteContactSection({ contactId, name, kind }: { contactId: string; name: string; kind: ContactKind }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const noun = kind === 'person' ? 'person' : 'organization'

  async function confirm() {
    setBusy(true)
    setError(null)
    const res = await deleteContact(contactId)
    if (!res.ok) {
      setBusy(false)
      setError(res.error)
      return
    }
    router.push(kind === 'person' ? '/people' : '/organizations')
  }

  return (
    <div className="pt-6 border-t border-gray-200">
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-red-600 hover:text-red-800">
        Delete this {noun}
      </button>
      {open && (
        <Modal
          title={`Delete ${noun}`}
          onClose={() => {
            setOpen(false)
            setError(null)
          }}
          busy={busy}
          size="sm"
          footer={
            <>
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="btn btn-secondary">
                Cancel
              </button>
              <button type="button" onClick={confirm} disabled={busy} className="btn btn-danger">
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            </>
          }
        >
          <p className="text-sm text-gray-600">
            Delete <strong>{name}</strong>? Their {kind === 'person' ? 'organization links' : 'people links'}, files and
            meeting attendance go too. Notes linked only to this {noun} are deleted, whoever wrote them, along with
            their attached files; notes also linked to other records stay there. This can&apos;t be undone.
          </p>
          <p className="mt-2 text-sm text-gray-500">
            Records with contributions, grants, proposals, PRIs or expenses can&apos;t be deleted. Archive them instead.
          </p>
          {error && <p className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-800">{error}</p>}
        </Modal>
      )}
    </div>
  )
}
