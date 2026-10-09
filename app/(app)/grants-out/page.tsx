import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import EmptyState from '@/components/EmptyState'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import { MEMO_SECTION_FIELDS } from '@/lib/grants/memo'
import { isVotingMember, progressFromWeighedIn, type VotingReview } from '@/lib/grants/voting'
import { getOrgSettings } from '@/lib/settings'
import { loadWeighedIn } from '@/lib/grants/review-progress'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { oneEmbed } from '@/lib/reports/embed'
import type { GrantOut, GrantProposal, ProposalStatus, Vote } from '@/lib/supabase/types/database'
import ProposalCard, { type ProposalCardData } from './ProposalCard'
import { loadProgramAreas } from '@/lib/program-areas'
import CreateTicketButton from '@/components/CreateTicketButton'

// The proposal pipeline board: Review (blind voting by the review body) -> Diligence
// (grant memorandum) -> Decided, plus the Awards ledger. External proposals
// enter at Review via the public form; internal ones are created directly in
// Diligence.

type Tab = 'review' | 'diligence' | 'decided' | 'awards'

type VoteTally = { yes: number; no: number; maybe: number }

type PipelineReview = VotingReview & { proposal_id: string }

/** What the board needs per proposal: the card, its applicant, and footers */
type PipelineProposal = ProposalCardData &
  Pick<
    GrantProposal,
    | 'votes_revealed'
    | 'applicant_contact_id'
    | 'organization_name'
    | 'applicant_name'
    | 'response_email_sent_at'
    | 'draft_response_email'
  > & {
    applicant: { display_name: string } | null
    /** Reviews this member can see: their own, or all once revealed */
    reviews?: PipelineReview[] | null
    /** grants_out.proposal_id is unique, so PostgREST may embed one object */
    awards?: { id: string }[] | { id: string } | null
  }

const PIPELINE_COLUMNS =
  'id, title, origin, amount_requested_cents, received_date, program_areas, status, decision, votes_revealed, applicant_contact_id, organization_name, applicant_name, response_email_sent_at, draft_response_email, applicant:contacts!applicant_contact_id(display_name)'

const TAB_STATUSES = {
  review: ['received', 'in_review'],
  diligence: ['diligence'],
  decided: ['decided', 'withdrawn'],
} as const

function tallyLabel(reviews: PipelineReview[]): string {
  const tally: VoteTally = { yes: 0, no: 0, maybe: 0 }
  let recusals = 0
  for (const r of reviews) {
    if (r.recused) recusals += 1
    else if (r.vote) tally[r.vote as Vote] += 1
  }
  const parts: string[] = []
  if (tally.yes > 0) parts.push(`${tally.yes} yes`)
  if (tally.maybe > 0) parts.push(`${tally.maybe} maybe`)
  if (tally.no > 0) parts.push(`${tally.no} no`)
  if (recusals > 0) parts.push(`${recusals} recused`)
  return parts.length > 0 ? parts.join(' · ') : 'No votes'
}

function hasWeighedIn(review: VotingReview | undefined): boolean {
  return Boolean(review && (review.recused || review.vote !== null))
}

function applicantLabel(p: PipelineProposal): string {
  if (p.applicant_contact_id) {
    return p.applicant?.display_name ?? '—'
  }
  return p.organization_name ?? p.applicant_name ?? '—'
}

function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
}

function BoardSection({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}) {
  if (count === 0) return null
  return (
    <section>
      <h2 className="text-sm font-medium text-gray-700 mb-2">
        {title} <span className="text-gray-400 tabular-nums">({count})</span>
      </h2>
      {children}
    </section>
  )
}

async function AwardsTab() {
  const supabase = await createClient()
  // Every award, with its grantee's name and its disbursements embedded
  // (embedded rows aren't subject to max_rows; the award list is paged)
  type AwardRow = Pick<GrantOut, 'id' | 'grantee_contact_id' | 'purpose' | 'amount_awarded_cents' | 'award_date' | 'status'> & {
    grantee: { display_name: string } | null
    disbursements: { amount_cents: number; status: string }[] | null
  }
  const awards = await fetchAll<AwardRow>(() =>
    supabase
      .from('grants_out')
      .select(
        'id, grantee_contact_id, purpose, amount_awarded_cents, award_date, status, grantee:contacts!grantee_contact_id(display_name), disbursements:disbursements!grant_out_id(amount_cents, status)'
      )
      .order('award_date', { ascending: false })
      .order('id')
  )

  const paidByAward = new Map<string, number>()
  for (const a of awards) {
    for (const d of a.disbursements ?? []) {
      if (d.status === 'paid') paidByAward.set(a.id, (paidByAward.get(a.id) ?? 0) + d.amount_cents)
    }
  }

  if (awards.length === 0) {
    return <EmptyState message="No awards yet. Approve a proposal or record an award directly." />
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
            <th className="px-4 py-3 font-medium">Grantee</th>
            <th className="px-4 py-3 font-medium">Purpose</th>
            <th className="px-4 py-3 font-medium text-right">Awarded</th>
            <th className="px-4 py-3 font-medium">Award date</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium text-right">Disbursed</th>
          </tr>
        </thead>
        <tbody>
          {awards.map((a) => (
            <tr
              key={a.id}
              className="relative border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/grants-out/awards/${a.id}`}
                  className="font-medium text-gray-900 hover:underline before:absolute before:inset-0 before:content-['']"
                >
                  {a.grantee?.display_name ?? 'Unknown grantee'}
                </Link>
              </td>
              <td className="px-4 py-3 text-gray-600">{a.purpose ?? '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatCents(a.amount_awarded_cents)}
              </td>
              <td className="px-4 py-3 text-gray-600">{formatDate(a.award_date)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={a.status} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums">
                {formatCents(paidByAward.get(a.id) ?? 0)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; area?: string }>
}) {
  const { tab, area } = await searchParams
  const activeTab: Tab =
    tab === 'diligence' || tab === 'decided' || tab === 'awards' ? tab : 'review'

  const supabase = await createClient()

  // One wave of queries. Only the active tab's proposals are loaded (paged,
  // so a long history isn't cut off at max_rows); the other tabs show
  // head-only counts. The ?area= filter is applied in SQL once it's known to
  // be a real program area (that check only waits when the URL has one).
  const programAreasP = loadProgramAreas(supabase)
  const areaFilterP: Promise<string | null> = area
    ? programAreasP.then((areas) => (areas.some((a) => a.slug === area) ? area : null))
    : Promise.resolve(null)

  const countStatuses = (statuses: readonly ProposalStatus[]) =>
    areaFilterP.then(async (areaFilter) => {
      let query = supabase
        .from('grant_proposals')
        .select('id', { count: 'exact', head: true })
        .in('status', [...statuses])
      if (areaFilter) query = query.contains('program_areas', [areaFilter])
      return (await query).count ?? 0
    })

  const tabProposalsP: Promise<PipelineProposal[]> =
    activeTab === 'awards'
      ? Promise.resolve([])
      : areaFilterP.then((areaFilter) => {
          const embeds =
            activeTab === 'review'
              ? ', reviews:proposal_reviews!proposal_id(proposal_id, reviewer_id, vote, recused)'
              : activeTab === 'decided'
                ? ', awards:grants_out!proposal_id(id)'
                : ''
          return fetchAll<PipelineProposal>(() => {
            let query = supabase
              .from('grant_proposals')
              .select(PIPELINE_COLUMNS + embeds)
              .in('status', [...TAB_STATUSES[activeTab]])
            if (areaFilter) query = query.contains('program_areas', [areaFilter])
            return query.order('received_date', { ascending: false }).order('id')
          })
        })

  const [
    tabProposals,
    { data: activeMembers },
    reviewCount,
    diligenceCount,
    decidedCount,
    { count: awardsCount },
    authState,
    programAreas,
    areaFilter,
    { grant_review_mode: reviewMode },
    weighedIn,
    answeredByProposal,
  ] = await Promise.all([
    tabProposalsP,
    supabase.from('team_members').select('id, role').eq('is_active', true),
    countStatuses(TAB_STATUSES.review),
    countStatuses(TAB_STATUSES.diligence),
    countStatuses(TAB_STATUSES.decided),
    supabase.from('grants_out').select('id', { count: 'exact', head: true }),
    // Cached per request — shares the layout's auth + member lookup
    getAuthState(),
    programAreasP,
    areaFilterP,
    getOrgSettings(supabase),
    // Who has weighed in on each still-blind proposal (never how)
    tabProposalsP.then((ps) =>
      loadWeighedIn(
        supabase,
        ps.filter((p) => p.status === 'in_review' && !p.votes_revealed).map((p) => p.id)
      )
    ),
    // Answered memo sections, counted in SQL instead of loading every memo
    activeTab === 'diligence'
      ? tabProposalsP.then(async (ps) => {
          if (ps.length === 0) return new Map<string, number>()
          const { data, error } = await supabase.rpc('proposal_memo_progress', {
            p_proposal_ids: ps.map((p) => p.id),
          })
          if (error) throw new Error(`Could not load memo progress: ${error.message}`)
          return new Map((data ?? []).map((r) => [r.proposal_id, r.answered]))
        })
      : Promise.resolve(new Map<string, number>()),
  ])

  const currentMemberId = authState.memberId
  // The voting body (org_settings.grant_review_mode)
  const members = (activeMembers ?? []).filter((m) => isVotingMember(m, reviewMode))

  const all = tabProposals
  const areaQuery = areaFilter ? `&area=${encodeURIComponent(areaFilter)}` : ''
  const awardIdByProposal = new Map<string, string>()
  for (const p of all) {
    const award = oneEmbed(p.awards)
    if (award) awardIdByProposal.set(p.id, award.id)
  }
  const reviewsByProposal = new Map<string, PipelineReview[]>()
  for (const p of all) reviewsByProposal.set(p.id, p.reviews ?? [])

  // Review-tab buckets (blind voting: never show votes before reveal)
  const received = all.filter((p) => p.status === 'received')
  const inReview = all.filter((p) => p.status === 'in_review')
  const myReviewFor = (p: PipelineProposal) =>
    (reviewsByProposal.get(p.id) ?? []).find((r) => r.reviewer_id === currentMemberId)
  const needsMyVote = inReview.filter((p) => !p.votes_revealed && !hasWeighedIn(myReviewFor(p)))
  const waitingOnOthers = inReview.filter(
    (p) => !p.votes_revealed && hasWeighedIn(myReviewFor(p))
  )
  const readyToDecide = inReview.filter((p) => p.votes_revealed)

  const diligence = all.filter((p) => p.status === 'diligence')
  const closed = all.filter((p) => p.status === 'decided' || p.status === 'withdrawn')

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'review', label: 'Review', count: reviewCount },
    { key: 'diligence', label: 'Diligence', count: diligenceCount },
    { key: 'decided', label: 'Decided', count: decidedCount },
    { key: 'awards', label: 'Awards', count: awardsCount ?? 0 },
  ]

  const card = (p: PipelineProposal, footer?: React.ReactNode) => (
    <ProposalCard
      key={p.id}
      proposal={p}
      applicantLabel={applicantLabel(p)}
      programAreas={programAreas}
      href={`/grants-out/proposals/${p.id}`}
      footer={footer}
    />
  )

  return (
    <div>
      <PageHeader
        title="Grants"
        description="Proposal pipeline: review, diligence, decision, award."
        action={{ href: '/grants-out/new', label: 'New proposal' }}
      >
        <CreateTicketButton />
        <Link href="/grants-out/awards/new" className="btn btn-secondary">
          Record award directly
        </Link>
      </PageHeader>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={`/grants-out?tab=${t.key}${t.key === 'awards' ? '' : areaQuery}`}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span
              className={`px-1.5 py-0.5 rounded-full text-xs tabular-nums ${
                activeTab === t.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'
              }`}
            >
              {t.count}
            </span>
          </Link>
        ))}
      </div>

      {activeTab !== 'awards' && programAreas.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-6 text-xs">
          <span className="text-gray-500 mr-1">Program area:</span>
          {[{ slug: null as string | null, label: 'All' }, ...programAreas].map((a) => {
            const active = (a.slug ?? null) === areaFilter
            return (
              <Link
                key={a.slug ?? 'all'}
                href={`/grants-out?tab=${activeTab}${a.slug ? `&area=${encodeURIComponent(a.slug)}` : ''}`}
                className={`px-2 py-1 rounded-full border ${
                  active
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 text-gray-600 hover:border-gray-400'
                }`}
              >
                {a.label}
              </Link>
            )
          })}
        </div>
      )}

      {activeTab === 'review' &&
        (received.length + inReview.length === 0 ? (
          <EmptyState message="Nothing in review. External submissions land here; internal proposals start in Diligence." />
        ) : (
          <div className="space-y-8">
            <BoardSection title="New submissions" count={received.length}>
              <CardGrid>
                {received.map((p) =>
                  card(p, <span className="text-gray-500">Awaiting triage — start review</span>)
                )}
              </CardGrid>
            </BoardSection>
            <BoardSection title="Needs your vote" count={needsMyVote.length}>
              <CardGrid>
                {needsMyVote.map((p) => {
                  const progress = progressFromWeighedIn(members ?? [], weighedIn.get(p.id))
                  return card(
                    p,
                    <span className="font-medium text-amber-700">
                      Vote now · {progress.submitted}/{progress.total} votes in
                    </span>
                  )
                })}
              </CardGrid>
            </BoardSection>
            <BoardSection title="Waiting on others" count={waitingOnOthers.length}>
              <CardGrid>
                {waitingOnOthers.map((p) => {
                  const progress = progressFromWeighedIn(members ?? [], weighedIn.get(p.id))
                  return card(
                    p,
                    <span className="text-gray-500">
                      You voted · {progress.submitted}/{progress.total} votes in
                    </span>
                  )
                })}
              </CardGrid>
            </BoardSection>
            <BoardSection title="Votes revealed — decide" count={readyToDecide.length}>
              <CardGrid>
                {readyToDecide.map((p) =>
                  card(
                    p,
                    <span className="font-medium text-gray-700">
                      {tallyLabel(reviewsByProposal.get(p.id) ?? [])} · advance or decline
                    </span>
                  )
                )}
              </CardGrid>
            </BoardSection>
          </div>
        ))}

      {activeTab === 'diligence' &&
        (diligence.length === 0 ? (
          <EmptyState message="Nothing in diligence. Advance a reviewed proposal or create an internal one." />
        ) : (
          <CardGrid>
            {diligence.map((p) => {
              const answered = answeredByProposal.get(p.id) ?? 0
              return card(
                p,
                <span
                  className={
                    answered === MEMO_SECTION_FIELDS.length
                      ? 'font-medium text-green-700'
                      : 'text-gray-500'
                  }
                >
                  Memo {answered}/{MEMO_SECTION_FIELDS.length} sections
                </span>
              )
            })}
          </CardGrid>
        ))}

      {activeTab === 'decided' &&
        (closed.length === 0 ? (
          <EmptyState message="No decided proposals yet." />
        ) : (
          <CardGrid>
            {closed.map((p) => {
              const awardId = awardIdByProposal.get(p.id)
              let footer: React.ReactNode = null
              if (p.decision === 'approved' && awardId) {
                footer = (
                  <Link
                    href={`/grants-out/awards/${awardId}`}
                    className="relative z-10 font-medium text-green-700 hover:underline"
                  >
                    View award →
                  </Link>
                )
              } else if (p.decision === 'declined') {
                footer = p.response_email_sent_at ? (
                  <span className="text-gray-500">Response email sent</span>
                ) : p.draft_response_email ? (
                  <span className="font-medium text-amber-700">Response email drafted — send it</span>
                ) : (
                  <span className="font-medium text-amber-700">Response email needed</span>
                )
              }
              return card(p, footer)
            })}
          </CardGrid>
        ))}

      {activeTab === 'awards' && <AwardsTab />}
    </div>
  )
}
