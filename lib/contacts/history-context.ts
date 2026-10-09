import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types/database'
import { formatCents } from '@/lib/utils/money'
import { fetchAll, fetchByKeys } from '@/lib/supabase/fetch-all'

// Plain-text summary of what this database already knows about a contact:
// affiliations, prior grants, PRIs and contributions, and recent notes. Fed
// to the AI research runs (grant proposals, PRIs) as context for the
// relationship and conflicts-of-interest questions.

type Client = SupabaseClient<Database>

const MAX_NOTES = 8
const MAX_NOTE_CHARS = 600

function plainText(html: string): string {
  return html
    .replace(/<(br|\/p|\/li|\/h[1-6])[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * Best-effort: returns null when nothing is on file (or on any read error),
 * so a research run never fails for want of context. `exclude` skips the
 * record the research is about.
 */
export async function loadContactHistoryContext(
  supabase: Client,
  contactId: string,
  exclude: { proposalId?: string; priId?: string } = {}
): Promise<string | null> {
  try {
    const [contactRes, affiliationsRes, proposalsRes, grantsRes, prisRes, contributions, links] =
      await Promise.all([
        supabase.from('contacts').select('display_name, kind, is_donor, is_funder, is_vendor').eq('id', contactId).maybeSingle(),
        supabase
          .from('affiliations')
          .select(
            'person_id, organization_id, relationship, title, person:contacts!person_id(display_name), organization:contacts!organization_id(display_name)'
          )
          .or(`person_id.eq.${contactId},organization_id.eq.${contactId}`),
        supabase
          .from('grant_proposals')
          .select('id, title, status, decision, decision_date, amount_requested_cents')
          .eq('applicant_contact_id', contactId),
        supabase
          .from('grants_out')
          .select('amount_awarded_cents, award_date, status, purpose')
          .eq('grantee_contact_id', contactId),
        supabase
          .from('pris')
          .select('id, instrument, amount_cents, investment_date, status')
          .eq('recipient_contact_id', contactId),
        // A long-time donor can pass max_rows; the count and total must be whole
        fetchAll<{ amount_cents: number | null; received_date: string }>(() =>
          supabase.from('contributions').select('id, amount_cents, received_date').eq('contact_id', contactId).order('id')
        ),
        fetchAll<{ note_id: string }>(() =>
          supabase
            .from('note_links')
            .select('id, note_id')
            .eq('entity_type', 'contact')
            .eq('entity_id', contactId)
            .order('id')
        ),
      ])

    const contact = contactRes.data as
      | { display_name: string; kind: string; is_donor: boolean; is_funder: boolean; is_vendor: boolean }
      | null
    if (!contact) return null
    const lines: string[] = []

    const roles = [
      contact.is_donor && 'donor',
      contact.is_funder && 'funder',
      contact.is_vendor && 'vendor',
    ].filter(Boolean)
    if (roles.length) lines.push(`Also recorded as a ${roles.join(', ')} of the organization.`)

    // Affiliations, named
    const affiliations = (affiliationsRes.data ?? []) as unknown as {
      person_id: string
      organization_id: string
      relationship: string
      title: string | null
      person: { display_name: string } | null
      organization: { display_name: string } | null
    }[]
    if (affiliations.length) {
      lines.push('Affiliations:')
      for (const a of affiliations) {
        const other = a.person_id === contactId ? a.organization : a.person
        const role = a.title || a.relationship.replace('_', ' ')
        lines.push(`- ${other?.display_name ?? 'Unknown'} (${role})`)
      }
    }

    const proposals = ((proposalsRes.data ?? []) as {
      id: string
      title: string
      status: string
      decision: string | null
      decision_date: string | null
      amount_requested_cents: number | null
    }[]).filter((p) => p.id !== exclude.proposalId)
    if (proposals.length) {
      lines.push('Other grant proposals from this contact:')
      for (const p of proposals) {
        const outcome = p.decision ? `${p.decision}${p.decision_date ? ` ${p.decision_date}` : ''}` : p.status
        lines.push(`- "${p.title}", requested ${formatCents(p.amount_requested_cents)}: ${outcome}`)
      }
    }

    const grants = (grantsRes.data ?? []) as {
      amount_awarded_cents: number
      award_date: string | null
      status: string
      purpose: string | null
    }[]
    if (grants.length) {
      lines.push('Grants awarded:')
      for (const g of grants) {
        lines.push(
          `- ${formatCents(g.amount_awarded_cents)}${g.award_date ? ` on ${g.award_date}` : ''} (${g.status})${g.purpose ? `: ${g.purpose}` : ''}`
        )
      }
    }

    const pris = ((prisRes.data ?? []) as {
      id: string
      instrument: string
      amount_cents: number
      investment_date: string | null
      status: string
    }[]).filter((p) => p.id !== exclude.priId)
    if (pris.length) {
      lines.push('Program-related investments:')
      for (const p of pris) {
        lines.push(
          `- ${formatCents(p.amount_cents)} ${p.instrument.replace('_', ' ')}${p.investment_date ? ` on ${p.investment_date}` : ''} (${p.status})`
        )
      }
    }

    if (contributions.length) {
      const total = contributions.reduce((sum, c) => sum + (c.amount_cents ?? 0), 0)
      const latest = contributions.map((c) => c.received_date).sort().at(-1)
      lines.push(
        `Contributions to the organization: ${contributions.length}, totaling ${formatCents(total)} (most recent ${latest}).`
      )
    }

    const noteIds = links.map((l) => l.note_id)
    if (noteIds.length) {
      // The newest few of each chunk of ids, then the newest few overall
      const chunks = await fetchByKeys<{ content: string; note_date: string }, string>(noteIds, (chunk) =>
        supabase
          .from('notes')
          .select('content, note_date')
          .in('id', chunk)
          .order('note_date', { ascending: false })
          .limit(MAX_NOTES)
      )
      const rows = chunks.sort((a, b) => b.note_date.localeCompare(a.note_date)).slice(0, MAX_NOTES)
      if (rows.length) {
        lines.push('Recent team notes:')
        for (const n of rows) lines.push(`- ${n.note_date}: ${truncate(plainText(n.content), MAX_NOTE_CHARS)}`)
      }
    }

    if (!lines.length) {
      return `${contact.display_name} has no prior history in the organization's records (no affiliations, grants, investments, contributions or notes).`
    }
    return [`What the organization's records show about ${contact.display_name}:`, ...lines].join('\n')
  } catch {
    return null
  }
}
