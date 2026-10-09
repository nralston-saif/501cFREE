import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import { addGranteeReport, setAwardAgreementDate } from '@/lib/actions/grants-out'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import SubmitButton from '@/components/SubmitButton'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import { formatCents } from '@/lib/utils/money'
import { formatDate, daysUntil } from '@/lib/utils/dates'
import AwardStatusSelect from './AwardStatusSelect'
import DisbursementActions from './DisbursementActions'
import ReportActions from './ReportActions'
import AddDisbursementForm from './AddDisbursementForm'
import ReportFileChips from './ReportFileChips'
import GrantTabs from '@/components/GrantTabs'
import type { Attachment, GrantOut } from '@/lib/supabase/types/database'
import ActionForm from '@/components/ActionForm'

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-gray-900 mt-0.5">{value}</dd>
    </div>
  )
}

export default async function AwardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  // Paying a disbursement records an expense: admins only. Grantee and
  // proposal are embedded, so everything loads in one round trip.
  const [
    { isAdmin },
    { data: awardRow },
    { data: disbursements },
    { data: reports },
    { data: attachments },
  ] = await Promise.all([
    getAuthState(),
    supabase
      .from('grants_out')
      .select(
        '*, grantee:contacts!grantee_contact_id(id, display_name), ' +
          'proposal:grant_proposals!proposal_id(id, title)'
      )
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('disbursements')
      .select('*')
      .eq('grant_out_id', id)
      .order('scheduled_date', { ascending: true }),
    supabase
      .from('grantee_reports')
      .select('*')
      .eq('grant_out_id', id)
      .order('due_date', { ascending: true }),
    supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'grant_out')
      .eq('entity_id', id)
      .order('created_at', { ascending: false }),
  ])

  const awardWithEmbeds = awardRow as unknown as
    | (GrantOut & {
        grantee: { id: string; display_name: string } | null
        proposal: { id: string; title: string } | null
      })
    | null
  if (!awardWithEmbeds) notFound()
  const { grantee, proposal, ...award } = awardWithEmbeds

  const paidTotal = (disbursements ?? [])
    .filter((d) => d.status === 'paid')
    .reduce((sum, d) => sum + d.amount_cents, 0)

  const committedTotal = (disbursements ?? [])
    .filter((d) => d.status === 'paid' || d.status === 'scheduled')
    .reduce((sum, d) => sum + d.amount_cents, 0)

  const reportIds = (reports ?? []).map((r) => r.id)
  const { data: reportAttachments } =
    reportIds.length === 0
      ? { data: [] as Attachment[] }
      : await supabase
          .from('attachments')
          .select('*')
          .eq('entity_type', 'grantee_report')
          .in('entity_id', reportIds)
          .order('created_at', { ascending: false })

  const filesByReport = new Map<string, Attachment[]>()
  for (const a of reportAttachments ?? []) {
    const list = filesByReport.get(a.entity_id) ?? []
    list.push(a)
    filesByReport.set(a.entity_id, list)
  }

  const revalidatePath = `/grants-out/awards/${award.id}`

  return (
    <div>
      <PageHeader
        title={grantee?.display_name ?? 'Grant award'}
        description={award.purpose ?? undefined}
      />

      <GrantTabs
        proposalId={proposal?.id ?? null}
        awardId={award.id}
        active="award"
      />

      <div className="space-y-6">
        {/* Header card */}
        <div className="card p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <h3 className="font-medium text-gray-900">Award details</h3>
            <div className="w-44">
              <AwardStatusSelect awardId={award.id} status={award.status} />
            </div>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <DetailRow
              label="Grantee"
              value={
                grantee ? (
                  <Link href={`/contacts/${grantee.id}`} className="hover:underline">
                    {grantee.display_name}
                  </Link>
                ) : (
                  '—'
                )
              }
            />
            <DetailRow
              label="Amount awarded"
              value={<span className="tabular-nums">{formatCents(award.amount_awarded_cents)}</span>}
            />
            <DetailRow label="Award date" value={formatDate(award.award_date)} />
            <DetailRow label="Restriction" value={award.restriction ?? '—'} />
            <div>
              <dt className="text-xs text-gray-500 uppercase tracking-wide">Agreement signed</dt>
              <dd className="mt-0.5">
                <ActionForm
                  action={setAwardAgreementDate.bind(null, award.id)}
                  className="flex items-center gap-2"
                >
                  <input
                    type="date"
                    name="agreement_signed_date"
                    aria-label="Agreement signed"
                    defaultValue={award.agreement_signed_date ?? ''}
                    className="input py-1 text-sm w-40"
                  />
                  <SubmitButton
                    pendingLabel="Saving…"
                    className="text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    Save
                  </SubmitButton>
                </ActionForm>
                {!award.agreement_signed_date && (
                  <p className="text-xs text-amber-700 mt-1">
                    Required before disbursements can be paid.
                  </p>
                )}
              </dd>
            </div>
            {proposal && (
              <DetailRow
                label="From proposal"
                value={
                  <Link
                    href={`/grants-out/proposals/${proposal.id}`}
                    className="hover:underline"
                  >
                    {proposal.title}
                  </Link>
                }
              />
            )}
          </dl>
          {award.purpose && (
            <div className="mt-4">
              <dt className="text-xs text-gray-500 uppercase tracking-wide">Purpose</dt>
              <p className="text-sm text-gray-700 mt-1">{award.purpose}</p>
            </div>
          )}
          {award.notes && (
            <div className="mt-4">
              <dt className="text-xs text-gray-500 uppercase tracking-wide">Notes</dt>
              <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{award.notes}</p>
            </div>
          )}
        </div>

        {/* Disbursements */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium text-gray-900">Disbursements</h3>
            <p className="text-sm text-gray-500">
              Disbursed <span className="tabular-nums font-medium">{formatCents(paidTotal)}</span> of{' '}
              <span className="tabular-nums font-medium">
                {formatCents(award.amount_awarded_cents)}
              </span>
            </p>
          </div>

          {(disbursements ?? []).length === 0 ? (
            <p className="text-sm text-gray-400 mb-4">No disbursements scheduled.</p>
          ) : (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    <th className="py-2 pr-4 font-medium">Scheduled</th>
                    <th className="py-2 pr-4 font-medium">Paid</th>
                    <th className="py-2 pr-4 font-medium">Method</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium text-right">Amount</th>
                    <th className="py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(disbursements ?? []).map((d) => (
                    <tr key={d.id} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2.5 pr-4 text-gray-600">{formatDate(d.scheduled_date)}</td>
                      <td className="py-2.5 pr-4 text-gray-600">{formatDate(d.paid_date)}</td>
                      <td className="py-2.5 pr-4 text-gray-600 uppercase text-xs">
                        {d.method ?? '—'}
                      </td>
                      <td className="py-2.5 pr-4">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {formatCents(d.amount_cents)}
                      </td>
                      <td className="py-2.5 text-right">
                        {d.status === 'scheduled' && (
                          <DisbursementActions disbursementId={d.id} awardId={award.id} canMarkPaid={isAdmin} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <AddDisbursementForm
            awardId={award.id}
            awardedCents={award.amount_awarded_cents}
            committedCents={committedTotal}
          />
        </div>

        {/* Grantee reports */}
        <div className="card p-5">
          <h3 className="font-medium text-gray-900 mb-3">Grantee reports</h3>

          {(reports ?? []).length === 0 ? (
            <p className="text-sm text-gray-400 mb-4">No reports required yet.</p>
          ) : (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium">Due</th>
                    <th className="py-2 pr-4 font-medium">Received</th>
                    <th className="py-2 pr-4 font-medium">Status</th>
                    <th className="py-2 pr-4 font-medium">Files</th>
                    <th className="py-2 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(reports ?? []).map((report) => {
                    const isOverdue =
                      daysUntil(report.due_date) < 0 &&
                      report.status !== 'received' &&
                      report.status !== 'waived'
                    return (
                      <tr key={report.id} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2.5 pr-4 text-gray-600 capitalize">
                          {report.report_type}
                        </td>
                        <td
                          className={`py-2.5 pr-4 ${
                            isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'
                          }`}
                        >
                          {formatDate(report.due_date)}
                        </td>
                        <td className="py-2.5 pr-4 text-gray-600">
                          {formatDate(report.received_date)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <StatusBadge status={report.status} />
                        </td>
                        <td className="py-2.5 pr-4">
                          <ReportFileChips
                            reportId={report.id}
                            awardId={award.id}
                            attachments={filesByReport.get(report.id) ?? []}
                          />
                        </td>
                        <td className="py-2.5 text-right">
                          <ReportActions
                            reportId={report.id}
                            awardId={award.id}
                            status={report.status}
                          />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <ActionForm
            action={addGranteeReport.bind(null, award.id)}
            className="flex flex-wrap items-end gap-3 border-t border-gray-100 pt-4"
          >
            <div>
              <label htmlFor="report_type" className="block text-xs font-medium text-gray-500 mb-1">
                Type *
              </label>
              <select id="report_type" name="report_type" required className="input">
                <option value="progress">Progress</option>
                <option value="final">Final</option>
                <option value="financial">Financial</option>
              </select>
            </div>
            <div>
              <label htmlFor="due_date" className="block text-xs font-medium text-gray-500 mb-1">
                Due date *
              </label>
              <input id="due_date" name="due_date" type="date" required className="input" />
            </div>
            <div className="flex-1 min-w-44">
              <label htmlFor="notes" className="block text-xs font-medium text-gray-500 mb-1">
                Notes
              </label>
              <input id="notes" name="notes" type="text" className="input" />
            </div>
            <div>
              <label
                htmlFor="report_file"
                className="block text-xs font-medium text-gray-500 mb-1"
              >
                File (optional)
              </label>
              <input
                id="report_file"
                name="file"
                type="file"
                className="block text-xs text-gray-700 file:mr-2 file:py-1 file:px-2 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
              />
            </div>
            <SubmitButton pendingLabel="Adding…" className="btn btn-secondary">
              Add report
            </SubmitButton>
          </ActionForm>
        </div>

        <AttachmentsPanel
          entityType="grant_out"
          entityId={award.id}
          attachments={attachments ?? []}
          revalidatePath={revalidatePath}
          title="Agreement & documents"
        />
      </div>
    </div>
  )
}
