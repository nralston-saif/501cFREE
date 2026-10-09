import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import type {
  DonationInquiry,
  GiftMethodPreference,
} from '@/lib/supabase/types/database'
import InquiryStatusSelect from './InquiryStatusSelect'
import { convertInquiryToContact } from '@/lib/actions/inquiries'
import CreateTicketButton from '@/components/CreateTicketButton'
import ActionForm from '@/components/ActionForm'

const GIFT_METHOD_LABELS: Record<GiftMethodPreference, string> = {
  check: 'Check',
  wire_ach: 'Wire / ACH',
  daf: 'Donor-advised fund',
  stock_crypto: 'Stock or crypto',
  other: 'Other / not sure',
}

function formatAmount(inquiry: DonationInquiry): string {
  if (inquiry.amount_cents !== null && inquiry.amount_cents !== undefined) {
    return formatCents(inquiry.amount_cents)
  }
  return inquiry.amount_text ?? '—'
}

export default async function InquiriesPage() {
  const supabase = await createClient()

  // Every inquiry (the counts below are taken from the whole list)
  const inquiries = await fetchAll<DonationInquiry>(() =>
    supabase.from('donation_inquiries').select('*').order('created_at', { ascending: false }).order('id')
  )

  const newCount = inquiries.filter((i) => i.status === 'new').length
  const openCount = inquiries.filter((i) => i.status !== 'archived').length

  return (
    <div>
      <PageHeader
        title="Donation inquiries"
        description="Prospective donors who reached out through your website donate form"
      >
        <CreateTicketButton />
      </PageHeader>

      <div className="card p-5 mb-6 grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="sm:border-r sm:border-gray-100 sm:pr-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">New</p>
          <p className="text-2xl font-semibold text-gray-900 tabular-nums">{newCount}</p>
          <p className="text-sm text-gray-500">awaiting first contact</p>
        </div>
        <div className="sm:border-r sm:border-gray-100 sm:pr-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Open</p>
          <p className="text-2xl font-semibold text-gray-900 tabular-nums">{openCount}</p>
          <p className="text-sm text-gray-500">not yet archived</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
          <p className="text-2xl font-semibold text-gray-900 tabular-nums">{inquiries.length}</p>
          <p className="text-sm text-gray-500">all time</p>
        </div>
      </div>

      {inquiries.length === 0 ? (
        <EmptyState message="No donation inquiries yet. Submissions from the website donate form will appear here." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Donor</th>
                <th className="px-4 py-3 font-medium">Wants to give</th>
                <th className="px-4 py-3 font-medium text-right">Amount</th>
                <th className="px-4 py-3 font-medium">Message</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {inquiries.map((inquiry) => (
                <tr
                  key={inquiry.id}
                  className={`border-b border-gray-50 align-top ${
                    inquiry.status === 'archived' ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {formatDate(inquiry.created_at.slice(0, 10))}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{inquiry.name}</p>
                    <a
                      href={`mailto:${inquiry.email}`}
                      className="text-gray-500 hover:text-gray-900 hover:underline break-all"
                    >
                      {inquiry.email}
                    </a>
                    {inquiry.phone && (
                      <p className="text-gray-500">{inquiry.phone}</p>
                    )}
                    {inquiry.organization && (
                      <p className="text-gray-500">{inquiry.organization}</p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {GIFT_METHOD_LABELS[inquiry.gift_method]}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-900 whitespace-nowrap">
                    {formatAmount(inquiry)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-sm">
                    {inquiry.message ? (
                      <span className="whitespace-pre-wrap">{inquiry.message}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-2">
                      <InquiryStatusSelect inquiryId={inquiry.id} status={inquiry.status} />
                      <ActionForm action={convertInquiryToContact.bind(null, inquiry.id)}>
                        <button
                          type="submit"
                          className="text-xs text-gray-500 hover:text-gray-900 hover:underline whitespace-nowrap"
                          title="Create (or link) a contact from this inquiry"
                        >
                          Convert to contact →
                        </button>
                      </ActionForm>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
