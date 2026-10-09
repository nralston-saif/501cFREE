'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import StatusBadge from '@/components/StatusBadge'
import TicketTagSelector from '@/components/TicketTagSelector'
import { TicketContactPicker } from '@/components/CreateTicketButtonClient'
import {
  addTicketComment,
  closeTicket,
  deleteTicket,
  deleteTicketComment,
  listTicketComments,
  updateTicket,
  updateTicketComment,
  type TicketCommentView,
  type TicketContactOption,
  type TicketPatch,
} from '@/lib/actions/tickets'
import type { TeamMember, Ticket, TicketPriority, TicketStatus } from '@/lib/supabase/types/database'

// Ticket list with search, sort, filters, stats, and close-with-resolution.
// Rows come from the server page; every write goes through a server action
// and then router.refresh() re-reads the list.

type MemberRef = Pick<TeamMember, 'id' | 'full_name'>

export type TicketRow = Pick<
  Ticket,
  | 'id'
  | 'title'
  | 'description'
  | 'status'
  | 'priority'
  | 'due_date'
  | 'created_at'
  | 'closed_at'
  | 'tags'
  | 'is_flagged'
  | 'assigned_to'
  | 'created_by'
  | 'contact_id'
> & {
  assignee: MemberRef | null
  creator: MemberRef | null
  contact: TicketContactOption | null
}

type Tab = 'active' | 'closed' | 'unassigned' | 'all'
type StageFilter = 'all' | 'open' | 'in_progress' | 'review'
type SortOption = 'newest' | 'oldest' | 'priority' | 'due-date' | 'title'

const STATUSES: TicketStatus[] = ['open', 'in_progress', 'review', 'closed']
const PRIORITY_ORDER: Record<TicketPriority, number> = { high: 0, medium: 1, low: 2 }
const PRIORITY_STYLES: Record<TicketPriority, string> = {
  high: 'bg-red-100 text-red-700',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-gray-100 text-gray-600',
}

function memberName(m: MemberRef | null, fallback = 'Unassigned'): string {
  return m?.full_name || fallback
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  // Bare dates (due_date) are calendar days: parse as local, not UTC midnight
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function isOverdue(t: TicketRow): boolean {
  return !!t.due_date && new Date(`${t.due_date}T23:59:59`) < new Date() && t.status !== 'closed'
}

export default function TicketsClient({
  tickets,
  members,
  currentMemberId,
  isAdmin,
}: {
  tickets: TicketRow[]
  members: MemberRef[]
  currentMemberId: string
  isAdmin: boolean
}) {
  // Track the open ticket by id so it picks up fresh data after a refresh
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)
  const selected = tickets.find((t) => t.id === selectedId) ?? null
  const resolving = tickets.find((t) => t.id === resolvingId) ?? null

  const [tab, setTab] = useState<Tab>('active')
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<StageFilter>('all')
  const [priorityFilter, setPriorityFilter] = useState<'all' | TicketPriority>('all')
  // The default Active view is your own tickets
  const [assigneeFilter, setAssigneeFilter] = useState<string>(currentMemberId)
  const [sort, setSort] = useState<SortOption>('newest')

  const visible = useMemo(() => {
    let rows = tickets

    if (tab === 'active' || tab === 'unassigned') rows = rows.filter((t) => t.status !== 'closed')
    else if (tab === 'closed') rows = rows.filter((t) => t.status === 'closed')

    if (stageFilter !== 'all') rows = rows.filter((t) => t.status === stageFilter)
    if (priorityFilter !== 'all') rows = rows.filter((t) => t.priority === priorityFilter)
    if (assigneeFilter === 'unassigned') rows = rows.filter((t) => !t.assigned_to)
    else if (assigneeFilter !== 'all') rows = rows.filter((t) => t.assigned_to === assigneeFilter)

    const q = search.trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.description?.toLowerCase().includes(q) ||
          t.contact?.display_name.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      )
    }

    return [...rows].sort((a, b) => {
      switch (sort) {
        case 'oldest':
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        case 'priority':
          return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
        case 'due-date':
          if (!a.due_date) return 1
          if (!b.due_date) return -1
          return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
        case 'title':
          return a.title.localeCompare(b.title)
        default:
          // Closed sorts by when it was closed
          if (tab === 'closed') {
            return (b.closed_at ? +new Date(b.closed_at) : 0) - (a.closed_at ? +new Date(a.closed_at) : 0)
          }
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      }
    })
  }, [tickets, tab, search, stageFilter, priorityFilter, assigneeFilter, sort])

  const counts = useMemo(() => {
    const active = tickets.filter((t) => t.status !== 'closed')
    return {
      mine: active.filter((t) => t.assigned_to === currentMemberId).length,
      unassigned: active.filter((t) => !t.assigned_to).length,
      active: active.length,
      closed: tickets.filter((t) => t.status === 'closed').length,
      all: tickets.length,
      open: tickets.filter((t) => t.status === 'open').length,
      inProgress: tickets.filter((t) => t.status === 'in_progress').length,
      review: tickets.filter((t) => t.status === 'review').length,
      overdue: tickets.filter(isOverdue).length,
    }
  }, [tickets, currentMemberId])

  const TABS: { key: Tab; label: string; assignee: string }[] = [
    { key: 'active', label: `Active (${counts.mine})`, assignee: currentMemberId },
    { key: 'closed', label: `Closed (${counts.closed})`, assignee: 'all' },
    { key: 'unassigned', label: `Unassigned (${counts.unassigned})`, assignee: 'unassigned' },
    { key: 'all', label: `All (${counts.all})`, assignee: 'all' },
  ]

  return (
    <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
      {/* Left - filters and list */}
      <div className="flex-1 min-w-0 order-2 lg:order-1">
        <div className="bg-white rounded-xl border border-gray-200 p-4 rounded-b-none border-b-0">
          <div className="flex flex-col gap-4">
            <input
              type="text"
              placeholder="Search tickets by title, description, or tags..."
              aria-label="Search tickets"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-gray-900 focus:border-gray-900"
            />

            <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => {
                    setTab(t.key)
                    setAssigneeFilter(t.assignee)
                  }}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap flex-shrink-0 ${
                    tab === t.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 flex-1">
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value as StageFilter)}
                  aria-label="Filter by stage"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-gray-900 focus:border-gray-900"
                >
                  <option value="all">All Stages</option>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="review">Review</option>
                </select>

                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value as 'all' | TicketPriority)}
                  aria-label="Filter by priority"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-gray-900 focus:border-gray-900"
                >
                  <option value="all">All Priorities</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>

                <select
                  value={assigneeFilter}
                  onChange={(e) => setAssigneeFilter(e.target.value)}
                  aria-label="Filter by assignee"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-gray-900 focus:border-gray-900"
                >
                  <option value="all">All Assignees</option>
                  <option value="unassigned">Unassigned</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name}
                    </option>
                  ))}
                </select>

                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  aria-label="Sort tickets"
                  className="px-3 py-2 text-sm border border-gray-300 rounded-lg shadow-sm focus:outline-none focus:ring-gray-900 focus:border-gray-900 col-span-2 sm:col-span-1"
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="priority">Priority</option>
                  <option value="due-date">Due Date</option>
                  <option value="title">Title (A-Z)</option>
                </select>
              </div>
              <p className="text-xs sm:text-sm font-medium text-gray-500 sm:text-gray-700 whitespace-nowrap">
                {visible.length} {visible.length === 1 ? 'result' : 'results'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl rounded-t-none border border-gray-200 overflow-hidden">
          {visible.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-600">No tickets found</p>
              <p className="text-sm text-gray-400 mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {visible.map((t) => (
                <div
                  key={t.id}
                  onClick={() => setSelectedId(t.id)}
                  className="p-3 sm:p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 mb-1">
                        {t.is_flagged && (
                          <span className="text-red-500 text-sm leading-6" title="Flagged">
                            ⚑
                          </span>
                        )}
                        <h3 className="font-medium text-gray-900 text-sm sm:text-base line-clamp-2 sm:truncate flex-1 min-w-0">
                          {t.title}
                        </h3>
                      </div>

                      <div className="flex items-center gap-1.5 sm:gap-2 mb-1.5 flex-wrap">
                        <StatusBadge status={t.status} />
                        <span
                          className={`inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full text-[10px] sm:text-xs font-medium capitalize ${PRIORITY_STYLES[t.priority]}`}
                        >
                          {t.priority}
                        </span>
                        {t.due_date && (
                          <div
                            className={`sm:hidden inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                              isOverdue(t) ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
                            }`}
                          >
                            {isOverdue(t) ? 'Overdue' : formatDate(t.due_date)}
                          </div>
                        )}
                      </div>

                      {t.description && (
                        <p className="hidden sm:block text-sm text-gray-600 line-clamp-1 mb-1.5">{t.description}</p>
                      )}

                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap text-[10px] sm:text-xs">
                        <span className="text-gray-500 truncate">{memberName(t.assignee)}</span>
                        {t.contact && <span className="text-gray-500 truncate">{t.contact.display_name}</span>}
                        <span className="text-gray-400">{formatDate(t.created_at)}</span>
                        {t.status === 'closed' && t.closed_at && (
                          <span className="text-emerald-600">Closed {formatDate(t.closed_at)}</span>
                        )}
                        {t.tags.length > 0 && (
                          <div className="hidden sm:flex flex-wrap gap-1">
                            {t.tags.map((tag) => (
                              <span key={tag} className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-700">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="hidden sm:flex items-center gap-2 flex-shrink-0">
                      {t.due_date && (
                        <div
                          className={`flex items-center px-2.5 py-1 rounded-lg ${
                            isOverdue(t) ? 'bg-red-100 text-red-700' : 'bg-blue-50 text-blue-700'
                          }`}
                        >
                          <span className="text-xs font-medium whitespace-nowrap">
                            {isOverdue(t) ? 'Overdue' : formatDate(t.due_date)}
                          </span>
                        </div>
                      )}
                      {t.status !== 'closed' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setResolvingId(t.id)
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-lg transition-colors"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right - stats: horizontal strip on mobile, sticky sidebar on desktop */}
      <div className="w-full lg:w-48 flex-shrink-0 order-1 lg:order-2">
        <div className="lg:sticky lg:top-20 flex lg:flex-col gap-2 lg:gap-3 overflow-x-auto pb-2 lg:pb-0 -mx-1 px-1 lg:mx-0 lg:px-0">
          <StatCard label="Total" value={counts.all} color="gray" />
          <StatCard label="Open" value={counts.open} color="blue" />
          <StatCard label="In Progress" value={counts.inProgress} color="amber" />
          <StatCard label="Review" value={counts.review} color="purple" />
          <StatCard label="Closed" value={counts.closed} color="green" />
          <StatCard label="Overdue" value={counts.overdue} color="red" />
        </div>
      </div>

      {selected && (
        <TicketDetail
          key={selected.id}
          ticket={selected}
          members={members}
          currentMemberId={currentMemberId}
          canDelete={isAdmin || selected.created_by === currentMemberId}
          onClose={() => setSelectedId(null)}
        />
      )}

      {resolving && <ResolveModal ticket={resolving} onClose={() => setResolvingId(null)} />}
    </div>
  )
}

// A horizontal strip on mobile, a sticky vertical sidebar on desktop.
function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorClasses: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-900',
    blue: 'bg-blue-100 text-blue-900',
    amber: 'bg-amber-100 text-amber-900',
    purple: 'bg-purple-100 text-purple-900',
    green: 'bg-emerald-100 text-emerald-900',
    red: 'bg-red-100 text-red-900',
  }
  return (
    <div className={`rounded-lg p-2 lg:p-3 min-w-[70px] lg:min-w-0 flex-shrink-0 ${colorClasses[color] || colorClasses.gray}`}>
      <div className="text-lg lg:text-xl font-bold">{value}</div>
      <div className="text-[10px] lg:text-xs font-medium whitespace-nowrap">{label}</div>
    </div>
  )
}

function ResolveModal({ ticket, onClose }: { ticket: TicketRow; onClose: () => void }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const resolutionId = useId()

  // An optional closing comment, recorded as the resolution, then close.
  const submit = async () => {
    setBusy(true)
    const res = await closeTicket(ticket.id, comment)
    setBusy(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    showToast('Ticket closed', 'success')
    onClose()
    router.refresh()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-base font-semibold text-gray-900">Resolve ticket</h2>
          <p className="text-xs text-gray-500 mt-0.5 truncate">{ticket.title}</p>
        </div>
        <div className="p-4">
          <label htmlFor={resolutionId} className="block text-sm font-medium text-gray-700 mb-1">
            Resolution (optional)
          </label>
          <textarea
            id={resolutionId}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="input"
            rows={3}
            placeholder="What was done?"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={onClose} className="btn btn-secondary text-sm" disabled={busy}>
              Cancel
            </button>
            <button onClick={submit} className="btn btn-primary text-sm" disabled={busy}>
              {busy ? 'Resolving...' : 'Resolve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TicketDetail({
  ticket,
  members,
  currentMemberId,
  canDelete,
  onClose,
}: {
  ticket: TicketRow
  members: MemberRef[]
  currentMemberId: string
  canDelete: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [comments, setComments] = useState<TicketCommentView[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    title: ticket.title,
    description: ticket.description ?? '',
    tags: ticket.tags,
  })
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const fieldId = useId()

  const loadComments = useCallback(async () => {
    const res = await listTicketComments(ticket.id)
    if (res.ok) setComments(res.comments)
  }, [ticket.id])

  // Initial load (and reload if the ticket changes); results for a ticket
  // that's no longer shown are dropped.
  useEffect(() => {
    let cancelled = false
    listTicketComments(ticket.id).then((res) => {
      if (!cancelled && res.ok) setComments(res.comments)
    })
    return () => {
      cancelled = true
    }
  }, [ticket.id])

  const patch = async (fields: TicketPatch) => {
    setBusy(true)
    const res = await updateTicket(ticket.id, fields)
    setBusy(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return false
    }
    router.refresh()
    return true
  }

  const saveEdits = async () => {
    if (!form.title.trim()) {
      showToast('Title is required', 'error')
      return
    }
    const ok = await patch({ title: form.title, description: form.description, tags: form.tags })
    if (ok) {
      setEditing(false)
      showToast('Ticket updated', 'success')
    }
  }

  const remove = async () => {
    if (!confirm('Delete this ticket and its comments? This cannot be undone.')) return
    setBusy(true)
    const res = await deleteTicket(ticket.id)
    setBusy(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return
    }
    showToast('Ticket deleted', 'success')
    onClose()
    router.refresh()
  }

  // Comment writes run a server action, then re-read the thread
  const commentAction = async (run: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setBusy(true)
    const res = await run()
    setBusy(false)
    if (!res.ok) {
      showToast(res.error, 'error')
      return false
    }
    await loadComments()
    return true
  }

  const addComment = async () => {
    const content = draft.trim()
    if (!content) return
    if (await commentAction(() => addTicketComment(ticket.id, content))) setDraft('')
  }

  const saveComment = async (commentId: string) => {
    if (await commentAction(() => updateTicketComment(commentId, commentDraft))) setEditingCommentId(null)
  }

  const removeComment = async (commentId: string) => {
    if (!confirm('Delete this comment?')) return
    await commentAction(() => deleteTicketComment(commentId))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{ticket.title}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Filed by {memberName(ticket.creator, 'a former member')} · {formatDate(ticket.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => patch({ is_flagged: !ticket.is_flagged })}
              className={`btn btn-secondary text-xs ${ticket.is_flagged ? 'text-red-600' : ''}`}
              disabled={busy}
              title={ticket.is_flagged ? 'Remove flag' : 'Flag for attention'}
            >
              {ticket.is_flagged ? 'Unflag' : 'Flag'}
            </button>
            {!editing && (
              <button onClick={() => setEditing(true)} className="btn btn-secondary text-xs">
                Edit
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100" aria-label="Close">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {editing ? (
            <div className="space-y-3">
              <div>
                <label htmlFor={`${fieldId}-title`} className="block text-xs font-medium text-gray-500 mb-1">
                  Title
                </label>
                <input
                  id={`${fieldId}-title`}
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="input"
                />
              </div>
              <div>
                <label htmlFor={`${fieldId}-description`} className="block text-xs font-medium text-gray-500 mb-1">
                  Description
                </label>
                <textarea
                  id={`${fieldId}-description`}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  className="input"
                  rows={4}
                />
              </div>
              <div>
                <label htmlFor={`${fieldId}-tags`} className="block text-xs font-medium text-gray-500 mb-1">
                  Tags
                </label>
                <TicketTagSelector id={`${fieldId}-tags`} selectedTags={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
              </div>
              <div className="flex justify-between gap-2">
                {canDelete ? (
                  <button onClick={remove} className="text-sm text-red-600 hover:text-red-700" disabled={busy}>
                    Delete ticket
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setEditing(false)
                      setForm({ title: ticket.title, description: ticket.description ?? '', tags: ticket.tags })
                    }}
                    className="btn btn-secondary text-sm"
                    disabled={busy}
                  >
                    Cancel
                  </button>
                  <button onClick={saveEdits} className="btn btn-primary text-sm" disabled={busy}>
                    Save
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {ticket.description && <p className="text-sm text-gray-700 whitespace-pre-wrap">{ticket.description}</p>}
              {ticket.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {ticket.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${fieldId}-status`} className="block text-xs font-medium text-gray-500 mb-1">
                Status
              </label>
              <select
                id={`${fieldId}-status`}
                value={ticket.status}
                onChange={(e) => patch({ status: e.target.value as TicketStatus })}
                className="input text-sm"
                disabled={busy}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-priority`} className="block text-xs font-medium text-gray-500 mb-1">
                Priority
              </label>
              <select
                id={`${fieldId}-priority`}
                value={ticket.priority}
                onChange={(e) => patch({ priority: e.target.value as TicketPriority })}
                className="input text-sm"
                disabled={busy}
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-assignee`} className="block text-xs font-medium text-gray-500 mb-1">
                Assigned to
              </label>
              <select
                id={`${fieldId}-assignee`}
                value={ticket.assigned_to ?? ''}
                onChange={(e) => patch({ assigned_to: e.target.value || null })}
                className="input text-sm"
                disabled={busy}
              >
                <option value="">Unassigned</option>
                {/* Keep a former member visible while they're still the assignee */}
                {ticket.assignee && !members.some((m) => m.id === ticket.assignee!.id) && (
                  <option value={ticket.assignee.id}>{ticket.assignee.full_name}</option>
                )}
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldId}-due-date`} className="block text-xs font-medium text-gray-500 mb-1">
                Due date
              </label>
              <input
                id={`${fieldId}-due-date`}
                type="date"
                value={ticket.due_date ?? ''}
                onChange={(e) => patch({ due_date: e.target.value || null })}
                className="input text-sm"
                disabled={busy}
              />
            </div>
            <div className="col-span-2">
              <label htmlFor={`${fieldId}-contact`} className="block text-xs font-medium text-gray-500 mb-1">
                Related contact
                {ticket.contact && (
                  <Link href={`/contacts/${ticket.contact.id}`} className="ml-2 font-normal text-blue-600 hover:underline">
                    Open
                  </Link>
                )}
              </label>
              <TicketContactPicker
                id={`${fieldId}-contact`}
                value={ticket.contact}
                onChange={(c) => patch({ contact_id: c?.id ?? null })}
                disabled={busy}
              />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">
              Comments{comments.length > 0 ? ` (${comments.length})` : ''}
            </p>
            <div className="space-y-2 mb-3">
              {comments.map((c) => (
                <div
                  key={c.id}
                  className={`rounded-lg px-3 py-2 ${c.is_resolution ? 'bg-green-50 border border-green-100' : 'bg-gray-50'}`}
                >
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-xs text-gray-500">
                      {memberName(c.author, 'Former member')} · {formatDate(c.created_at)}
                      {c.is_resolution && <span className="ml-1 text-green-700">· resolution</span>}
                    </p>
                    {c.author_id === currentMemberId && editingCommentId !== c.id && (
                      <div className="flex gap-2 text-xs">
                        <button
                          onClick={() => {
                            setEditingCommentId(c.id)
                            setCommentDraft(c.content)
                          }}
                          className="text-gray-400 hover:text-gray-700"
                          disabled={busy}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => removeComment(c.id)}
                          className="text-gray-400 hover:text-red-600"
                          disabled={busy}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  {editingCommentId === c.id ? (
                    <div>
                      <textarea
                        value={commentDraft}
                        onChange={(e) => setCommentDraft(e.target.value)}
                        aria-label="Edit comment"
                        className="input text-sm"
                        rows={2}
                        autoFocus
                      />
                      <div className="flex justify-end gap-2 mt-1.5">
                        <button
                          onClick={() => setEditingCommentId(null)}
                          className="btn btn-secondary text-xs"
                          disabled={busy}
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => saveComment(c.id)}
                          className="btn btn-primary text-xs"
                          disabled={busy || !commentDraft.trim()}
                        >
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.content}</p>
                  )}
                </div>
              ))}
              {comments.length === 0 && <p className="text-sm text-gray-400">No comments yet.</p>}
            </div>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="input text-sm"
              rows={2}
              placeholder="Add a comment..."
              aria-label="Add a comment"
            />
            <div className="flex justify-end mt-2">
              <button onClick={addComment} className="btn btn-primary text-sm" disabled={busy || !draft.trim()}>
                Comment
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
