import VendorSelect from '@/components/VendorSelect'
import HelpTip from '@/components/HelpTip'
import MoneyInput from '@/components/MoneyInput'
import { centsToDollarString } from '@/lib/utils/money'
import { todayISO } from '@/lib/utils/dates'
import { FUNCTIONAL_CLASS_LABELS, FUNCTIONAL_CLASS_ORDER } from './functional-class'
import type { Expense, ExpenseCategory, ExpensePaymentMethod, ExpenseStatus } from '@/lib/supabase/types/database'

interface ContactOption {
  id: string
  display_name: string
}

interface TeamMemberOption {
  id: string
  full_name: string
}

interface ExpenseFormFieldsProps {
  categories: ExpenseCategory[]
  vendors: ContactOption[]
  teamMembers: TeamMemberOption[]
  expense?: Partial<Expense>
  /** Prefix for element ids, for pages that render this field set more than once. */
  idPrefix?: string
}

const PAYMENT_METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'card', label: 'Card' },
  { value: 'check', label: 'Check' },
  { value: 'ach', label: 'ACH' },
  { value: 'wire', label: 'Wire' },
  { value: 'reimbursement', label: 'Reimbursement' },
]

const STATUSES: { value: ExpenseStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'paid', label: 'Paid' },
  { value: 'reimbursed', label: 'Reimbursed' },
]

const labelClass = 'block text-sm font-medium text-gray-700 mb-1'

/** Shared field set for the new/edit expense forms. Render inside a <form>. */
export default function ExpenseFormFields({
  categories,
  vendors,
  teamMembers,
  expense,
  idPrefix = '',
}: ExpenseFormFieldsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <div>
        <label htmlFor={`${idPrefix}expense_date`} className={labelClass}>
          Date
        </label>
        <input
          id={`${idPrefix}expense_date`}
          type="date"
          name="expense_date"
          required
          defaultValue={expense?.expense_date ?? todayISO()}
          className="input"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}amount`} className={labelClass}>
          Amount
        </label>
        <MoneyInput
          id={`${idPrefix}amount`}
          name="amount"
          required
          defaultValue={expense ? centsToDollarString(expense.amount_cents) : undefined}
        />
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}description`} className={labelClass}>
          Description
        </label>
        <input
          id={`${idPrefix}description`}
          type="text"
          name="description"
          required
          defaultValue={expense?.description ?? ''}
          className="input"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}category_id`} className={labelClass}>
          Category
        </label>
        <select
          id={`${idPrefix}category_id`}
          name="category_id"
          required
          defaultValue={expense?.category_id ?? ''}
          className="input"
        >
          <option value="" disabled>
            Select a category…
          </option>
          {FUNCTIONAL_CLASS_ORDER.map((fc) => {
            const group = categories.filter((c) => c.functional_class === fc)
            if (group.length === 0) return null
            return (
              <optgroup key={fc} label={FUNCTIONAL_CLASS_LABELS[fc]}>
                {group.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.is_active ? '' : ' (inactive)'}
                  </option>
                ))}
              </optgroup>
            )
          })}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}vendor_contact_id`} className={labelClass}>
          Vendor
        </label>
        <VendorSelect
          id={`${idPrefix}vendor_contact_id`}
          name="vendor_contact_id"
          contacts={vendors}
          defaultValue={expense?.vendor_contact_id}
          placeholder="Select a vendor…"
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}payment_method`} className={labelClass}>
          Payment method
        </label>
        <select
          id={`${idPrefix}payment_method`}
          name="payment_method"
          defaultValue={expense?.payment_method ?? ''}
          className="input"
        >
          <option value="">Not specified</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${idPrefix}status`} className={labelClass}>
          Status
        </label>
        <select
          id={`${idPrefix}status`}
          name="status"
          defaultValue={expense?.status ?? 'paid'}
          className="input"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}paid_by`} className={labelClass}>
          Paid personally by (reimbursement)
        </label>
        <select id={`${idPrefix}paid_by`} name="paid_by" defaultValue={expense?.paid_by ?? ''} className="input">
          <option value="">Paid from organization funds</option>
          {teamMembers.map((m) => (
            <option key={m.id} value={m.id}>
              {m.full_name}
            </option>
          ))}
        </select>
        <p className="text-xs text-gray-400 mt-1">
          Only set when a team member fronted the expense personally.
        </p>
      </div>

      <div className="sm:col-span-2">
        <div className="flex items-start gap-2">
          <input
            id={`${idPrefix}is_1099_eligible`}
            type="checkbox"
            name="is_1099_eligible"
            defaultChecked={expense?.is_1099_eligible ?? false}
            className="mt-0.5 h-4 w-4 rounded border-gray-300"
          />
          <div>
            <div className="flex items-center gap-1.5">
              <label htmlFor={`${idPrefix}is_1099_eligible`} className="text-sm font-medium text-gray-700">
                1099 eligible
              </label>
              <HelpTip title="When is an expense 1099-eligible?">
                Generally you must issue a Form 1099-NEC when you pay <strong>$600 or more</strong> in
                a calendar year to an <strong>unincorporated</strong> vendor (individual, sole
                proprietor, partnership, or LLC) for <strong>services</strong>. Exclude payments for
                goods, payments to corporations (except attorneys&rsquo; legal fees), employee wages,
                and reimbursements. When unsure, mark it eligible and confirm with your accountant.
              </HelpTip>
            </div>
            <span className="block text-xs text-gray-400">Track for year-end 1099 reporting</span>
          </div>
        </div>
      </div>

      <div className="sm:col-span-2">
        <label htmlFor={`${idPrefix}notes`} className={labelClass}>
          Notes
        </label>
        <textarea
          id={`${idPrefix}notes`}
          name="notes"
          rows={3}
          defaultValue={expense?.notes ?? ''}
          className="input"
        />
      </div>
    </div>
  )
}
