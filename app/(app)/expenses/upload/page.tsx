import { createClient } from '@/lib/supabase/server'
import { loadContactOptions } from '@/lib/contacts/options'
import { fetchAll } from '@/lib/supabase/fetch-all'
import type { Expense } from '@/lib/supabase/types/database'
import PageHeader from '@/components/PageHeader'
import BulkInvoiceUpload from './BulkInvoiceUpload'
import { utcDateDaysAgo } from '@/lib/utils/dates'

type ExistingExpense = Pick<Expense, 'id' | 'amount_cents' | 'expense_date' | 'description' | 'vendor_contact_id'>

export default async function UploadInvoicesPage() {
  const supabase = await createClient()
  const twoYearsAgo = utcDateDaysAgo(730)

  const [{ data: categories }, vendors, existing] = await Promise.all([
    supabase.from('expense_categories').select('*').eq('is_active', true).order('name'),
    loadContactOptions(supabase, { vendorsOnly: true }),
    // For duplicate warnings against what's already recorded.
    fetchAll<ExistingExpense>(() =>
      supabase
        .from('expenses')
        .select('id, amount_cents, expense_date, description, vendor_contact_id')
        .gte('expense_date', twoYearsAgo)
        .order('id')
    ),
  ])

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Upload invoices & receipts"
        description="Drop in a batch of files. Claude reads each one, you review the list, then create the expenses in one go. Each file is saved as that expense's receipt."
      />
      <BulkInvoiceUpload
        categories={categories ?? []}
        vendors={vendors}
        existingExpenses={existing}
      />
    </div>
  )
}
