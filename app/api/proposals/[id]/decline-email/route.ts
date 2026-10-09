import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireMemberId } from '@/lib/actions/helpers'
import {
  generateDeclineEmail,
  isDeclineEmailEnabled,
  type DeclineEmailInput,
} from '@/lib/grants/decline-email'
import { loadAiOrgContext } from '@/lib/ai/org-context'
import { loadProgramAreas, programAreaLabels } from '@/lib/program-areas'

// Drafts the response email for a declined proposal and persists it to
// grant_proposals.draft_response_email. Re-POSTing regenerates (overwrites
// the draft) until the email is marked sent. A route rather than a server
// action because the model call runs long.
export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireMemberId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isDeclineEmailEnabled()) {
    return NextResponse.json({ error: 'AI drafting is not configured' }, { status: 503 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: proposal } = await supabase
    .from('grant_proposals')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  if (proposal.decision !== 'declined') {
    return NextResponse.json(
      { error: 'Response emails are drafted for declined proposals only' },
      { status: 409 }
    )
  }
  if (proposal.response_email_sent_at) {
    return NextResponse.json(
      { error: 'The response email was already sent' },
      { status: 409 }
    )
  }

  const [{ data: contact }, { data: reviews }, org, programAreas] = await Promise.all([
    proposal.applicant_contact_id
      ? supabase.from('contacts').select('kind, display_name').eq('id', proposal.applicant_contact_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('proposal_reviews').select('comments').eq('proposal_id', id),
    loadAiOrgContext(supabase),
    loadProgramAreas(supabase),
  ])

  // Applicant name: linked contact wins, raw submission fields otherwise.
  let applicantName = proposal.applicant_name
  let organizationName = proposal.organization_name
  if (contact) {
    applicantName = contact.display_name
    if (contact.kind === 'organization') organizationName = contact.display_name
  }

  const input: DeclineEmailInput = {
    applicantName: applicantName ?? 'the applicant',
    organizationName,
    title: proposal.title,
    summary: proposal.summary,
    programAreaLabels: programAreaLabels(programAreas, proposal.program_areas),
    amountDollars:
      proposal.amount_requested_cents != null
        ? (proposal.amount_requested_cents / 100).toLocaleString('en-US')
        : null,
    declinedStage: proposal.declined_stage ?? 'decision',
    decisionNotes: proposal.decision_notes,
    reviewerComments: (reviews ?? [])
      .map((r) => r.comments)
      .filter((c): c is string => typeof c === 'string' && c.trim() !== ''),
  }

  try {
    const result = await generateDeclineEmail(input, org)
    const { error } = await supabase
      .from('grant_proposals')
      .update({ draft_response_email: result.email })
      .eq('id', id)
    if (error) {
      return NextResponse.json({ error: 'Could not save the draft' }, { status: 500 })
    }
    return NextResponse.json({ draft: result.email, model: result.model })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Drafting failed'
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
