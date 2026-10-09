'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  requireMemberId,
  requireAdminId,
  requireGrantVoterId,
  requiredString,
  optionalString,
  ActionError,
  runAction,
} from './helpers'
import { getAuthState } from '@/lib/auth'
import { parseDollarsToCents } from '@/lib/utils/money'
import { orgToday } from '@/lib/settings'
import { loadProgramAreas, pickProgramAreaSlugs } from '@/lib/program-areas'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Database,
  DisbursementStatus,
  GranteeReportStatus,
  GranteeReportType,
  GrantOutStatus,
  ProposalDecision,
  ProposalMemo,
  ProposalOrigin,
  ProposalStatus,
  Vote,
} from '@/lib/supabase/types/database'
import { MEMO_SECTION_FIELDS, MEMO_HEADER_FIELDS, isMemoComplete } from '@/lib/grants/memo'
import { applyDisbursementPaid } from '@/lib/grants/disburse'

function parseOptionalCents(formData: FormData, key: string): number | null {
  const input = optionalString(formData, key)
  if (input === null) return null
  const cents = parseDollarsToCents(input)
  if (cents === null) throw new ActionError(`Invalid amount: ${key}`)
  return cents
}

// --- Proposals ---

type Supabase = Awaited<ReturnType<typeof createClient>>

// Any defined program area is accepted (the form offers active ones plus any
// inactive area the proposal already carries); unknown values are dropped.
async function programAreasFromForm(supabase: Supabase, formData: FormData): Promise<string[]> {
  const areas = await loadProgramAreas(supabase)
  return pickProgramAreaSlugs(areas, formData.getAll('program_areas'))
}

async function proposalFields(supabase: Supabase, formData: FormData) {
  const amountCents = parseOptionalCents(formData, 'amount_requested')
  if (amountCents === null) {
    throw new ActionError('Amount requested/suggested is required')
  }
  return {
    applicant_contact_id: requiredString(formData, 'applicant_contact_id'),
    title: requiredString(formData, 'title'),
    summary: optionalString(formData, 'summary'),
    program_areas: await programAreasFromForm(supabase, formData),
    amount_requested_cents: amountCents,
    received_date: optionalString(formData, 'received_date'),
    source: optionalString(formData, 'source'),
  }
}

/**
 * Insert payload for a brand-new proposal. Adds the create-only stamps
 * (entered_date, origin, and initial status) so the row is well-formed even
 * on backends that don't honor DB-level defaults (i.e. demo mode).
 *
 * Anything created inside the app is by definition team-initiated, so
 * origin is always 'internal': it skips review and starts directly in
 * 'diligence' — the person creating it is implicitly the review "yes".
 * External proposals only arrive via the public website form
 * (POST /api/public/grant-proposal), which stamps origin 'external' itself.
 */
async function newProposalFields(supabase: Supabase, formData: FormData) {
  return {
    ...(await proposalFields(supabase, formData)),
    entered_date: await orgToday(supabase),
    origin: 'internal' as ProposalOrigin,
    status: 'diligence' as ProposalStatus,
    votes_revealed: true,
  }
}

export async function createProposal(formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { data, error } = await supabase
      .from('grant_proposals')
      .insert(await newProposalFields(supabase, formData))
      .select('id')
      .single()

    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    redirect(`/grants-out/proposals/${data.id}`)
  })
}

const MAX_LETTER_BYTES = 10 * 1024 * 1024

/**
 * Same as createProposal but also attaches the uploaded proposal letter
 * to the new proposal. When the Claude extraction lands later it will
 * pre-fill the form fields from the same file before this action runs.
 */
export async function createProposalWithLetter(formData: FormData) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const file = formData.get('file')
    if (!(file instanceof File) || file.size === 0) {
      throw new ActionError('Please attach the proposal letter')
    }
    if (file.size > MAX_LETTER_BYTES) {
      throw new ActionError('File exceeds 10 MB limit')
    }

    const { data: proposal, error } = await supabase
      .from('grant_proposals')
      .insert(await newProposalFields(supabase, formData))
      .select('id')
      .single()
    if (error) throw new ActionError(error.message)

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const storagePath = `grant_proposal/${proposal.id}/${crypto.randomUUID()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, file, { contentType: file.type || undefined })
    if (uploadError) throw new ActionError(`Upload failed: ${uploadError.message}`)

    const { error: insertError } = await supabase.from('attachments').insert({
      entity_type: 'grant_proposal',
      entity_id: proposal.id,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: memberId,
    })
    if (insertError) {
      await supabase.storage.from('documents').remove([storagePath])
      throw new ActionError(`Failed to record attachment: ${insertError.message}`)
    }

    revalidatePath('/grants-out')
    redirect(`/grants-out/proposals/${proposal.id}`)
  })
}

export async function updateProposal(proposalId: string, formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('grant_proposals')
      .update(await proposalFields(supabase, formData))
      .eq('id', proposalId)

    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

export async function setProposalStatus(proposalId: string, status: ProposalStatus) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    // Pipeline transitions each have a dedicated action with its own guards;
    // this generic setter remains only for withdrawing.
    if (status !== 'withdrawn') {
      throw new ActionError('Use the dedicated pipeline actions to move a proposal')
    }

    const { error } = await supabase
      .from('grant_proposals')
      .update({ status })
      .eq('id', proposalId)

    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

// --- Pipeline transitions ---

async function loadProposalForTransition(
  supabase: Awaited<ReturnType<typeof createClient>>,
  proposalId: string
) {
  const { data: proposal, error } = await supabase
    .from('grant_proposals')
    .select('id, status, votes_revealed, applicant_contact_id')
    .eq('id', proposalId)
    .single()
  if (error || !proposal) throw new ActionError('Proposal not found')
  return proposal
}

/** received -> in_review: opens blind admin voting. */
export async function startReview(proposalId: string) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const proposal = await loadProposalForTransition(supabase, proposalId)
    if (proposal.status !== 'received') {
      throw new ActionError('Only new proposals can be moved into review')
    }

    const { error } = await supabase
      .from('grant_proposals')
      .update({ status: 'in_review' as ProposalStatus })
      .eq('id', proposalId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

/** in_review (votes revealed) -> diligence. */
export async function advanceToDiligence(proposalId: string) {
  return runAction(async () => {
    await requireGrantVoterId()
    const supabase = await createClient()

    const proposal = await loadProposalForTransition(supabase, proposalId)
    if (proposal.status !== 'in_review') {
      throw new ActionError('Only proposals in review can advance to diligence')
    }
    if (!proposal.votes_revealed) {
      throw new ActionError('Votes must be revealed before advancing to diligence')
    }
    if (!proposal.applicant_contact_id) {
      throw new ActionError('Link an applicant contact before advancing to diligence')
    }

    const { error } = await supabase
      .from('grant_proposals')
      .update({ status: 'diligence' as ProposalStatus })
      .eq('id', proposalId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

/**
 * Decline at the review gate (before diligence). Terminal state is the same
 * decided/declined as a post-diligence decline — declined_stage records where
 * it happened. No memo gate here; that gate belongs to recordDecision.
 */
export async function declineAtReview(proposalId: string, formData: FormData) {
  return runAction(async () => {
    await requireGrantVoterId()
    const supabase = await createClient()

    const proposal = await loadProposalForTransition(supabase, proposalId)
    if (proposal.status !== 'in_review') {
      throw new ActionError('Only proposals in review can be declined here')
    }
    if (!proposal.votes_revealed) {
      throw new ActionError('Votes must be revealed before declining')
    }

    const { error } = await supabase
      .from('grant_proposals')
      .update({
        status: 'decided' as ProposalStatus,
        decision: 'declined' as ProposalDecision,
        decision_date: await orgToday(supabase),
        decision_notes: optionalString(formData, 'decision_notes'),
        declined_stage: 'review',
      })
      .eq('id', proposalId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

/** Attach a contact to an external submission (from the triage panel). */
export async function linkApplicantContact(proposalId: string, formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('grant_proposals')
      .update({ applicant_contact_id: requiredString(formData, 'applicant_contact_id') })
      .eq('id', proposalId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

// --- Decline response email (draft generated via /api/proposals/[id]/decline-email) ---

export async function saveResponseEmailDraft(proposalId: string, formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { data: proposal } = await supabase
      .from('grant_proposals')
      .select('response_email_sent_at')
      .eq('id', proposalId)
      .single()
    if (!proposal) throw new ActionError('Proposal not found')
    if (proposal.response_email_sent_at) {
      throw new ActionError('The response email was already sent')
    }

    const { error } = await supabase
      .from('grant_proposals')
      .update({ draft_response_email: optionalString(formData, 'draft_response_email') })
      .eq('id', proposalId)
    if (error) throw new ActionError(error.message)

    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

export async function markResponseEmailSent(proposalId: string) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('grant_proposals')
      .update({ response_email_sent_at: new Date().toISOString() })
      .eq('id', proposalId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

// --- Reviews (the voting body votes; each writes only their own row, RLS enforces) ---

export async function submitReview(proposalId: string, formData: FormData) {
  return runAction(async () => {
    const memberId = await requireGrantVoterId()
    const supabase = await createClient()

    const { data: proposal } = await supabase
      .from('grant_proposals')
      .select('status, votes_revealed')
      .eq('id', proposalId)
      .single()
    if (!proposal) throw new ActionError('Proposal not found')
    if (proposal.status !== 'in_review') {
      throw new ActionError('Votes can only be submitted while a proposal is in review')
    }
    // Revealed votes are the record; the database rejects later changes too
    if (proposal.votes_revealed) {
      throw new ActionError('Votes on this proposal have been revealed, so reviews can no longer be changed')
    }

    const recused = formData.get('recused') === 'on'
    const scoreInput = optionalString(formData, 'score')
    const voteInput = optionalString(formData, 'vote') as Vote | null

    const { error } = await supabase.from('proposal_reviews').upsert(
      {
        proposal_id: proposalId,
        reviewer_id: memberId,
        score: recused ? null : scoreInput ? Number(scoreInput) : null,
        vote: recused ? null : voteInput,
        comments: optionalString(formData, 'comments'),
        recused,
      },
      { onConflict: 'proposal_id,reviewer_id' }
    )

    if (error) throw new ActionError(error.message)

    // The database reveals the votes once every voter has voted or recused
    // (trigger in migration 0009).

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

export async function addComment(proposalId: string, formData: FormData) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase.from('proposal_comments').insert({
      proposal_id: proposalId,
      author_id: memberId,
      body: requiredString(formData, 'body'),
    })

    if (error) throw new ActionError(error.message)

    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

// --- Grant memorandum (one per proposal, sections gate recordDecision) ---

function memoFields(formData: FormData): Partial<ProposalMemo> {
  const out: Partial<ProposalMemo> = {}
  for (const [key] of MEMO_SECTION_FIELDS) {
    out[key] = optionalString(formData, key)
  }
  for (const [key] of MEMO_HEADER_FIELDS) {
    out[key] = optionalString(formData, key)
  }
  return out
}

export async function startMemo(proposalId: string) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { data: existing } = await supabase
      .from('proposal_memos')
      .select('id')
      .eq('proposal_id', proposalId)
      .maybeSingle()

    if (existing) {
      revalidatePath(`/grants-out/proposals/${proposalId}`)
      return
    }

    const { error } = await supabase.from('proposal_memos').insert({
      proposal_id: proposalId,
      started_by: memberId,
      last_edited_by: memberId,
    })

    if (error) throw new ActionError(error.message)
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

/**
 * Save the memo. Autosaves pass `revalidate: false` — revalidating the
 * proposal page on every debounced save would force a full server re-render
 * of the route the user is typing on; the editor holds the canonical state
 * until Done, which calls revalidateProposal once.
 */
export async function updateMemo(
  proposalId: string,
  formData: FormData,
  opts: { revalidate?: boolean } = {}
) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { data: existing } = await supabase
      .from('proposal_memos')
      .select('id, started_by')
      .eq('proposal_id', proposalId)
      .maybeSingle()

    if (existing) {
      const { error } = await supabase
        .from('proposal_memos')
        .update({ ...memoFields(formData), last_edited_by: memberId })
        .eq('proposal_id', proposalId)
      if (error) throw new ActionError(error.message)
    } else {
      const { error } = await supabase.from('proposal_memos').insert({
        proposal_id: proposalId,
        ...memoFields(formData),
        started_by: memberId,
        last_edited_by: memberId,
      })
      if (error) throw new ActionError(error.message)
    }

    if (opts.revalidate !== false) revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

/** Refresh the proposal page once after an autosave editing session ends. */
export async function revalidateProposal(proposalId: string) {
  return runAction(async () => {
    await requireMemberId()
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

// --- Decision -> award ---

export async function recordDecision(proposalId: string, formData: FormData) {
  return runAction(async () => {
    await requireGrantVoterId()
    const { isAdmin } = await getAuthState()
    const supabase = await createClient()

    const decision = requiredString(formData, 'decision') as ProposalDecision
    const decisionNotes = optionalString(formData, 'decision_notes')

    const { data: proposal, error: loadError } = await supabase
      .from('grant_proposals')
      .select('*')
      .eq('id', proposalId)
      .single()

    if (loadError || !proposal) throw new ActionError('Proposal not found')

    // An approval whose award insert failed under an older version of this
    // action left the proposal decided+approved with no award. Let the admin
    // finish it: create the missing award without re-deciding.
    const { data: existingAward } = await supabase
      .from('grants_out')
      .select('id')
      .eq('proposal_id', proposalId)
      .maybeSingle()
    const approvedWithoutAward =
      proposal.status === 'decided' && proposal.decision === 'approved' && !existingAward

    if (proposal.status !== 'diligence' && !approvedWithoutAward) {
      throw new ActionError('Only proposals in diligence can be decided')
    }
    if (!proposal.applicant_contact_id) {
      throw new ActionError('Link an applicant contact before recording a decision')
    }
    if (approvedWithoutAward && decision !== 'approved') {
      throw new ActionError('This proposal was already approved; record the award amount to finish it')
    }
    if (approvedWithoutAward && !isAdmin) {
      throw new ActionError('This proposal is approved; an admin creates its award')
    }

    const { data: memo } = await supabase
      .from('proposal_memos')
      .select('*')
      .eq('proposal_id', proposalId)
      .maybeSingle()

    if (!isMemoComplete(memo)) {
      throw new ActionError(
        'Grant memorandum must be fully drafted (all 10 sections) before recording a decision'
      )
    }

    const today = await orgToday(supabase)

    // Approve: create the award first, then decide. If the award can't be
    // written nothing has changed and the admin can simply retry; if the
    // decision can't be written the new award is removed again. Awards move
    // money, so they're admin-only: when a non-admin reviewer approves (the
    // 'all_members' review mode) the decision is recorded and an admin
    // creates the award from the proposal page.
    let awardId: string | null = null
    if (decision === 'approved' && isAdmin) {
      const awardedCents =
        parseOptionalCents(formData, 'amount_awarded') ?? proposal.amount_requested_cents
      if (awardedCents === null) {
        throw new ActionError('Awarded amount is required to approve')
      }

      if (existingAward) {
        // Left over from a decision that failed half-way: reuse it.
        const { error: awardError } = await supabase
          .from('grants_out')
          .update({ amount_awarded_cents: awardedCents })
          .eq('id', existingAward.id)
        if (awardError) throw new ActionError(awardError.message)
        awardId = existingAward.id
      } else {
        const { data: award, error: awardError } = await supabase
          .from('grants_out')
          .insert({
            proposal_id: proposalId,
            grantee_contact_id: proposal.applicant_contact_id,
            purpose: proposal.title,
            amount_awarded_cents: awardedCents,
            award_date: today,
            status: 'awarded',
          })
          .select('id')
          .single()
        if (awardError || !award) {
          throw new ActionError(`Couldn't create the award: ${awardError?.message ?? 'no row returned'}`)
        }
        awardId = award.id
      }
    }

    if (!approvedWithoutAward) {
      const { data: decided, error } = await supabase
        .from('grant_proposals')
        .update({
          status: 'decided',
          decision,
          decision_date: today,
          decision_notes: decisionNotes,
          declined_stage: decision === 'declined' ? 'decision' : null,
        })
        .eq('id', proposalId)
        .eq('status', 'diligence')
        .select('id')

      if (error || !decided || decided.length === 0) {
        if (awardId && !existingAward) {
          await supabase.from('grants_out').delete().eq('id', awardId)
        }
        throw new ActionError(
          error?.message ?? 'This proposal was decided by someone else in the meantime. Refresh the page.'
        )
      }
    }

    if (awardId) {
      revalidatePath('/grants-out')
      redirect(`/grants-out/awards/${awardId}`)
    }

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

// --- Awards ---

export async function createAward(formData: FormData) {
  return runAction(async () => {
    await requireAdminId()
    const supabase = await createClient()

    const awardedCents = parseOptionalCents(formData, 'amount_awarded')
    if (awardedCents === null) throw new ActionError('Awarded amount is required')

    const { data, error } = await supabase
      .from('grants_out')
      .insert({
        grantee_contact_id: requiredString(formData, 'grantee_contact_id'),
        purpose: optionalString(formData, 'purpose'),
        amount_awarded_cents: awardedCents,
        award_date: optionalString(formData, 'award_date'),
        restriction: optionalString(formData, 'restriction'),
        agreement_signed_date: optionalString(formData, 'agreement_signed_date'),
        notes: optionalString(formData, 'notes'),
        status: 'awarded' as GrantOutStatus,
      })
      .select('id')
      .single()

    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    redirect(`/grants-out/awards/${data.id}`)
  })
}

export async function setAwardAgreementDate(awardId: string, formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('grants_out')
      .update({ agreement_signed_date: optionalString(formData, 'agreement_signed_date') })
      .eq('id', awardId)

    if (error) throw new ActionError(error.message)
    revalidatePath(`/grants-out/awards/${awardId}`)
  })
}

export async function setAwardStatus(awardId: string, status: GrantOutStatus) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase.from('grants_out').update({ status }).eq('id', awardId)
    if (error) throw new ActionError(error.message)

    revalidatePath('/grants-out')
    revalidatePath(`/grants-out/awards/${awardId}`)
  })
}

// --- Disbursements ---

export async function addDisbursement(awardId: string, formData: FormData) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const amountCents = parseOptionalCents(formData, 'amount')
    if (amountCents === null) throw new ActionError('Amount is required')

    const { error } = await supabase.from('disbursements').insert({
      grant_out_id: awardId,
      amount_cents: amountCents,
      scheduled_date: optionalString(formData, 'scheduled_date'),
      method: optionalString(formData, 'method') as 'check' | 'ach' | 'wire' | null,
      status: 'scheduled' as DisbursementStatus,
    })

    if (error) throw new ActionError(error.message)

    revalidatePath(`/grants-out/awards/${awardId}`)
  })
}

/**
 * Mark a disbursement paid and auto-create the matching expense row in the
 * "Grants paid" category so functional expense totals stay complete.
 */
export async function markDisbursementPaid(disbursementId: string) {
  return runAction(async () => {
    const memberId = await requireAdminId()
    const supabase = await createClient()

    const { grantOutId } = await applyDisbursementPaid(supabase, { disbursementId, memberId })

    revalidatePath(`/grants-out/awards/${grantOutId}`)
    revalidatePath('/expenses')
  })
}

export async function cancelDisbursement(disbursementId: string, awardId: string) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('disbursements')
      .update({ status: 'cancelled' })
      .eq('id', disbursementId)
      .eq('status', 'scheduled')

    if (error) throw new ActionError(error.message)
    revalidatePath(`/grants-out/awards/${awardId}`)
  })
}

// --- Grantee reports ---

const MAX_REPORT_FILE_BYTES = 10 * 1024 * 1024

/** Upload a grantee report document and write the matching attachments row. */
async function attachReportFile(
  supabase: SupabaseClient<Database>,
  memberId: string,
  reportId: string,
  file: File
): Promise<void> {
  if (file.size > MAX_REPORT_FILE_BYTES) {
    throw new ActionError('File exceeds 10 MB limit')
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `grantee_report/${reportId}/${crypto.randomUUID()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: file.type || undefined })
  if (uploadError) throw new ActionError(`Upload failed: ${uploadError.message}`)

  const { error: insertError } = await supabase.from('attachments').insert({
    entity_type: 'grantee_report',
    entity_id: reportId,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: memberId,
  })
  if (insertError) {
    await supabase.storage.from('documents').remove([storagePath])
    throw new ActionError(`Failed to record attachment: ${insertError.message}`)
  }
}

export async function addGranteeReport(awardId: string, formData: FormData) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { data: report, error } = await supabase
      .from('grantee_reports')
      .insert({
        grant_out_id: awardId,
        report_type: requiredString(formData, 'report_type') as GranteeReportType,
        due_date: requiredString(formData, 'due_date'),
        notes: optionalString(formData, 'notes'),
        status: 'upcoming' as GranteeReportStatus,
      })
      .select('id')
      .single()
    if (error || !report) throw new ActionError(error?.message ?? 'Could not create report')

    const file = formData.get('file')
    if (file instanceof File && file.size > 0) {
      await attachReportFile(supabase, memberId, report.id, file)
    }

    revalidatePath(`/grants-out/awards/${awardId}`)
  })
}

/**
 * Mark a report received, stamp the date, and optionally attach the document
 * the grantee sent in. Used in place of setGranteeReportStatus(...,'received')
 * so the file upload happens in the same call.
 */
export async function markReportReceived(
  reportId: string,
  awardId: string,
  formData: FormData
) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('grantee_reports')
      .update({
        status: 'received' as GranteeReportStatus,
        received_date: await orgToday(supabase),
      })
      .eq('id', reportId)
    if (error) throw new ActionError(error.message)

    const file = formData.get('file')
    if (file instanceof File && file.size > 0) {
      await attachReportFile(supabase, memberId, reportId, file)
    }

    revalidatePath(`/grants-out/awards/${awardId}`)
  })
}

export async function setGranteeReportStatus(
  reportId: string,
  awardId: string,
  status: GranteeReportStatus
) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { error } = await supabase
      .from('grantee_reports')
      .update({
        status,
        received_date: status === 'received' ? await orgToday(supabase) : null,
      })
      .eq('id', reportId)

    if (error) throw new ActionError(error.message)
    revalidatePath(`/grants-out/awards/${awardId}`)
  })
}

/**
 * Delete a grantee report along with any uploaded documents (storage files +
 * attachments rows). For "added by mistake" cleanup.
 */
export async function deleteGranteeReport(reportId: string, awardId: string) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { data: atts } = await supabase
      .from('attachments')
      .select('id, storage_path')
      .eq('entity_type', 'grantee_report')
      .eq('entity_id', reportId)

    if (atts && atts.length > 0) {
      await supabase.storage.from('documents').remove(atts.map((a) => a.storage_path))
      await supabase
        .from('attachments')
        .delete()
        .eq('entity_type', 'grantee_report')
        .eq('entity_id', reportId)
    }

    const { error } = await supabase.from('grantee_reports').delete().eq('id', reportId)
    if (error) throw new ActionError(error.message)

    revalidatePath(`/grants-out/awards/${awardId}`)
  })
}
