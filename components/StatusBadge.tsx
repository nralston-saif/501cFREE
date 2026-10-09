const STYLES: Record<string, string> = {
  // generic
  draft: 'bg-gray-100 text-gray-700',
  pending: 'bg-yellow-100 text-yellow-800',
  // letters
  generated: 'bg-blue-100 text-blue-800',
  sent: 'bg-green-100 text-green-800',
  // expenses
  paid: 'bg-green-100 text-green-800',
  reimbursed: 'bg-blue-100 text-blue-800',
  // proposals
  received: 'bg-gray-100 text-gray-700',
  in_review: 'bg-yellow-100 text-yellow-800',
  diligence: 'bg-purple-100 text-purple-800',
  decided: 'bg-blue-100 text-blue-800',
  withdrawn: 'bg-gray-100 text-gray-500',
  approved: 'bg-green-100 text-green-800',
  declined: 'bg-red-100 text-red-700',
  // grants
  awarded: 'bg-green-100 text-green-800',
  active: 'bg-blue-100 text-blue-800',
  completed: 'bg-gray-100 text-gray-700',
  terminated: 'bg-red-100 text-red-700',
  // disbursements / reports / deliverables
  scheduled: 'bg-yellow-100 text-yellow-800',
  cancelled: 'bg-gray-100 text-gray-500',
  upcoming: 'bg-yellow-100 text-yellow-800',
  overdue: 'bg-red-100 text-red-700',
  waived: 'bg-gray-100 text-gray-500',
  submitted: 'bg-blue-100 text-blue-800',
  // application statuses
  prospect: 'bg-gray-100 text-gray-700',
  preparing: 'bg-yellow-100 text-yellow-800',
  // PRIs
  committed: 'bg-yellow-100 text-yellow-800',
  funded: 'bg-green-100 text-green-800',
  converted: 'bg-blue-100 text-blue-800',
  repaid: 'bg-gray-100 text-gray-700',
  exited: 'bg-gray-100 text-gray-700',
  written_off: 'bg-red-100 text-red-700',
  // votes
  yes: 'bg-green-100 text-green-800',
  no: 'bg-red-100 text-red-700',
  maybe: 'bg-yellow-100 text-yellow-800',
  // QBO inbox
  auto_applied: 'bg-green-100 text-green-800',
  dismissed: 'bg-gray-100 text-gray-500',
  'synced from app': 'bg-blue-100 text-blue-800',
}

export default function StatusBadge({ status }: { status: string | null | undefined }) {
  const safe = typeof status === 'string' && status.length > 0 ? status : 'unknown'
  const style = STYLES[safe] ?? 'bg-gray-100 text-gray-700'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${style}`}
    >
      {safe.replace(/_/g, ' ')}
    </span>
  )
}
