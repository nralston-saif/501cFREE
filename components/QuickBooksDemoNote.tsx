export const QUICKBOOKS_DOC_URL = 'https://github.com/nralston-saif/501cFREE/blob/main/docs/quickbooks.md'

/**
 * What the QuickBooks Online integration does, shown in demo mode in place of
 * the connect, sync and send controls (demo mode can't connect to
 * QuickBooks). Keep it in step with docs/quickbooks.md and lib/quickbooks/**.
 */
export default function QuickBooksDemoNote({
  compact = false,
  children,
}: {
  /** Short version, for the expense page */
  compact?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
      <p className="font-medium">QuickBooks can&rsquo;t connect in this demo.</p>
      {compact ? (
        <p className="mt-1">
          In a real installation, this expense would be matched to its bank-feed transaction in
          Banking, and the app would fill in that QuickBooks transaction&rsquo;s payee, category,
          990 class and receipt. Payments no bank feed sees can be sent with &ldquo;Send to
          QuickBooks&rdquo;.
        </p>
      ) : (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          <li>
            QuickBooks Online stays the book of record, and its bank feeds are the source of truth
            for cash transactions.
          </li>
          <li>
            On a schedule (daily by default, up to every 30 minutes on paid hosting) or on <em>Sync now</em>, the app pulls new and changed QuickBooks
            transactions into Banking for review, each with a suggested match: an open invoice, an
            existing expense, a scheduled grant disbursement, a PRI, or a new expense or
            contribution.
          </li>
          <li>
            Once a bank-feed transaction is matched, the app fills it in with the payee, category
            account, 990 functional class, description and receipts. It never changes the
            bank&rsquo;s amount, date or account.
          </li>
          <li>
            It doesn&rsquo;t create QuickBooks transactions on its own. The exceptions are
            vendors it adds when filling in a payee, and payments no bank feed sees, which an admin
            sends explicitly with <em>Send to QuickBooks</em> on the expense.
          </li>
          <li>
            Auto-apply (off unless you turn it on) only marks exact matches to scheduled grant
            disbursements as paid. Everything else waits for review.
          </li>
        </ul>
      )}
      {children}
      <p className="mt-2">
        <a href={QUICKBOOKS_DOC_URL} target="_blank" rel="noreferrer noopener" className="font-medium underline">
          How the QuickBooks integration works
        </a>
      </p>
    </div>
  )
}
