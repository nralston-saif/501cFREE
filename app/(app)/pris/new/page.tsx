import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { loadContactOptions } from '@/lib/contacts/options'
import { createPri } from '@/lib/actions/pris'
import PageHeader from '@/components/PageHeader'
import ApplicantSelect from '@/components/ApplicantSelect'
import MoneyInput from '@/components/MoneyInput'
import SubmitButton from '@/components/SubmitButton'
import { INSTRUMENT_LABELS } from '../instruments'
import type { PriInstrument } from '@/lib/supabase/types/database'
import ActionForm from '@/components/ActionForm'
import { getOrgSettings } from '@/lib/settings'
import { formatCents } from '@/lib/utils/money'

const INSTRUMENTS = Object.keys(INSTRUMENT_LABELS) as PriInstrument[]

export default async function NewPriPage() {
  const supabase = await createClient()
  const [{ pri_board_approval_threshold_cents: boardThreshold }, contacts] = await Promise.all([
    getOrgSettings(supabase),
    loadContactOptions(supabase),
  ])

  return (
    <div className="max-w-2xl">
      <PageHeader
        title="Record program-related investment"
        description="Recorded as committed. Funding is unlocked once the mission-alignment memo is complete and the executed instrument is attached."
      />

      <ActionForm action={createPri} className="card p-6 space-y-5">
        <div>
          <label
            htmlFor="recipient_contact_id"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            PRI recipient *
          </label>
          <ApplicantSelect
            id="recipient_contact_id"
            name="recipient_contact_id"
            contacts={contacts}
            required
            placeholder="Select PRI recipient…"
          />
          <p className="text-xs text-gray-400 mt-1">
            The company or organization receiving the investment. Type a name and pick a match —
            or create it right here if it&apos;s new.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="instrument" className="block text-sm font-medium text-gray-700 mb-1">
              Instrument *
            </label>
            <select id="instrument" name="instrument" required className="input">
              {INSTRUMENTS.map((i) => (
                <option key={i} value={i}>
                  {INSTRUMENT_LABELS[i]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="amount" className="block text-sm font-medium text-gray-700 mb-1">
              Amount *
            </label>
            <MoneyInput id="amount" name="amount" required />
          </div>
        </div>

        <div>
          <label htmlFor="purpose" className="block text-sm font-medium text-gray-700 mb-1">
            Purpose
          </label>
          <input
            id="purpose"
            name="purpose"
            type="text"
            placeholder="One line on what this investment advances"
            className="input"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="investment_date"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Investment date
            </label>
            <input id="investment_date" name="investment_date" type="date" className="input" />
            <p className="text-xs text-gray-400 mt-1">When the instrument was signed.</p>
          </div>
          <div>
            <label
              htmlFor="board_approval_date"
              className="block text-sm font-medium text-gray-700 mb-1"
            >
              Board approved
            </label>
            <input
              id="board_approval_date"
              name="board_approval_date"
              type="date"
              className="input"
            />
            <p className="text-xs text-gray-400 mt-1">
              {boardThreshold == null
                ? 'Optional: no board-approval threshold is set.'
                : `Optional — required to fund investments of ${formatCents(boardThreshold)} or more.`}
            </p>
          </div>
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-700 mb-1">
            Notes
          </label>
          <textarea id="notes" name="notes" rows={3} className="input" />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <SubmitButton pendingLabel="Recording…">Record PRI</SubmitButton>
          <Link href="/pris" className="btn btn-secondary">
            Cancel
          </Link>
        </div>
      </ActionForm>
    </div>
  )
}
