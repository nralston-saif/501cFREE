import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { GrantProposal } from '@/lib/supabase/types/database'
import { loadContactOptions } from '@/lib/contacts/options'
import { getAuthState } from '@/lib/auth'
import {
  addComment,
  linkApplicantContact,
  setProposalStatus,
  startReview,
} from '@/lib/actions/grants-out'
import { isMemoComplete, memoAnsweredCount, MEMO_SECTION_FIELDS } from '@/lib/grants/memo'
import { loadWeighedIn } from '@/lib/grants/review-progress'
import { isVotingMember, votingBodyPhrase } from '@/lib/grants/voting'
import { getOrgSettings } from '@/lib/settings'
import { isDeclineEmailEnabled } from '@/lib/grants/decline-email'
import { isScriptedAi } from '@/lib/ai/demo'
import { loadAiOrgContext } from '@/lib/ai/org-context'
import { demoAmountDollars, toDemoOrg } from '@/lib/ai/demo-scripts'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import SubmitButton from '@/components/SubmitButton'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import ContactNotes from '@/components/ContactNotes'
import ApplicantSelect from '@/components/ApplicantSelect'
import { formatCents, centsToDollarString } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import { loadProgramAreas, programAreaLabel, programAreaLabels } from '@/lib/program-areas'
import MyReviewForm from './MyReviewForm'
import DecisionForm from './DecisionForm'
import MemoCard from './MemoCard'
import MemoResearchPanel from './MemoResearchPanel'
import MemorandumPanel from './MemorandumPanel'
import AdvanceDeclinePanel from './AdvanceDeclinePanel'
import ResponseEmailPanel from './ResponseEmailPanel'
import GrantTabs from '@/components/GrantTabs'
import ActionForm from '@/components/ActionForm'

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDate(iso.slice(0, 10))
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-gray-900 mt-0.5">{value}</dd>
    </div>
  )
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  // Demo mode without a key: the AI panels build pre-written samples in the
  // browser from these facts (lib/ai/demo.ts)
  const demoAi = isScriptedAi()

  // Everything keyed by the proposal id loads in one wave with the proposal
  // itself; the applicant comes embedded. Only the contact picker (for an
  // unlinked applicant) and nothing else waits on the proposal row.
  const proposalP = supabase
    .from('grant_proposals')
    .select('*, applicant:contacts!applicant_contact_id(id, display_name, kind)')
    .eq('id', id)
    .maybeSingle()
    .then(({ data }) => data as unknown as (GrantProposal & { applicant: { id: string; display_name: string; kind: 'person' | 'organization' } | null }) | null)

  const [
    proposalRow,
    { data: members },
    { data: reviews },
    { data: comments },
    { data: attachments },
    { data: award },
    { data: memo },
    authState,
    { data: research },
    { data: memoPdf },
    allContacts,
    programAreas,
    { grant_review_mode: reviewMode },
    weighedInByProposal,
    demoOrg,
  ] = await Promise.all([
    proposalP,
    supabase
      .from('team_members')
      .select('id, full_name, role')
      .eq('is_active', true)
      .order('full_name'),
    supabase.from('proposal_reviews').select('*').eq('proposal_id', id),
    supabase
      .from('proposal_comments')
      .select('*')
      .eq('proposal_id', id)
      .order('created_at', { ascending: true }),
    supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'grant_proposal')
      .eq('entity_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('grants_out').select('id').eq('proposal_id', id).maybeSingle(),
    supabase.from('proposal_memos').select('*').eq('proposal_id', id).maybeSingle(),
    // Cached per request — shares the layout's auth + member lookup
    getAuthState(),
    supabase
      .from('grant_research')
      .select('*')
      .eq('proposal_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('grant_memo_pdfs').select('*').eq('proposal_id', id).maybeSingle(),
    proposalP.then((p) => (p && !p.applicant_contact_id ? loadContactOptions(supabase) : null)),
    loadProgramAreas(supabase),
    getOrgSettings(supabase),
    // Who has weighed in (never how); only shown while votes are blind
    loadWeighedIn(supabase, [id]),
    demoAi ? loadAiOrgContext(supabase).then(toDemoOrg) : null,
  ])

  if (!proposalRow) notFound()
  const { applicant, ...proposal } = proposalRow
  const needsContact = !proposal.applicant_contact_id

  const currentMemberId = authState.memberId

  const memberNames = new Map((members ?? []).map((m) => [m.id, m.full_name]))
  // The voting body (org_settings.grant_review_mode): every active member, or active admins
  const voters = (members ?? []).filter((m) => isVotingMember(m, reviewMode))
  const isVoter = Boolean(
    authState.memberRole && isVotingMember({ role: authState.memberRole }, reviewMode)
  )
  const votersPhrase = votingBodyPhrase(reviewMode)
  const reviewsByMember = new Map((reviews ?? []).map((r) => [r.reviewer_id, r]))
  const myReview = currentMemberId ? (reviewsByMember.get(currentMemberId) ?? null) : null

  // Stage flags. Blind voting: while in_review with votes unrevealed, a
  // viewer sees only their own review plus who has submitted — never the
  // votes themselves.
  const inReview = proposal.status === 'in_review'
  const blind = inReview && !proposal.votes_revealed
  // While blind, the database only returns your own review; who else has
  // weighed in comes from proposal_review_progress()
  const weighedIn = blind ? (weighedInByProposal.get(proposal.id) ?? new Set<string>()) : null
  const isOpen =
    proposal.status === 'received' || inReview || proposal.status === 'diligence'
  // Memo/research belong to diligence; keep them visible afterwards as the
  // permanent record whenever a memo was actually started.
  const showMemoPanels = proposal.status === 'diligence' || memo != null
  const showReviewsCard = inReview || (reviews ?? []).length > 0
  const memoComplete = isMemoComplete(memo)
  const memoAnswered = memoAnsweredCount(memo)
  const memoTotal = MEMO_SECTION_FIELDS.length

  const applicantDisplay =
    applicant?.display_name ??
    proposal.organization_name ??
    proposal.applicant_name ??
    undefined

  // Same facts the research and decline-email routes send to Claude
  const demoResearchInput = demoOrg
    ? {
        applicantName: applicantDisplay ?? 'the applicant',
        title: proposal.title,
        summary: proposal.summary,
        programAreaLabels: programAreaLabels(programAreas, proposal.program_areas),
        amountDollars: demoAmountDollars(proposal.amount_requested_cents),
        org: demoOrg,
      }
    : null
  const demoDeclineInput = demoOrg
    ? {
        input: {
          applicantName: applicant?.display_name ?? proposal.applicant_name ?? 'the applicant',
          organizationName:
            applicant?.kind === 'organization' ? applicant.display_name : proposal.organization_name,
          title: proposal.title,
          declinedStage: proposal.declined_stage ?? ('decision' as const),
        },
        org: demoOrg,
      }
    : null

  return (
    <div>
      <PageHeader title={proposal.title} description={applicantDisplay} />

      <GrantTabs
        proposalId={proposal.id}
        awardId={award?.id ?? null}
        active="proposal"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Proposal details */}
          <div className="card p-5">
            <h3 className="font-medium text-gray-900 mb-4">Proposal details</h3>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DetailRow
                label="Applicant"
                value={
                  applicant ? (
                    <Link href={`/contacts/${applicant.id}`} className="hover:underline">
                      {applicant.display_name}
                    </Link>
                  ) : (
                    (applicantDisplay ?? '—')
                  )
                }
              />
              <DetailRow
                label="Amount Requested/Suggested"
                value={
                  <span className="tabular-nums">{formatCents(proposal.amount_requested_cents)}</span>
                }
              />
              <DetailRow
                label="Program areas"
                value={
                  proposal.program_areas.length === 0 ? (
                    '—'
                  ) : (
                    <span className="flex flex-wrap gap-1.5">
                      {proposal.program_areas.map((slug) => (
                        <span
                          key={slug}
                          className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-700"
                        >
                          {programAreaLabel(programAreas, slug)}
                        </span>
                      ))}
                    </span>
                  )
                }
              />
              <DetailRow
                label="Origin"
                value={proposal.origin === 'external' ? 'External' : 'Internal'}
              />
              <DetailRow label="Received" value={formatDate(proposal.received_date)} />
              <DetailRow label="Entered" value={formatDate(proposal.entered_date)} />
              <DetailRow label="Source" value={proposal.source ?? '—'} />
            </dl>
            {proposal.summary && (
              <div className="mt-4">
                <dt className="text-xs text-gray-500 uppercase tracking-wide">Summary</dt>
                <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{proposal.summary}</p>
              </div>
            )}
          </div>

          {/* External submission details */}
          {proposal.origin === 'external' &&
            (proposal.applicant_name || proposal.applicant_email) && (
              <div className="card p-5">
                <h3 className="font-medium text-gray-900 mb-4">Submitted via website</h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <DetailRow label="Name" value={proposal.applicant_name ?? '—'} />
                  <DetailRow
                    label="Email"
                    value={
                      proposal.applicant_email ? (
                        <a
                          href={`mailto:${proposal.applicant_email}`}
                          className="hover:underline"
                        >
                          {proposal.applicant_email}
                        </a>
                      ) : (
                        '—'
                      )
                    }
                  />
                  <DetailRow label="Organization" value={proposal.organization_name ?? '—'} />
                </dl>
              </div>
            )}

          {/* Declined: response email */}
          {proposal.decision === 'declined' && (
            <ResponseEmailPanel
              proposalId={proposal.id}
              draft={proposal.draft_response_email}
              sentAt={proposal.response_email_sent_at}
              aiEnabled={isDeclineEmailEnabled() || demoAi}
              demo={demoDeclineInput}
            />
          )}

          {/* Diligence: memo, research, memorandum PDF */}
          {showMemoPanels && (
            <>
              <MemoResearchPanel
                proposalId={proposal.id}
                research={research}
                applicantName={applicantDisplay ?? 'the applicant'}
                demoInput={demoResearchInput}
              />

              <MemoCard
                proposalId={proposal.id}
                memo={memo}
                startedByName={memo?.started_by ? (memberNames.get(memo.started_by) ?? null) : null}
                lastEditedByName={
                  memo?.last_edited_by ? (memberNames.get(memo.last_edited_by) ?? null) : null
                }
                draft={
                  research?.status === 'complete' && research.draft
                    ? (research.draft as Record<string, string>)
                    : null
                }
              />

              <MemorandumPanel
                proposalId={proposal.id}
                memoPdf={memoPdf}
                memoComplete={memoComplete}
                generatedByName={
                  memoPdf?.generated_by ? (memberNames.get(memoPdf.generated_by) ?? null) : null
                }
              />
            </>
          )}

          {/* Discussion */}
          <div className="card p-5">
            <h3 className="font-medium text-gray-900 mb-3">Discussion</h3>
            {(comments ?? []).length === 0 ? (
              <p className="text-sm text-gray-400 mb-4">No comments yet.</p>
            ) : (
              <ul className="space-y-4 mb-4">
                {(comments ?? []).map((comment) => (
                  <li key={comment.id}>
                    <div className="flex items-baseline gap-2">
                      <span className="text-sm font-medium text-gray-900">
                        {memberNames.get(comment.author_id) ?? 'Unknown'}
                      </span>
                      <span className="text-xs text-gray-400">
                        {relativeTime(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap">
                      {comment.body}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <ActionForm action={addComment.bind(null, proposal.id)} className="space-y-2">
              <textarea
                name="body"
                rows={2}
                required
                placeholder="Add a comment…"
                aria-label="Comment"
                className="input"
              />
              <SubmitButton pendingLabel="Posting…" className="btn btn-secondary">
                Post comment
              </SubmitButton>
            </ActionForm>
          </div>

          <AttachmentsPanel
            entityType="grant_proposal"
            entityId={proposal.id}
            attachments={attachments ?? []}
            revalidatePath={`/grants-out/proposals/${proposal.id}`}
          />

          <ContactNotes entityType="grant_proposal" entityId={proposal.id} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Status */}
          <div className="card p-5">
            <h3 className="font-medium text-gray-900 mb-3">Status</h3>
            <div className="flex items-center gap-1.5 mb-4">
              <StatusBadge status={proposal.status} />
              {proposal.decision && <StatusBadge status={proposal.decision} />}
            </div>
            <div className="flex flex-col gap-2">
              {proposal.status === 'received' && (
                <ActionForm action={startReview.bind(null, proposal.id)}>
                  <SubmitButton pendingLabel="Starting…" className="btn btn-primary w-full">
                    Start review
                  </SubmitButton>
                </ActionForm>
              )}
              {isOpen && (
                <ActionForm action={setProposalStatus.bind(null, proposal.id, 'withdrawn' as const)}>
                  <SubmitButton pendingLabel="Withdrawing…" className="btn btn-secondary w-full">
                    Withdraw
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </div>

          {/* Link applicant contact (external submissions arrive without one) */}
          {needsContact && isOpen && (
            <div className="card p-5">
              <h3 className="font-medium text-gray-900 mb-1">Applicant contact</h3>
              <p className="text-sm text-gray-500 mb-3">
                Link this submission to a contact
                {proposal.organization_name || proposal.applicant_name
                  ? ` for ${proposal.organization_name ?? proposal.applicant_name}`
                  : ''}{' '}
                — required before diligence.
              </p>
              <ActionForm
                action={linkApplicantContact.bind(null, proposal.id)}
                className="space-y-2"
              >
                <ApplicantSelect
                  name="applicant_contact_id"
                  aria-label="Applicant contact"
                  contacts={allContacts ?? []}
                  required
                />
                <SubmitButton pendingLabel="Linking…" className="btn btn-primary w-full">
                  Link contact
                </SubmitButton>
              </ActionForm>
            </div>
          )}

          {/* Reviews */}
          {showReviewsCard && (
            <div className="card p-5">
              <h3 className="font-medium text-gray-900 mb-3">
                {blind ? 'Votes (blind)' : 'Reviews'}
              </h3>

              {blind ? (
                <>
                  <p className="text-sm text-gray-500 mb-3">
                    Votes stay hidden until {votersPhrase} has voted or recused.
                  </p>
                  <ul className="space-y-2 mb-1">
                    {voters.map((member) => {
                      const submitted = weighedIn?.has(member.id) ?? false
                      const isMe = member.id === currentMemberId
                      return (
                        <li
                          key={member.id}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="text-gray-900">
                            {member.full_name}
                            {isMe && <span className="text-gray-400"> (you)</span>}
                          </span>
                          {submitted ? (
                            <span className="text-xs font-medium text-green-700">Submitted</span>
                          ) : (
                            <span className="text-xs text-gray-400">Waiting</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {!isVoter && (
                    <p className="text-xs text-gray-400">Admins vote on proposals.</p>
                  )}
                  {currentMemberId && isVoter && (
                    <MyReviewForm
                      proposalId={proposal.id}
                      existing={
                        myReview
                          ? {
                              score: myReview.score,
                              vote: myReview.vote,
                              comments: myReview.comments,
                              recused: myReview.recused,
                            }
                          : null
                      }
                    />
                  )}
                  <p className="text-xs text-gray-400 border-t border-gray-100 pt-3 mt-4">
                    Votes reveal automatically once {votersPhrase} has voted or recused.
                  </p>
                </>
              ) : (
                <>
                  <ul className="space-y-3">
                    {voters.map((member) => {
                      const review = reviewsByMember.get(member.id)
                      return (
                        <li key={member.id}>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm text-gray-900">{member.full_name}</span>
                            <span className="flex items-center gap-2">
                              {review?.recused ? (
                                <span className="text-xs text-gray-400 italic">Recused</span>
                              ) : review?.vote ? (
                                <StatusBadge status={review.vote} />
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                              {!review?.recused && review?.score != null && (
                                <span className="text-xs text-gray-600 tabular-nums">
                                  ★ {review.score}/5
                                </span>
                              )}
                            </span>
                          </div>
                          {review?.comments && (
                            <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">
                              {review.comments}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {inReview && proposal.votes_revealed && isVoter && (
                    <AdvanceDeclinePanel
                      proposalId={proposal.id}
                      hasContact={!needsContact}
                    />
                  )}
                </>
              )}
            </div>
          )}

          {/* Decision (diligence only; gated on the memo) */}
          {proposal.status === 'diligence' && !proposal.decision && (
            <div className="card p-5">
              <h3 className="font-medium text-gray-900 mb-3">Decision</h3>
              {!isVoter ? (
                <p className="text-sm text-gray-500">Admins record the decision.</p>
              ) : memoComplete ? (
                <DecisionForm
                  proposalId={proposal.id}
                  requestedAmount={centsToDollarString(proposal.amount_requested_cents)}
                  canCreateAward={authState.isAdmin}
                />
              ) : (
                <p className="text-sm text-gray-500">
                  The grant memorandum must be fully drafted before a decision can be recorded.
                  <span className="block text-xs text-gray-400 mt-1 tabular-nums">
                    {memoAnswered}/{memoTotal} sections drafted
                  </span>
                </p>
              )}
            </div>
          )}
          {proposal.decision && (
            <div className="card p-5">
              <h3 className="font-medium text-gray-900 mb-3">Decision</h3>
              <div className="flex items-center gap-2 mb-2">
                <StatusBadge status={proposal.decision} />
                <span className="text-sm text-gray-500">{formatDate(proposal.decision_date)}</span>
              </div>
              {proposal.declined_stage && (
                <p className="text-xs text-gray-400 mb-2">
                  Declined at {proposal.declined_stage === 'review' ? 'review' : 'final decision'}.
                </p>
              )}
              {proposal.decision_notes && (
                <p className="text-sm text-gray-700 whitespace-pre-wrap mb-2">
                  {proposal.decision_notes}
                </p>
              )}
              {proposal.decision === 'approved' && !award && authState.isAdmin && (
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="text-sm text-amber-700 mb-2">
                    This proposal is approved and has no award yet. Create it now.
                  </p>
                  <DecisionForm
                    proposalId={proposal.id}
                    requestedAmount={centsToDollarString(proposal.amount_requested_cents)}
                    canCreateAward
                    finishApproval
                  />
                </div>
              )}
              {proposal.decision === 'approved' && !award && !authState.isAdmin && (
                <p className="text-xs text-gray-400 mt-2">Approved. An admin creates the award.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
