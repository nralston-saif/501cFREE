'use client'

import { useState, useTransition } from 'react'
import {
  createProgramArea,
  deleteProgramArea,
  moveProgramArea,
  setProgramAreaActive,
  updateProgramArea,
  type SettingsActionState,
} from '@/lib/actions/settings'
import { slugifyProgramArea } from '@/lib/program-areas'
import type { ProgramArea } from '@/lib/supabase/types/database'

// Admin editor for the organization's program areas: the tags grant
// proposals carry (and the public intake form submits). A slug is fixed once
// any proposal uses it, because records store the slug itself.

export default function ProgramAreasCard({
  areas,
  usedSlugs,
}: {
  areas: ProgramArea[]
  /** Slugs referenced by at least one proposal */
  usedSlugs: string[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [pending, startTransition] = useTransition()
  const used = new Set(usedSlugs)

  function run(action: () => Promise<SettingsActionState>, after?: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) setError(result.error)
      else after?.()
    })
  }

  return (
    <div className="card p-6">
      <h2 className="font-medium text-gray-900">Program areas</h2>
      <p className="text-sm text-gray-400 mb-4">
        The areas your grantmaking is organized around. Proposals and awards are tagged with them,
        and the public proposal form submits their slugs.
      </p>

      {areas.length === 0 ? (
        <p className="text-sm text-gray-500 mb-4">No program areas yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border border-gray-100 rounded-md mb-4">
          {areas.map((area, index) => (
            <li key={area.slug} className="px-3 py-2">
              {editing === area.slug ? (
                <form
                  className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-start"
                  action={(formData) =>
                    run(() => updateProgramArea(formData), () => setEditing(null))
                  }
                >
                  <input type="hidden" name="slug" value={area.slug} />
                  <input
                    name="label"
                    defaultValue={area.label}
                    required
                    className="input"
                    aria-label="Label"
                  />
                  <input
                    name="new_slug"
                    defaultValue={area.slug}
                    disabled={used.has(area.slug)}
                    pattern="[a-z0-9][a-z0-9_-]*"
                    title={used.has(area.slug) ? 'Used by proposals; the slug can no longer change' : 'Lowercase letters, digits, - or _'}
                    className="input font-mono text-xs"
                    aria-label="Slug"
                  />
                  <div className="flex gap-2">
                    <button type="submit" disabled={pending} className="btn btn-primary text-sm">
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(null)}
                      className="btn btn-secondary text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                  <textarea
                    name="description"
                    defaultValue={area.description ?? ''}
                    rows={2}
                    placeholder="Description (optional; helps the AI features judge fit)"
                    aria-label="Description"
                    className="input sm:col-span-3"
                  />
                </form>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <button
                      type="button"
                      aria-label={`Move ${area.label} up`}
                      disabled={pending || index === 0}
                      onClick={() => run(() => moveProgramArea(area.slug, 'up'))}
                      className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs leading-none"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${area.label} down`}
                      disabled={pending || index === areas.length - 1}
                      onClick={() => run(() => moveProgramArea(area.slug, 'down'))}
                      className="text-gray-400 hover:text-gray-700 disabled:opacity-30 text-xs leading-none"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${area.is_active ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                      {area.label}
                      <span className="ml-2 font-mono text-xs text-gray-400">{area.slug}</span>
                    </p>
                    {area.description && (
                      <p className="text-xs text-gray-500 truncate">{area.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setEditing(area.slug)}
                      className="text-gray-500 hover:text-gray-900 underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => run(() => setProgramAreaActive(area.slug, !area.is_active))}
                      className="text-gray-500 hover:text-gray-900 underline"
                    >
                      {area.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                    {!used.has(area.slug) && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => {
                          if (confirm(`Delete "${area.label}"?`)) run(() => deleteProgramArea(area.slug))
                        }}
                        className="text-red-600 hover:text-red-800 underline"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        className="flex flex-col sm:flex-row gap-2"
        action={(formData) => run(() => createProgramArea(formData), () => setNewLabel(''))}
      >
        <input
          name="label"
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          required
          placeholder="New program area, e.g. Early literacy"
          aria-label="New program area"
          className="input flex-1"
        />
        <input
          name="slug"
          readOnly
          tabIndex={-1}
          value={slugifyProgramArea(newLabel)}
          className="input sm:w-48 font-mono text-xs text-gray-500"
          aria-label="Slug (generated)"
        />
        <button type="submit" disabled={pending || !newLabel.trim()} className="btn btn-primary text-sm">
          Add
        </button>
      </form>

      {error && (
        <div className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
