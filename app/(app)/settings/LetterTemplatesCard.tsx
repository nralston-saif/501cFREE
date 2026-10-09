'use client'

import { useActionState, useState } from 'react'
import SubmitButton from '@/components/SubmitButton'
import { updateLetterTemplatesAction, type SettingsActionState } from '@/lib/actions/settings'
import {
  DEFAULT_LETTER_TEMPLATES,
  LETTER_PLACEHOLDERS,
  LETTER_TEMPLATE_GROUPS,
  LETTER_TEMPLATE_GROUP_LABELS,
  type LetterTemplate,
  type LetterTemplateGroup,
} from '@/lib/pdf/letter-templates'

const initialState: SettingsActionState = { error: null, ok: false }

/**
 * Settings → Acknowledgement letters: the opening and tax paragraphs per
 * vehicle group, prefilled with the saved wording or the defaults. The
 * 501(c)(3) status sentence and the goods-or-services statement are always
 * added by the app (lib/pdf/letter-data.ts).
 */
export default function LetterTemplatesCard({
  templates,
}: {
  /** The wording in force per group (saved override, else default) */
  templates: Record<LetterTemplateGroup, LetterTemplate>
}) {
  const [state, formAction] = useActionState(updateLetterTemplatesAction, initialState)
  const [values, setValues] = useState(templates)

  const set = (group: LetterTemplateGroup, field: keyof LetterTemplate, text: string) =>
    setValues((prev) => ({ ...prev, [group]: { ...prev[group], [field]: text } }))

  return (
    <form action={formAction} className="card p-6">
      <h2 className="font-medium text-gray-900 mb-1">Acknowledgement letters</h2>
      <p className="text-xs text-gray-500 mb-2">
        The wording of the opening and tax paragraphs, by how the gift was made. Every letter also
        states your 501(c)(3) status and whether any goods or services were provided. The defaults
        are a starting point based on IRS publications, not legal advice: have your accountant or
        counsel review them. Letters already sent keep the wording they were sent with.
      </p>
      <details className="mb-4 text-xs text-gray-500">
        <summary className="cursor-pointer text-gray-700">Placeholders</summary>
        <ul className="mt-2 space-y-0.5">
          {Object.entries(LETTER_PLACEHOLDERS).map(([name, help]) => (
            <li key={name}>
              <code className="text-gray-800">{`{${name}}`}</code>: {help}
            </li>
          ))}
        </ul>
      </details>

      <div className="space-y-6">
        {LETTER_TEMPLATE_GROUPS.map((group) => {
          const isDefault =
            values[group].opening === DEFAULT_LETTER_TEMPLATES[group].opening &&
            values[group].tax === DEFAULT_LETTER_TEMPLATES[group].tax
          return (
            <div key={group} className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-medium text-gray-800">
                  {LETTER_TEMPLATE_GROUP_LABELS[group]}
                </h3>
                <button
                  type="button"
                  disabled={isDefault}
                  onClick={() => setValues((prev) => ({ ...prev, [group]: { ...DEFAULT_LETTER_TEMPLATES[group] } }))}
                  className="text-xs text-gray-500 hover:text-gray-900 underline disabled:no-underline disabled:opacity-50"
                >
                  Reset to default
                </button>
              </div>
              <label htmlFor={`${group}.opening`} className="block text-xs font-medium text-gray-600 mb-1">
                Opening paragraph
              </label>
              <textarea
                id={`${group}.opening`}
                name={`${group}.opening`}
                value={values[group].opening}
                onChange={(e) => set(group, 'opening', e.target.value)}
                rows={3}
                required
                className="input mb-3"
              />
              <label htmlFor={`${group}.tax`} className="block text-xs font-medium text-gray-600 mb-1">
                Tax paragraph
              </label>
              <textarea
                id={`${group}.tax`}
                name={`${group}.tax`}
                value={values[group].tax}
                onChange={(e) => set(group, 'tax', e.target.value)}
                rows={3}
                placeholder="Empty: the letter states only your tax-exempt status"
                className="input"
              />
            </div>
          )
        })}
      </div>

      {state.error && (
        <div className="mt-4 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {state.error}
        </div>
      )}
      <div className="mt-6 flex items-center gap-3">
        <SubmitButton>Save letter wording</SubmitButton>
        {state.ok && <span className="text-sm text-green-700">Saved</span>}
      </div>
    </form>
  )
}
