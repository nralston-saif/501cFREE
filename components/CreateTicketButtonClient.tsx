'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import TicketTagSelector from '@/components/TicketTagSelector'
import { createTicket, searchTicketContacts, type TicketContactOption } from '@/lib/actions/tickets'
import type { TeamMember, TicketPriority, TicketStatus } from '@/lib/supabase/types/database'

// Client half of the create-ticket button. The viewer and the assignee list
// are resolved on the server (see CreateTicketButton.tsx) and passed in, so
// this never renders a placeholder or pops in late.

export type Assignee = Pick<TeamMember, 'id' | 'full_name'>

export default function CreateTicketButtonClient({
  currentMemberId,
  assignees,
  className,
}: {
  currentMemberId: string
  assignees: Assignee[]
  className?: string
}) {
  const [showModal, setShowModal] = useState(false)

  return (
    <>
      <button
        onClick={() => setShowModal(true)}
        className={className || 'btn btn-secondary whitespace-nowrap'}
      >
        + Create Ticket
      </button>

      {showModal && (
        <QuickTicketModal
          onClose={() => setShowModal(false)}
          currentMemberId={currentMemberId}
          assignees={assignees}
        />
      )}
    </>
  )
}

function QuickTicketModal({
  onClose,
  currentMemberId,
  assignees,
}: {
  onClose: () => void
  currentMemberId: string
  assignees: Assignee[]
}) {
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    status: 'open' as TicketStatus,
    priority: 'medium' as TicketPriority,
    due_date: '',
    assigned_to: '',
    tags: [] as string[],
  })
  const [contact, setContact] = useState<TicketContactOption | null>(null)
  const [loading, setLoading] = useState(false)
  const fieldId = useId()

  const router = useRouter()
  const { showToast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.title.trim()) {
      showToast('Title is required', 'error')
      return
    }

    setLoading(true)
    const res = await createTicket({
      title: formData.title,
      description: formData.description,
      status: formData.status,
      priority: formData.priority,
      due_date: formData.due_date || null,
      assigned_to: formData.assigned_to || null,
      contact_id: contact?.id ?? null,
      tags: formData.tags,
    })
    setLoading(false)

    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }

    showToast('Ticket created', 'success')
    router.refresh()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-[0_0_50px_rgba(0,0,0,0.3)] w-full max-w-md max-h-[85vh] overflow-y-auto border border-gray-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between rounded-t-xl">
          <h2 className="text-base font-semibold text-gray-900">Create Ticket</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label htmlFor={`${fieldId}-title`} className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id={`${fieldId}-title`}
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="input"
              placeholder="e.g., Send the quarterly report"
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor={`${fieldId}-description`} className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id={`${fieldId}-description`}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="input"
              rows={2}
              placeholder="Add details..."
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${fieldId}-priority`} className="block text-sm font-medium text-gray-700 mb-1">
                Priority <span className="text-red-500">*</span>
              </label>
              <select
                id={`${fieldId}-priority`}
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value as TicketPriority })}
                className="input"
                required
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>

            <div>
              <label htmlFor={`${fieldId}-assignee`} className="block text-sm font-medium text-gray-700 mb-1">
                Assign To
              </label>
              <select
                id={`${fieldId}-assignee`}
                value={formData.assigned_to}
                onChange={(e) => setFormData({ ...formData, assigned_to: e.target.value })}
                className="input"
              >
                <option value="">Unassigned</option>
                {assignees.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.full_name}
                    {member.id === currentMemberId ? ' (you)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${fieldId}-due-date`} className="block text-sm font-medium text-gray-700 mb-1">
                Due Date
              </label>
              <input
                id={`${fieldId}-due-date`}
                type="date"
                value={formData.due_date}
                onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
                className="input"
              />
            </div>

            <div>
              <label htmlFor={`${fieldId}-status`} className="block text-sm font-medium text-gray-700 mb-1">
                Status <span className="text-red-500">*</span>
              </label>
              <select
                id={`${fieldId}-status`}
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as TicketStatus })}
                className="input"
                required
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
              </select>
            </div>
          </div>

          <div>
            <label htmlFor={`${fieldId}-contact`} className="block text-sm font-medium text-gray-700 mb-1">
              Related Contact
            </label>
            <TicketContactPicker id={`${fieldId}-contact`} value={contact} onChange={setContact} />
          </div>

          <div>
            <label htmlFor={`${fieldId}-tags`} className="block text-sm font-medium text-gray-700 mb-1">
              Tags
            </label>
            <TicketTagSelector
              id={`${fieldId}-tags`}
              selectedTags={formData.tags}
              onChange={(tags) => setFormData({ ...formData, tags })}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary text-sm"
              disabled={loading}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary text-sm" disabled={loading}>
              {loading ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/**
 * Search-as-you-type picker over contacts (people and organizations). Shared
 * with the ticket detail view.
 */
export function TicketContactPicker({
  id,
  value,
  onChange,
  disabled,
}: {
  /** Id for the search input, so a <label htmlFor> can name it. */
  id?: string
  value: TicketContactOption | null
  onChange: (contact: TicketContactOption | null) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<TicketContactOption[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Debounced search; results are cleared by the handlers that make the query
  // too short to search.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const res = await searchTicketContacts(q)
      if (!cancelled && res.ok) setResults(res.contacts)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 input">
        <span className="truncate text-sm">
          {value.display_name}
          <span className="ml-1 text-xs text-gray-400">{value.kind === 'organization' ? 'Organization' : 'Person'}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Clear contact"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="relative" ref={ref}>
      <input
        id={id}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          if (e.target.value.trim().length < 2) setResults([])
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        className="input"
        placeholder="Search people and organizations..."
        disabled={disabled}
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {results.length === 0 ? (
            <div className="px-4 py-2.5 text-gray-500 text-sm text-center">No contacts found</div>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  onChange(c)
                  setQuery('')
                  setResults([])
                  setOpen(false)
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-50 flex items-center justify-between gap-2 text-sm"
              >
                <span className="truncate">{c.display_name}</span>
                <span className="text-xs text-gray-400">{c.kind === 'organization' ? 'Organization' : 'Person'}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
