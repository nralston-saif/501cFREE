import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadContactOptions } from '@/lib/contacts/options'
import { createProposal } from '@/lib/actions/grants-out'
import PageHeader from '@/components/PageHeader'
import ApplicantSelect from '@/components/ApplicantSelect'
import MoneyInput from '@/components/MoneyInput'
import SubmitButton from '@/components/SubmitButton'
import ProgramAreaCheckboxes from '@/components/ProgramAreaCheckboxes'
import { formatDate } from '@/lib/utils/dates'
import { orgToday } from '@/lib/settings'
import { loadProgramAreas, type ProgramAreaOption } from '@/lib/program-areas'
import LetterUploadForm from './LetterUploadForm'
import ActionForm from '@/components/ActionForm'

type Contact = { id: string; display_name: string }

function ProposalFields({
  contacts,
  programAreas,
  enteredDateDisplay,
}: {
  contacts: Contact[]
  programAreas: ProgramAreaOption[]
  enteredDateDisplay: string
}) {
  return (
    <>
      <div>
        <label
          htmlFor="applicant_contact_id"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Applicant *
        </label>
        <ApplicantSelect id="applicant_contact_id" name="applicant_contact_id" contacts={contacts} required />
      </div>

      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-1">
          Title *
        </label>
        <input id="title" name="title" type="text" required className="input" />
      </div>

      <div>
        <label htmlFor="summary" className="block text-sm font-medium text-gray-700 mb-1">
          Summary
        </label>
        <textarea id="summary" name="summary" rows={4} className="input" />
      </div>

      <ProgramAreaCheckboxes areas={programAreas} />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="amount_requested" className="block text-sm font-medium text-gray-700 mb-1">
            Amount Requested/Suggested *
          </label>
          <MoneyInput id="amount_requested" name="amount_requested" required />
        </div>
        <div>
          <label htmlFor="source" className="block text-sm font-medium text-gray-700 mb-1">
            Source
          </label>
          <input
            id="source"
            name="source"
            type="text"
            placeholder="e.g. email, referral"
            className="input"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="received_date" className="block text-sm font-medium text-gray-700 mb-1">
            Received date
          </label>
          <input id="received_date" name="received_date" type="date" className="input" />
        </div>
        <div>
          <span className="block text-sm font-medium text-gray-700 mb-1">Entered</span>
          <div className="input bg-gray-50 text-gray-600 cursor-not-allowed">
            {enteredDateDisplay}
          </div>
        </div>
      </div>
    </>
  )
}

export default async function NewProposalPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  const activeTab: 'manual' | 'upload' = tab === 'upload' ? 'upload' : 'manual'

  const supabase = await createClient()
  const [contacts, programAreas, today] = await Promise.all([
    loadContactOptions(supabase),
    loadProgramAreas(supabase, { activeOnly: true }),
    orgToday(supabase),
  ])
  const enteredDateDisplay = formatDate(today)

  const tabs = [
    { key: 'manual' as const, label: 'Manual entry', href: '/grants-out/new?tab=manual' },
    { key: 'upload' as const, label: 'Upload letter', href: '/grants-out/new?tab=upload' },
  ]

  return (
    <div className={activeTab === 'upload' ? 'max-w-6xl' : 'max-w-2xl'}>
      <PageHeader
        title="New proposal"
        description="Start a grant proposal from inside the team. It skips review and begins in Diligence."
      />

      <p className="text-sm text-gray-500 mb-4">
        Create the applicant as a{' '}
        <Link href="/contacts/new" className="text-gray-900 underline hover:no-underline">
          contact
        </Link>{' '}
        first if needed.
      </p>

      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === t.key
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {activeTab === 'manual' ? (
        <ActionForm action={createProposal} className="card p-6 space-y-5">
          <ProposalFields
            contacts={contacts}
            programAreas={programAreas}
            enteredDateDisplay={enteredDateDisplay}
          />

          <div className="flex items-center gap-3 pt-2">
            <SubmitButton pendingLabel="Creating…">Create proposal</SubmitButton>
            <Link href="/grants-out" className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </ActionForm>
      ) : (
        <LetterUploadForm
          contacts={contacts}
          programAreas={programAreas}
          enteredDateDisplay={enteredDateDisplay}
        />
      )}
    </div>
  )
}
