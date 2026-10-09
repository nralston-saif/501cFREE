import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadContactOptions } from '@/lib/contacts/options'
import { createAward } from '@/lib/actions/grants-out'
import PageHeader from '@/components/PageHeader'
import ContactSelect from '@/components/ContactSelect'
import MoneyInput from '@/components/MoneyInput'
import SubmitButton from '@/components/SubmitButton'
import ActionForm from '@/components/ActionForm'

export default async function NewAwardPage() {
  const supabase = await createClient()
  const contacts = await loadContactOptions(supabase)

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Record award"
        description="Record a grant made directly, without a tracked proposal."
      />

      <ActionForm action={createAward} className="card p-6 space-y-5">
        <div>
          <label
            htmlFor="grantee_contact_id"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            Grantee *
          </label>
          <ContactSelect id="grantee_contact_id" name="grantee_contact_id" contacts={contacts} required />
        </div>

        <div>
          <label htmlFor="purpose" className="block text-sm font-medium text-gray-700 mb-1">
            Purpose
          </label>
          <input id="purpose" name="purpose" type="text" className="input" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="amount_awarded" className="block text-sm font-medium text-gray-700 mb-1">
              Amount awarded *
            </label>
            <MoneyInput id="amount_awarded" name="amount_awarded" required />
          </div>
          <div>
            <label htmlFor="award_date" className="block text-sm font-medium text-gray-700 mb-1">
              Award date
            </label>
            <input id="award_date" name="award_date" type="date" className="input" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="restriction" className="block text-sm font-medium text-gray-700 mb-1">
              Restriction
            </label>
            <input
              id="restriction"
              name="restriction"
              type="text"
              placeholder="e.g. restricted to program X"
              className="input"
            />
          </div>
          <div>
            <label
              htmlFor="agreement_signed_date"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Agreement signed
            </label>
            <input
              id="agreement_signed_date"
              name="agreement_signed_date"
              type="date"
              className="input"
            />
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea id="notes" name="notes" rows={3} className="input" />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <SubmitButton pendingLabel="Recording…">Record award</SubmitButton>
          <Link href="/grants-out?tab=awards" className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </ActionForm>
    </div>
  )
}
