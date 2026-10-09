'use client'

import { useActionState } from 'react'
import SubmitButton from '@/components/SubmitButton'
import { updateSettingsAction, type SettingsActionState } from '@/lib/actions/settings'
import { centsToDollarString } from '@/lib/utils/money'
import { PUBLIC_CHARITY_STATUS_OPTIONS } from '@/lib/utils/tax-status'
import { GRANT_REVIEW_MODE_LABELS } from '@/lib/grants/voting'
import type { GrantReviewMode } from '@/lib/supabase/types/database'
import type { OrgSettings } from '@/lib/supabase/types/database'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

const initialState: SettingsActionState = { error: null, ok: false }

function Field({
  label,
  htmlFor,
  hint,
  className,
  children,
}: {
  label: string
  /** Id of the control passed as children */
  htmlFor: string
  hint?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="block text-xs font-medium text-gray-600 mb-1">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

export default function OrgSettingsForm({
  settings,
  timeZones,
}: {
  settings: OrgSettings | null
  /** IANA zone names supported by the server runtime */
  timeZones: string[]
}) {
  const [state, formAction] = useActionState(updateSettingsAction, initialState)
  const currentZone = settings?.timezone ?? 'America/New_York'
  const zones = timeZones.includes(currentZone) ? timeZones : [currentZone, ...timeZones]

  return (
    <form action={formAction} className="card p-6">
      <h2 className="font-medium text-gray-900 mb-4">Organization</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field htmlFor="org_legal_name" label="Legal name *" hint="Printed on acknowledgement letters and memoranda">
          <input
            type="text"
            id="org_legal_name"
            name="org_legal_name"
            defaultValue={settings?.org_legal_name ?? ''}
            required
            className="input"
          />
        </Field>
        <Field htmlFor="org_display_name" label="Display name" hint="Short name for the app and email sign-offs">
          <input
            type="text"
            id="org_display_name"
            name="org_display_name"
            defaultValue={settings?.org_display_name ?? ''}
            className="input"
          />
        </Field>

        <Field
          htmlFor="org_aliases"
          label="Other names"
          hint="Spellings that appear on invoices, one per line or comma-separated"
          className="sm:col-span-2"
        >
          <textarea
            id="org_aliases"
            name="org_aliases"
            defaultValue={(settings?.org_aliases ?? []).join('\n')}
            rows={2}
            className="input"
          />
        </Field>

        <Field htmlFor="ein" label="EIN">
          <input
            type="text"
            id="ein"
            name="ein"
            defaultValue={settings?.ein ?? ''}
            className="input"
            placeholder="12-3456789"
          />
        </Field>
        <Field htmlFor="website_url" label="Website">
          <input
            type="text"
            id="website_url"
            name="website_url"
            defaultValue={settings?.website_url ?? ''}
            className="input"
            placeholder="https://example.org"
          />
        </Field>

        <Field htmlFor="address_line1" label="Address line 1">
          <input
            type="text"
            id="address_line1"
            name="address_line1"
            defaultValue={settings?.address_line1 ?? ''}
            className="input"
          />
        </Field>
        <Field htmlFor="address_line2" label="Address line 2">
          <input
            type="text"
            id="address_line2"
            name="address_line2"
            defaultValue={settings?.address_line2 ?? ''}
            className="input"
          />
        </Field>

        <Field htmlFor="city" label="City">
          <input type="text" id="city" name="city" defaultValue={settings?.city ?? ''} className="input" />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field htmlFor="state" label="State">
            <input type="text" id="state" name="state" defaultValue={settings?.state ?? ''} className="input" />
          </Field>
          <Field htmlFor="postal_code" label="Postal code">
            <input
              type="text"
              id="postal_code"
              name="postal_code"
              defaultValue={settings?.postal_code ?? ''}
              className="input"
            />
          </Field>
          <Field htmlFor="country" label="Country">
            <input
              type="text"
              id="country"
              name="country"
              defaultValue={settings?.country ?? 'US'}
              maxLength={2}
              className="input uppercase"
              placeholder="US"
            />
          </Field>
        </div>

        <Field
          htmlFor="mission_statement"
          label="Mission statement"
          hint="Used by the AI research and email-drafting features to judge mission fit"
          className="sm:col-span-2"
        >
          <textarea
            id="mission_statement"
            name="mission_statement"
            defaultValue={settings?.mission_statement ?? ''}
            rows={4}
            className="input"
          />
        </Field>
      </div>

      <h2 className="font-medium text-gray-900 mt-8 mb-4">Calendar and policy</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field htmlFor="timezone" label="Time zone" hint="Sets which calendar day “today” is for dates the app records">
          <select id="timezone" name="timezone" defaultValue={currentZone} className="input">
            {zones.map((zone) => (
              <option key={zone} value={zone}>
                {zone.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="fiscal_year_start_month" label="Fiscal year start month">
          <select
            id="fiscal_year_start_month"
            name="fiscal_year_start_month"
            defaultValue={String(settings?.fiscal_year_start_month ?? 1)}
            className="input"
          >
            {MONTH_NAMES.map((month, index) => (
              <option key={month} value={String(index + 1)}>
                {month}
              </option>
            ))}
          </select>
        </Field>
        <Field
          htmlFor="pri_board_approval_threshold"
          label="PRI board-approval threshold ($)"
          hint="Program-related investments at or above this amount need a board approval date before funding. Leave blank for no requirement."
          className="sm:col-span-2"
        >
          <input
            type="text"
            inputMode="decimal"
            id="pri_board_approval_threshold"
            name="pri_board_approval_threshold"
            defaultValue={
              settings?.pri_board_approval_threshold_cents != null
                ? centsToDollarString(settings.pri_board_approval_threshold_cents)
                : ''
            }
            className="input sm:max-w-xs"
            placeholder="No requirement"
          />
        </Field>
      </div>

      <h2 className="font-medium text-gray-900 mt-8 mb-4">Grant review</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          htmlFor="grant_review_mode"
          label="Who votes on and advances grant proposals"
          hint="Votes stay hidden until all of these people have voted or recused. Making awards and paying them is always for admins."
          className="sm:col-span-2"
        >
          <select
            id="grant_review_mode"
            name="grant_review_mode"
            defaultValue={settings?.grant_review_mode ?? 'all_members'}
            className="input sm:max-w-xs"
          >
            {(Object.keys(GRANT_REVIEW_MODE_LABELS) as GrantReviewMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {GRANT_REVIEW_MODE_LABELS[mode]}
                {mode === 'all_members' ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <h2 className="font-medium text-gray-900 mt-8 mb-1">Acknowledgement letters</h2>
      <p className="text-xs text-gray-400 mb-4">
        EIN and a letter signatory are required before acknowledgement letters can be generated.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          htmlFor="public_charity_status"
          label="IRS classification"
          hint="As shown on your IRS determination letter. Letters name it after your 501(c)(3) status; leave unspecified to mention 501(c)(3) only."
          className="sm:col-span-2"
        >
          <select
            id="public_charity_status"
            name="public_charity_status"
            defaultValue={settings?.public_charity_status ?? ''}
            className="input sm:max-w-md"
          >
            <option value="">Not specified</option>
            {PUBLIC_CHARITY_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field htmlFor="letter_signatory_name" label="Signatory name">
          <input
            type="text"
            id="letter_signatory_name"
            name="letter_signatory_name"
            defaultValue={settings?.letter_signatory_name ?? ''}
            className="input"
          />
        </Field>
        <Field htmlFor="letter_signatory_title" label="Signatory title">
          <input
            type="text"
            id="letter_signatory_title"
            name="letter_signatory_title"
            defaultValue={settings?.letter_signatory_title ?? ''}
            className="input"
          />
        </Field>
        <Field htmlFor="letter_from_email" label="From email">
          <input
            type="email"
            id="letter_from_email"
            name="letter_from_email"
            defaultValue={settings?.letter_from_email ?? ''}
            className="input"
          />
        </Field>
        <Field htmlFor="letter_closing_text" label="Closing text" className="sm:col-span-2">
          <textarea
            id="letter_closing_text"
            name="letter_closing_text"
            defaultValue={settings?.letter_closing_text ?? ''}
            rows={3}
            className="input"
          />
        </Field>
      </div>

      {state.error && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <div className="mt-6 flex items-center gap-3">
        <SubmitButton>Save settings</SubmitButton>
        {state.ok && <span className="text-sm text-green-700">Saved</span>}
      </div>
    </form>
  )
}
