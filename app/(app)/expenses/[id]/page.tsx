import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PageHeader from '@/components/PageHeader'
import StatusBadge from '@/components/StatusBadge'
import SubmitButton from '@/components/SubmitButton'
import AttachmentsPanel from '@/components/AttachmentsPanel'
import { updateExpense } from '@/lib/actions/expenses'
import { formatCents } from '@/lib/utils/money'
import { formatDate } from '@/lib/utils/dates'
import ExpenseFormFields from '../ExpenseFormFields'
import DeleteExpenseButton from './DeleteExpenseButton'
import QboSyncPanel from './QboSyncPanel'
import ActionForm from '@/components/ActionForm'
import { fetchAll } from '@/lib/supabase/fetch-all'

export default async function ExpenseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Everything only needs the id, so it loads in one round trip
  const [{ data: expense }, { data: categories }, vendors, { data: teamMembers }, { data: attachments }] =
    await Promise.all([
      supabase.from('expenses').select('*').eq('id', id).maybeSingle(),
      supabase.from('expense_categories').select('*').order('name'),
      // Vendor picker: every vendor, past max_rows
      fetchAll<{ id: string; display_name: string }>(() =>
        supabase
          .from('contacts')
          .select('id, display_name')
          .eq('is_vendor', true)
          .order('display_name')
          .order('id')
      ),
      supabase.from('team_members').select('id, full_name').order('full_name'),
      supabase
        .from('attachments')
        .select('*')
        .eq('entity_type', 'expense')
        .eq('entity_id', id)
        .order('created_at', { ascending: false }),
    ])

  if (!expense) notFound()

  return (
    <div className="max-w-2xl">
      <PageHeader
        title={expense.description}
        description={`${formatDate(expense.expense_date)} · ${formatCents(expense.amount_cents)}`}
      >
        <StatusBadge status={expense.status} />
      </PageHeader>

      <div className="space-y-6">
        <ActionForm action={updateExpense.bind(null, id)} className="card p-6">
          <ExpenseFormFields
            categories={categories ?? []}
            vendors={vendors}
            teamMembers={teamMembers ?? []}
            expense={expense}
          />

          <div className="flex items-center justify-end mt-6">
            <SubmitButton>Save changes</SubmitButton>
          </div>
        </ActionForm>

        <AttachmentsPanel
          entityType="expense"
          entityId={id}
          attachments={attachments ?? []}
          revalidatePath={`/expenses/${id}`}
          title="Receipts"
        />

        <QboSyncPanel expense={expense} />

        {expense.disbursement_id ? (
          <div className="card p-4 bg-blue-50 border-blue-100 text-sm text-blue-800">
            Auto-created from a grant disbursement. Delete the disbursement to remove this
            expense.
          </div>
        ) : (
          <div className="card p-5 flex items-center justify-between gap-4">
            <p className="text-sm text-gray-500">
              Permanently remove this expense and its history.
            </p>
            <DeleteExpenseButton expenseId={id} />
          </div>
        )}
      </div>
    </div>
  )
}
