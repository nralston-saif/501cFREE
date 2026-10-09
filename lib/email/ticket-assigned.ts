import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, TicketPriority } from '@/lib/supabase/types/database'
import { getResend } from '@/lib/email/resend'
import { getOrgSettings, orgName } from '@/lib/settings'
import { APP_NAME } from '@/lib/branding'
import { BASE_PATH } from '@/lib/basePath'

// Best-effort "you were assigned a ticket" email. Skips silently when email
// isn't configured (no RESEND_API_KEY or no from-address in settings), when
// the assignee assigned themselves, or when they have no email; never throws,
// so a mail problem can't fail the ticket write that triggered it.

export async function sendTicketAssignedEmail(
  supabase: SupabaseClient<Database>,
  opts: {
    ticketTitle: string
    priority: TicketPriority
    dueDate: string | null
    assigneeId: string
    actorId: string
    actorName: string | null
  }
): Promise<void> {
  if (!process.env.RESEND_API_KEY || opts.assigneeId === opts.actorId) return

  try {
    const [settings, { data: assignee }] = await Promise.all([
      getOrgSettings(supabase),
      supabase.from('team_members').select('email, full_name').eq('id', opts.assigneeId).maybeSingle(),
    ])
    if (!settings.letter_from_email || !assignee?.email) return

    const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
    const lines = [
      `Hi ${assignee.full_name},`,
      '',
      `${opts.actorName || 'A teammate'} assigned you a ticket:`,
      '',
      opts.ticketTitle,
      `Priority: ${opts.priority}`,
      ...(opts.dueDate ? [`Due: ${opts.dueDate}`] : []),
      ...(site ? ['', `${site}${BASE_PATH}/tickets`] : []),
    ]

    const { error } = await getResend().emails.send({
      from: `${orgName(settings)} ${APP_NAME} <${settings.letter_from_email}>`,
      to: assignee.email,
      subject: `Ticket assigned to you: ${opts.ticketTitle}`,
      text: lines.join('\n'),
    })
    if (error) console.error('Ticket assignment email failed:', error.message)
  } catch (err) {
    console.error('Ticket assignment email failed:', err)
  }
}
