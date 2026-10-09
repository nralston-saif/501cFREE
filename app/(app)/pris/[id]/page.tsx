import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { setPriInvestmentDate, setPriBoardApprovalDate } from '@/lib/actions/pris'
import { requiresBoardApproval } from '@/lib/pris/policy'
import { getOrgSettings } from '@/lib/settings'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import SubmitButton from '@/components/SubmitButton'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import ContactNotes from '@/components/ContactNotes'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import { isPriMemoComplete, priMemoAnsweredCount, PRI_MEMO_FIELDS } from '@/lib/pris/memo'
import { INSTRUMENT_LABELS } from '../instruments'
import PriMemoCard from './PriMemoCard'
import PriMemoPdfPanel from './PriMemoPdfPanel'
import PriStatusSelect from './PriStatusSelect'
import MarkFundedForm from './MarkFundedForm'
import PriResearchPanel from './PriResearchPanel'
import type { PriMemoKey } from '@/lib/pris/memo'
import ActionForm from '@/components/ActionForm'

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-gray-900 mt-0.5">{value}</dd>
    </div>
  )
}

function ChecklistItem({ done, label }: { done: boolean; label: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm">
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          done
            ? 'bg-emerald-100 text-emerald-700'
            : 'border-2 border-gray-300 bg-white text-transparent'
        }`}
      >
        {done ? '✓' : ''}
      </span>
      <span className={done ? 'text-gray-700' : 'text-gray-500'}>{label}</span>
    </li>
  )
}

export default async function PriPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: pri } = await supabase.from('pris').select('*').eq('id', id).maybeSingle()

  if (!pri) notFound()

  const [
    { data: recipient },
    { data: memo },
    { data: attachments },
    { data: members },
    { data: research },
    { data: memoPdf },
    { pri_board_approval_threshold_cents: boardThreshold },
  ] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, display_name')
      .eq('id', pri.recipient_contact_id)
      .maybeSingle(),
    supabase.from('pri_memos').select('*').eq('pri_id', id).maybeSingle(),
    supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'pri')
      .eq('entity_id', id)
      .order('created_at', { ascending: false }),
    supabase.from('team_members').select('id, full_name'),
    supabase
      .from('pri_research')
      .select('*')
      .eq('pri_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('pri_memo_pdfs').select('*').eq('pri_id', id).maybeSingle(),
    getOrgSettings(supabase),
  ])

  const memberNames = new Map((members ?? []).map((m) => [m.id, m.full_name]))
  const memoComplete = isPriMemoComplete(memo)
  // The generated memo PDF is filed with the attachments but is not an
  // executed instrument — it must not satisfy the funding gate.
  const hasDocuments = (attachments ?? []).some((a) => a.id !== memoPdf?.attachment_id)
  const needsBoardApproval = requiresBoardApproval(pri.amount_cents, boardThreshold)
  const hasBoardApproval = Boolean(pri.board_approval_date)
  const readyToFund = memoComplete && hasDocuments && (!needsBoardApproval || hasBoardApproval)

  const revalidatePath = `/pris/${pri.id}`

  const researchEnabled = Boolean(process.env.ANTHROPIC_API_KEY)
  // Latest completed research → per-question draft map for the memo editor
  let researchDraft: Partial<Record<PriMemoKey, string>> | null = null
  if (research?.status === 'complete' && typeof research.draft === 'object' && research.draft) {
    const raw = research.draft as Record<string, unknown>
    const map: Partial<Record<PriMemoKey, string>> = {}
    for (const [key] of PRI_MEMO_FIELDS) {
      if (typeof raw[key] === 'string') map[key] = raw[key] as string
    }
    if (Object.keys(map).length > 0) researchDraft = map
  }

  return (
    <div>
      <PageHeader
        title={recipient?.display_name ?? 'Program-related investment'}
        description={pri.purpose ?? undefined}
      />

      <div className="space-y-6">
        {/* Details */}
        <div className="card p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h3 className="font-medium text-gray-900">Investment details</h3>
            {pri.status === 'committed' ? (
              <StatusBadge status={pri.status} />
            ) : (
              <div className="w-44">
                <PriStatusSelect priId={pri.id} status={pri.status} />
              </div>
            )}
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <DetailRow
              label="Recipient"
              value={
                recipient ? (
                  <Link href={`/contacts/${recipient.id}`} className="hover:underline">
                    {recipient.display_name}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <DetailRow label="Instrument" value={INSTRUMENT_LABELS[pri.instrument]} />
            <DetailRow
              label="Amount"
              value={<span className="tabular-nums">{formatCents(pri.amount_cents)}</span>}
            />
            <div>
              <dt className="text-xs text-gray-500 uppercase tracking-wide">Investment date</dt>
              <dd className="mt-0.5">
                <ActionForm
                  action={setPriInvestmentDate.bind(null, pri.id)}
                  className="flex items-center gap-2"
                >
                  <input
                    type="date"
                    name="investment_date"
                    aria-label="Investment date"
                    defaultValue={pri.investment_date ?? ''}
                    className="input py-1 text-sm w-40"
                  />
                  <SubmitButton
                    pendingLabel="Saving…"
                    className="text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    Save
                  </SubmitButton>
                </ActionForm>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-gray-500 uppercase tracking-wide">Board approved</dt>
              <dd className="mt-0.5">
                <ActionForm
                  action={setPriBoardApprovalDate.bind(null, pri.id)}
                  className="flex items-center gap-2"
                >
                  <input
                    type="date"
                    name="board_approval_date"
                    aria-label="Board approved"
                    defaultValue={pri.board_approval_date ?? ''}
                    className="input py-1 text-sm w-40"
                  />
                  <SubmitButton
                    pendingLabel="Saving…"
                    className="text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    Save
                  </SubmitButton>
                </ActionForm>
                {needsBoardApproval && !hasBoardApproval ? (
                  <p className="text-xs text-amber-700 mt-1">
                    Required before funding ({formatCents(boardThreshold)}+ investment).
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">
                    {boardThreshold == null
                      ? 'Optional: no board-approval threshold is set.'
                      : `Optional below ${formatCents(boardThreshold)}.`}
                  </p>
                )}
              </dd>
            </div>
            {pri.funded_date && (
              <DetailRow
                label="Funded"
                value={
                  <>
                    {formatDate(pri.funded_date)}
                    {pri.method && (
                      <span className="text-gray-500 uppercase text-xs"> · {pri.method}</span>
                    )}
                  </>
                }
              />
            )}
          </dl>
          {pri.notes && (
            <div className="mt-4">
              <dt className="text-xs text-gray-500 uppercase tracking-wide">Notes</dt>
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{pri.notes}</p>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-4">
            PRIs are investments held as assets (Form 990 Part X line 13, Schedule D Part VIII) —
            they are not grants and never appear in functional expenses or Schedule I. Record the
            outgoing wire in QuickBooks manually as an asset purchase.
          </p>
        </div>

        {/* Funding gate */}
        {pri.status === 'committed' && (
          <div className="card p-5">
            <h3 className="font-medium text-gray-900 mb-3">Fund this investment</h3>
            <p className="text-sm text-gray-500 mb-3">
              The compliance file must be complete before the money goes out:
            </p>
            <ul className="space-y-2 mb-4">
              <ChecklistItem
                done={memoComplete}
                label={
                  <>
                    Mission-alignment memo fully answered (
                    {priMemoAnsweredCount(memo)}/{PRI_MEMO_FIELDS.length})
                  </>
                }
              />
              <ChecklistItem
                done={hasDocuments}
                label="Executed instrument (SAFE / note / agreement) attached below"
              />
              {needsBoardApproval && (
                <ChecklistItem
                  done={hasBoardApproval}
                  label={`Board approval date recorded (required for ${formatCents(boardThreshold)}+ investments)`}
                />
              )}
            </ul>
            {readyToFund ? (
              <MarkFundedForm priId={pri.id} ready={readyToFund} />
            ) : (
              <p className="text-sm text-gray-400 border-t border-gray-100 pt-4">
                The funding form unlocks once the checklist is complete.
              </p>
            )}
          </div>
        )}

        {researchEnabled && (
          <PriResearchPanel
            priId={pri.id}
            research={research ?? null}
            recipientName={recipient?.display_name ?? 'the recipient'}
          />
        )}

        <PriMemoCard
          priId={pri.id}
          memo={memo}
          startedByName={memo?.started_by ? (memberNames.get(memo.started_by) ?? null) : null}
          lastEditedByName={
            memo?.last_edited_by ? (memberNames.get(memo.last_edited_by) ?? null) : null
          }
          draft={researchDraft}
        />

        <PriMemoPdfPanel
          priId={pri.id}
          memoPdf={memoPdf ?? null}
          memoComplete={memoComplete}
          generatedByName={
            memoPdf?.generated_by ? (memberNames.get(memoPdf.generated_by) ?? null) : null
          }
        />

        <AttachmentsPanel
          entityType="pri"
          entityId={pri.id}
          attachments={attachments ?? []}
          revalidatePath={revalidatePath}
          title="Instrument & documents"
        />

        <ContactNotes entityType="pri" entityId={pri.id} />
      </div>
    </div>
  )
}
