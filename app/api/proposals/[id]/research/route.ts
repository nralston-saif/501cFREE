import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadContactHistoryContext } from '@/lib/contacts/history-context'
import { requireMemberId } from '@/lib/actions/helpers'
import {
  isGrantResearchEnabled,
  runGrantResearch,
  type GrantResearchInput,
} from '@/lib/grants/research'
import { loadAiOrgContext } from '@/lib/ai/org-context'
import { loadProgramAreas, programAreaLabels } from '@/lib/program-areas'

export const dynamic = 'force-dynamic'
// Web research runs minutes, not seconds — keep generous headroom
// over the 5-minute mark (see the PRI research route).
export const maxDuration = 800

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const STALE_RUNNING_MS = 15 * 60 * 1000

/** The applicant's proposal letter, if a PDF small enough to send is on file. */
async function loadProposalLetter(
  supabase: Awaited<ReturnType<typeof createClient>>,
  proposalId: string
): Promise<GrantResearchInput['attachment']> {
  const { data: attachments } = await supabase
    .from('attachments')
    .select('storage_path, file_name, mime_type, size_bytes')
    .eq('entity_type', 'grant_proposal')
    .eq('entity_id', proposalId)
    .order('created_at', { ascending: false })
  const pdf = (attachments ?? []).find(
    (a) =>
      (a.mime_type === 'application/pdf' || a.file_name.toLowerCase().endsWith('.pdf')) &&
      (a.size_bytes ?? 0) <= MAX_ATTACHMENT_BYTES
  )
  if (!pdf) return null
  const { data: file } = await supabase.storage.from('documents').download(pdf.storage_path)
  if (!file) return null
  return { base64Pdf: Buffer.from(await file.arrayBuffer()).toString('base64'), fileName: pdf.file_name }
}

/** Latest research run for this proposal. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireMemberId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('grant_research')
    .select('*')
    .eq('proposal_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return NextResponse.json({ enabled: isGrantResearchEnabled(), research: data ?? null })
}

/** Kick off a research run and wait for it (the client fetch stays open). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let memberId: string
  try {
    memberId = await requireMemberId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isGrantResearchEnabled()) {
    return NextResponse.json({ error: 'AI research is not configured' }, { status: 503 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: proposal } = await supabase
    .from('grant_proposals')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!proposal) return NextResponse.json({ error: 'Proposal not found' }, { status: 404 })
  if (!proposal.applicant_contact_id) {
    // External submissions have no contact until triage links one; research
    // belongs to diligence, which requires the link.
    return NextResponse.json(
      { error: 'Link an applicant contact before running research' },
      { status: 409 }
    )
  }

  const [{ data: applicant }, { data: latest }] = await Promise.all([
    supabase.from('contacts').select('id, display_name').eq('id', proposal.applicant_contact_id).maybeSingle(),
    // One run at a time: block if a recent run is still going, mark stale ones failed.
    supabase
      .from('grant_research')
      .select('id, status, created_at')
      .eq('proposal_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (!applicant) return NextResponse.json({ error: 'Applicant not found' }, { status: 404 })
  if (latest?.status === 'running') {
    const ageMs = Date.now() - new Date(latest.created_at).getTime()
    if (ageMs < STALE_RUNNING_MS) {
      return NextResponse.json({ error: 'A research run is already in progress' }, { status: 409 })
    }
    await supabase
      .from('grant_research')
      .update({ status: 'failed', error: 'Run timed out' })
      .eq('id', latest.id)
  }

  const [crmContext, attachment, org, programAreas] = await Promise.all([
    // What this database already knows about the applicant (affiliations,
    // prior grants/PRIs/contributions, team notes): feeds the relationship and
    // conflicts-of-interest questions. Best-effort; null means no context.
    loadContactHistoryContext(supabase, proposal.applicant_contact_id, { proposalId: id }),
    loadProposalLetter(supabase, id),
    loadAiOrgContext(supabase),
    loadProgramAreas(supabase),
  ])

  const { data: run, error: insertError } = await supabase
    .from('grant_research')
    .insert({ proposal_id: id, status: 'running', requested_by: memberId })
    .select('id')
    .single()
  if (insertError || !run) {
    return NextResponse.json({ error: 'Could not start research run' }, { status: 500 })
  }

  const input: GrantResearchInput = {
    applicantName: applicant.display_name,
    title: proposal.title,
    summary: proposal.summary,
    programAreaLabels: programAreaLabels(programAreas, proposal.program_areas),
    amountDollars:
      proposal.amount_requested_cents != null
        ? (proposal.amount_requested_cents / 100).toLocaleString('en-US')
        : 'not specified',
    receivedDate: proposal.received_date,
    source: proposal.source,
    crmContext,
    attachment,
    org,
  }

  try {
    const result = await runGrantResearch(input)
    const { data: updated } = await supabase
      .from('grant_research')
      .update({
        status: 'complete',
        draft: { ...result.draft.answers, ...result.draft.header },
        sources: result.draft.sources,
        open_questions: result.draft.open_questions,
        model: result.model,
      })
      .eq('id', run.id)
      .select('*')
      .single()
    return NextResponse.json({ research: updated })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Research failed'
    await supabase
      .from('grant_research')
      .update({ status: 'failed', error: message })
      .eq('id', run.id)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
