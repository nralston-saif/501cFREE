import { createClient } from '@/lib/supabase/server'
import { loadContactOptions } from '@/lib/contacts/options'
import { fetchAll } from '@/lib/supabase/fetch-all'
import type { Expense } from '@/lib/supabase/types/database'
import PageHeader from '@/components/PageHeader'
import BulkInvoiceUpload from './BulkInvoiceUpload'
import { isScriptedAi } from '@/lib/ai/demo'
import { getOrgSettings } from '@/lib/settings'
import { todayInTimeZone, utcDateDaysAgo } from '@/lib/utils/dates'
import DemoInvoiceUpload from './DemoInvoiceUpload'

type ExistingExpense = Pick<Expense, 'id' | 'amount_cents' | 'expense_date' | 'description' | 'vendor_contact_id'>

const DESCRIPTION =
  "Drop in a batch of files. Claude reads each one, you review the list, then create the expenses in one go. Each file is saved as that expense's receipt."

export default async function UploadInvoicesPage() {
  const supabase = await createClient()

  // Demo mode without a key: sample readings built in the browser, nothing uploaded or saved
  if (isScriptedAi()) {
    const [{ data: categories }, settings] = await Promise.all([
      supabase.from('expense_categories').select('name').eq('is_active', true).order('name'),
      getOrgSettings(supabase),
    ])
    return (
      <div className="max-w-5xl">
        <PageHeader title="Upload invoices & receipts" description={DESCRIPTION} />
        <DemoInvoiceUpload
          categoryNames={(categories ?? []).map((c) => c.name)}
          today={todayInTimeZone(settings.timezone)}
        />
      </div>
    )
  }

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
      <PageHeader title="Upload invoices & receipts" description={DESCRIPTION} />
      <BulkInvoiceUpload
        categories={categories ?? []}
        vendors={vendors}
        existingExpenses={existing}
      />
    </div>
  )
}
