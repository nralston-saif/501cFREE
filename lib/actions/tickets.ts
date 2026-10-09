'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import { escapeLike } from '@/lib/contacts/lookup'
import { sendTicketAssignedEmail } from '@/lib/email/ticket-assigned'
import { ActionError, requireMemberId, actionErrorMessage } from './helpers'
import type {
  ContactKind,
  Database,
  Tag,
  TicketPriority,
  TicketStatus,
} from '@/lib/supabase/types/database'

// The team's task list. Writes go through these actions (the browser client
// has no table access in demo mode); the tickets page reads on the server and
// client components call router.refresh() after a write. Errors are returned,
// not thrown, so modals can show them in place.

type Client = SupabaseClient<Database>
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export type TicketContactOption = { id: string; display_name: string; kind: ContactKind }

export type TicketCommentView = {
  id: string
  content: string
  created_at: string
  author_id: string
  is_resolution: boolean
  author: { id: string; full_name: string } | null
}

export type TicketInput = {
  title: string
  description?: string | null
  status?: TicketStatus
  priority?: TicketPriority
  due_date?: string | null
  assigned_to?: string | null
  contact_id?: string | null
  tags?: string[]
}

export type TicketPatch = Partial<TicketInput & { is_flagged: boolean }>

const STATUSES: readonly TicketStatus[] = ['open', 'in_progress', 'review', 'closed']
const PRIORITIES: readonly TicketPriority[] = ['high', 'medium', 'low']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function fail(err: unknown, fallback: string): { ok: false; error: string } {
  return { ok: false, error: actionErrorMessage(err, fallback) }
}

function cleanTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))]
}

/** Validate and normalize the editable fields present in `input`. */
function ticketFields(input: TicketPatch) {
  const out: Database['public']['Tables']['tickets']['Update'] = {}
  if (input.title !== undefined) {
    const title = input.title.trim()
    if (!title) throw new ActionError('Title is required')
    out.title = title
  }
  if (input.description !== undefined) out.description = input.description?.trim() || null
  if (input.status !== undefined) {
    if (!STATUSES.includes(input.status)) throw new ActionError('Invalid status')
    out.status = input.status
  }
  if (input.priority !== undefined) {
    if (!PRIORITIES.includes(input.priority)) throw new ActionError('Invalid priority')
    out.priority = input.priority
  }
  if (input.due_date !== undefined) {
    if (input.due_date && !DATE_RE.test(input.due_date)) throw new ActionError('Invalid due date')
    out.due_date = input.due_date || null
  }
  if (input.assigned_to !== undefined) out.assigned_to = input.assigned_to || null
  if (input.contact_id !== undefined) out.contact_id = input.contact_id || null
  if (input.tags !== undefined) out.tags = cleanTags(input.tags)
  if (input.is_flagged !== undefined) out.is_flagged = input.is_flagged
  return out
}

/** Count each newly applied tag once toward its usage (orders the picker). */
async function bumpTagUsage(supabase: Client, added: string[]) {
  if (added.length === 0) return
  const { data } = await supabase.from('tags').select('id, usage_count').in('name', added)
  await Promise.all(
    (data ?? []).map((t) => supabase.from('tags').update({ usage_count: t.usage_count + 1 }).eq('id', t.id))
  )
}

export async function createTicket(input: TicketInput): Promise<Result<{ id: string }>> {
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()
    const fields = ticketFields(input)

    const { data, error } = await supabase
      .from('tickets')
      .insert({ ...fields, title: fields.title!, created_by: memberId })
      .select('id')
      .single()
    if (error) throw new ActionError(error.message)

    await bumpTagUsage(supabase, fields.tags ?? [])
    if (fields.assigned_to) {
      await sendTicketAssignedEmail(supabase, {
        ticketTitle: fields.title!,
        priority: fields.priority ?? 'medium',
        dueDate: fields.due_date ?? null,
        assigneeId: fields.assigned_to,
        actorId: memberId,
        actorName: (await getAuthState()).memberName,
      })
    }

    revalidatePath('/tickets')
    return { ok: true, id: data.id }
  } catch (err) {
    return fail(err, 'Could not create ticket')
  }
}

export async function updateTicket(ticketId: string, patch: TicketPatch): Promise<Result> {
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()
    const fields = ticketFields(patch)

    const { data: before, error: readError } = await supabase
      .from('tickets')
      .select('title, priority, due_date, assigned_to, tags')
      .eq('id', ticketId)
      .single()
    if (readError || !before) throw new ActionError('Ticket not found')

    const { error } = await supabase.from('tickets').update(fields).eq('id', ticketId)
    if (error) throw new ActionError(error.message)

    if (fields.tags) await bumpTagUsage(supabase, fields.tags.filter((t) => !before.tags.includes(t)))
    if (fields.assigned_to && fields.assigned_to !== before.assigned_to) {
      await sendTicketAssignedEmail(supabase, {
        ticketTitle: fields.title ?? before.title,
        priority: fields.priority ?? before.priority,
        dueDate: fields.due_date !== undefined ? fields.due_date : before.due_date,
        assigneeId: fields.assigned_to,
        actorId: memberId,
        actorName: (await getAuthState()).memberName,
      })
    }

    revalidatePath('/tickets')
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not update ticket')
  }
}

/**
 * Close a ticket, recording an optional resolution comment first. closed_at
 * is set by the database trigger.
 */
export async function closeTicket(ticketId: string, resolution?: string): Promise<Result> {
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const content = resolution?.trim()
    if (content) {
      const { error } = await supabase
        .from('ticket_comments')
        .insert({ ticket_id: ticketId, author_id: memberId, content, is_resolution: true })
      if (error) throw new ActionError(error.message)
    }

    const { error } = await supabase.from('tickets').update({ status: 'closed' }).eq('id', ticketId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/tickets')
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not close ticket')
  }
}

/** Delete a ticket and its comments. Only its creator or an admin may. */
export async function deleteTicket(ticketId: string): Promise<Result> {
  try {
    const memberId = await requireMemberId()
    const { isAdmin } = await getAuthState()
    const supabase = await createClient()

    const { data: ticket } = await supabase.from('tickets').select('created_by').eq('id', ticketId).maybeSingle()
    if (!ticket) throw new ActionError('Ticket not found')
    if (!isAdmin && ticket.created_by !== memberId) {
      throw new ActionError('Only the ticket creator or an admin can delete it')
    }

    const { error } = await supabase.from('tickets').delete().eq('id', ticketId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/tickets')
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not delete ticket')
  }
}

// Comments ------------------------------------------------------------------

export async function listTicketComments(ticketId: string): Promise<Result<{ comments: TicketCommentView[] }>> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('ticket_comments')
      .select(
        'id, content, created_at, author_id, is_resolution, author:team_members!author_id(id, full_name)'
      )
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true })
    if (error) throw new ActionError(error.message)
    return { ok: true, comments: (data ?? []) as unknown as TicketCommentView[] }
  } catch (err) {
    return fail(err, 'Could not load comments')
  }
}

export async function addTicketComment(ticketId: string, content: string): Promise<Result> {
  try {
    const memberId = await requireMemberId()
    const text = content.trim()
    if (!text) throw new ActionError('Comment is empty')
    const supabase = await createClient()
    const { error } = await supabase
      .from('ticket_comments')
      .insert({ ticket_id: ticketId, author_id: memberId, content: text })
    if (error) throw new ActionError(error.message)
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not add comment')
  }
}

// RLS limits comment edits and deletes to the author; the explicit author_id
// filter makes a non-author's attempt report an error instead of a silent no-op.

export async function updateTicketComment(commentId: string, content: string): Promise<Result> {
  try {
    const memberId = await requireMemberId()
    const text = content.trim()
    if (!text) throw new ActionError('Comment is empty')
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('ticket_comments')
      .update({ content: text })
      .eq('id', commentId)
      .eq('author_id', memberId)
      .select('id')
    if (error) throw new ActionError(error.message)
    if (!data?.length) throw new ActionError('You can only edit your own comments')
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not update comment')
  }
}

export async function deleteTicketComment(commentId: string): Promise<Result> {
  try {
    const memberId = await requireMemberId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('ticket_comments')
      .delete()
      .eq('id', commentId)
      .eq('author_id', memberId)
      .select('id')
    if (error) throw new ActionError(error.message)
    if (!data?.length) throw new ActionError('You can only delete your own comments')
    return { ok: true }
  } catch (err) {
    return fail(err, 'Could not delete comment')
  }
}

// Tags ----------------------------------------------------------------------

export async function listTags(): Promise<Result<{ tags: Pick<Tag, 'id' | 'name' | 'color'>[] }>> {
  try {
    await requireMemberId()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('tags')
      .select('id, name, color')
      .order('usage_count', { ascending: false })
      .order('name', { ascending: true })
    if (error) throw new ActionError(error.message)
    return { ok: true, tags: data ?? [] }
  } catch (err) {
    return fail(err, 'Could not load tags')
  }
}

/** Create a tag (lower-cased), or return the existing one with that name. */
export async function createTag(name: string): Promise<Result<{ tag: Pick<Tag, 'id' | 'name' | 'color'> }>> {
  try {
    const memberId = await requireMemberId()
    const tagName = name.trim().toLowerCase()
    if (!tagName) throw new ActionError('Tag name is required')
    const supabase = await createClient()

    const { data: existing } = await supabase.from('tags').select('id, name, color').eq('name', tagName).maybeSingle()
    if (existing) return { ok: true, tag: existing }

    const { data, error } = await supabase
      .from('tags')
      .insert({ name: tagName, created_by: memberId })
      .select('id, name, color')
      .single()
    if (error) throw new ActionError(error.message)
    return { ok: true, tag: data }
  } catch (err) {
    return fail(err, 'Could not create tag')
  }
}

// Contact picker ------------------------------------------------------------

export async function searchTicketContacts(query: string): Promise<Result<{ contacts: TicketContactOption[] }>> {
  try {
    await requireMemberId()
    const q = query.trim()
    if (q.length < 2) return { ok: true, contacts: [] }
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('contacts')
      .select('id, display_name, kind')
      .ilike('display_name', `%${escapeLike(q)}%`)
      .order('display_name')
      .limit(15)
    if (error) throw new ActionError(error.message)
    return { ok: true, contacts: (data ?? []) as TicketContactOption[] }
  } catch (err) {
    return fail(err, 'Could not search contacts')
  }
}
