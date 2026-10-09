import Link from 'next/link'
import StatusBadge from '@/components/StatusBadge'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import type { GrantProposal } from '@/lib/supabase/types/database'

/** The proposal columns a card shows */
export type ProposalCardData = Pick<
  GrantProposal,
  'id' | 'title' | 'origin' | 'amount_requested_cents' | 'received_date' | 'program_areas' | 'status' | 'decision'
>
import { programAreaLabel, type ProgramAreaOption } from '@/lib/program-areas'

/**
 * One proposal on the pipeline board. Pure props so every tab can reuse it;
 * stage-specific content (vote progress, tallies, memo progress, email state)
 * goes in the footer slot.
 */
export default function ProposalCard({
  proposal,
  applicantLabel,
  programAreas,
  href,
  footer,
}: {
  proposal: ProposalCardData
  applicantLabel: string
  /** For labeling the proposal's program-area slugs */
  programAreas: ProgramAreaOption[]
  href: string
  footer?: React.ReactNode
}) {
  return (
    <div className="card relative p-4 hover:bg-gray-50 transition-colors flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={href}
          className="font-medium text-sm text-gray-900 hover:underline before:absolute before:inset-0 before:content-['']"
        >
          {proposal.title}
        </Link>
        <span
          className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide ${
            proposal.origin === 'external'
              ? 'bg-blue-50 text-blue-700'
              : 'bg-gray-100 text-gray-500'
          }`}
        >
          {proposal.origin}
        </span>
      </div>

      <p className="text-sm text-gray-600">{applicantLabel}</p>

      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        <span className="tabular-nums font-medium text-gray-700">
          {formatCents(proposal.amount_requested_cents)}
        </span>
        <span aria-hidden>·</span>
        <span>{formatDate(proposal.received_date)}</span>
        {proposal.program_areas.map((slug) => (
          <span key={slug} className="px-1.5 py-0.5 bg-gray-100 rounded text-gray-600">
            {programAreaLabel(programAreas, slug)}
          </span>
        ))}
        {proposal.status === 'withdrawn' && <StatusBadge status="withdrawn" />}
        {proposal.decision && <StatusBadge status={proposal.decision} />}
      </div>

      {footer && <div className="border-t border-gray-100 pt-2 text-xs">{footer}</div>}
    </div>
  )
}
