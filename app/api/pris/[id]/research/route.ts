import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { loadContactHistoryContext } from '@/lib/contacts/history-context'
import { requireMemberId } from '@/lib/actions/helpers'
import {
  isPriResearchEnabled,
  runPriResearch,
  type PriResearchInput,
} from '@/lib/pris/research'
import { INSTRUMENT_LABELS } from '@/app/(app)/pris/instruments'
import { loadAiOrgContext } from '@/lib/ai/org-context'

export const dynamic = 'force-dynamic'
// Web research runs minutes, not seconds (live runs have taken over five
// minutes), so keep generous headroom over the 5-minute mark.
export const maxDuration = 300 // Vercel Hobby's maximum; raise to 800 on Pro (see docs/setup.md)

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const STALE_RUNNING_MS = 15 * 60 * 1000

/** Latest research run for this PRI. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireMemberId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('pri_research')
    .select('*')
    .eq('pri_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return NextResponse.json({ enabled: isPriResearchEnabled(), research: data ?? null })
}

/** The executed instrument, if a PDF small enough to send is on file. */
async function loadInstrument(
  supabase: Awaited<ReturnType<typeof createClient>>,
  priId: string
): Promise<PriResearchInput['attachment']> {
  const { data: attachments } = await supabase
    .from('attachments')
    .select('storage_path, file_name, mime_type, size_bytes')
    .eq('entity_type', 'pri')
    .eq('entity_id', priId)
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

/** Kick off a research run and wait for it (the client fetch stays open). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let memberId: string
  try {
    memberId = await requireMemberId()
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isPriResearchEnabled()) {
    return NextResponse.json({ error: 'AI research is not configured' }, { status: 503 })
  }

  const { id } = await params
  const supabase = await createClient()

  const { data: pri } = await supabase.from('pris').select('*').eq('id', id).maybeSingle()
  if (!pri) return NextResponse.json({ error: 'PRI not found' }, { status: 404 })

  const [{ data: recipient }, { data: latest }] = await Promise.all([
    supabase.from('contacts').select('id, display_name').eq('id', pri.recipient_contact_id).maybeSingle(),
    // One run at a time: block if a recent run is still going, mark stale ones failed.
    supabase
      .from('pri_research')
      .select('id, status, created_at')
      .eq('pri_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])
  if (!recipient) return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
  if (latest?.status === 'running') {
    const ageMs = Date.now() - new Date(latest.created_at).getTime()
    if (ageMs < STALE_RUNNING_MS) {
      return NextResponse.json({ error: 'A research run is already in progress' }, { status: 409 })
    }
    await supabase
      .from('pri_research')
      .update({ status: 'failed', error: 'Run timed out' })
      .eq('id', latest.id)
  }

  const [crmContext, attachment, org] = await Promise.all([
    // What this database already knows about the recipient (affiliations,
    // prior grants/PRIs/contributions, team notes): feeds the relationship and
    // conflicts-of-interest questions. Best-effort; null means no context.
    loadContactHistoryContext(supabase, pri.recipient_contact_id, { priId: id }),
    loadInstrument(supabase, id),
    loadAiOrgContext(supabase),
  ])

  const { data: run, error: insertError } = await supabase
    .from('pri_research')
    .insert({ pri_id: id, status: 'running', requested_by: memberId })
    .select('id')
    .single()
  if (insertError || !run) {
    return NextResponse.json({ error: 'Could not start research run' }, { status: 500 })
  }

  const input: PriResearchInput = {
    recipientName: recipient.display_name,
    instrumentLabel: INSTRUMENT_LABELS[pri.instrument],
    amountDollars: (pri.amount_cents / 100).toLocaleString('en-US'),
    purpose: pri.purpose,
    notes: pri.notes,
    investmentDate: pri.investment_date,
    crmContext,
    attachment,
    org,
  }

  try {
    const result = await runPriResearch(input)
    const { data: updated } = await supabase
      .from('pri_research')
      .update({
        status: 'complete',
        draft: result.draft.answers,
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
      .from('pri_research')
      .update({ status: 'failed', error: message })
      .eq('id', run.id)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
