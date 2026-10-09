'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import {
  createPerson,
  createTag,
  findPossibleDuplicates,
  type DuplicateMatch,
  type RoleFlags,
  type TagOption,
} from '@/lib/actions/crm-create'
import { RELATIONSHIP_LABELS, RELATIONSHIP_OPTIONS, ROLE_FLAGS, initials } from '@/lib/contacts/crm'
import type { AffiliationRelationship } from '@/lib/supabase/types/database'

type Option = { id: string; name: string }

const EMPTY = {
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  title: '',
  linkedin_url: '',
  twitter_url: '',
  city: '',
  state: '',
  country: '',
  description: '',
  first_met_date: '',
  how_we_met: '',
  relationship_notes: '',
}

const DEFAULT_TAG_COLOR = '#6B7280'

/** Close a dropdown when clicking outside it. */
function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void) {
  useEffect(() => {
    const handle = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', handle)
    return () => document.removeEventListener('mousedown', handle)
  }, [ref, onOutside])
}

/** Type-ahead over a fixed list: shows the picked option as a chip. */
function TypeAhead({
  id,
  options,
  value,
  onChange,
  placeholder,
  onCreate,
}: {
  id: string
  options: Option[]
  value: Option | null
  onChange: (option: Option | null) => void
  placeholder: string
  /** Offer "+ Create "…"" when nothing matches exactly */
  onCreate?: (name: string) => void
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  if (value) {
    return (
      <div className="input flex items-center justify-between gap-2">
        <span className="truncate">{value.name}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-gray-400 hover:text-gray-600 flex-shrink-0"
          aria-label={`Clear ${value.name}`}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const matches = (q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options).slice(0, 10)
  const exact = options.some((o) => o.name.toLowerCase() === q)

  return (
    <div className="relative" ref={ref}>
      <input
        id={id}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter') {
            e.preventDefault()
            if (matches[0]) onChange(matches[0])
          }
        }}
        className="input"
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && (matches.length > 0 || (onCreate && q && !exact)) && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
          {matches.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onChange(o)
                setQuery('')
                setOpen(false)
              }}
              className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
            >
              {o.name}
            </button>
          ))}
          {onCreate && q && !exact && (
            <button
              type="button"
              onClick={() => {
                onCreate(query.trim())
                setQuery('')
                setOpen(false)
              }}
              className="w-full px-3 py-2 text-left text-sm text-blue-600 font-medium hover:bg-blue-50 border-t border-gray-100"
            >
              + Create &ldquo;{query.trim()}&rdquo;
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function AddPersonModal({
  people,
  organizations,
  tags,
  onClose,
}: {
  /** Everyone, for the "Introduced by" picker */
  people: Option[]
  organizations: Option[]
  tags: TagOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const id = useId()
  const [form, setForm] = useState(EMPTY)
  const [roles, setRoles] = useState<RoleFlags>({})
  const [organization, setOrganization] = useState<Option | null>(null)
  const [creatingOrganization, setCreatingOrganization] = useState(false)
  const [newOrganizationName, setNewOrganizationName] = useState('')
  const [relationship, setRelationship] = useState<AffiliationRelationship>('employee')
  const [affiliationTitle, setAffiliationTitle] = useState('')
  const [introducedBy, setIntroducedBy] = useState<Option | null>(null)

  const [availableTags, setAvailableTags] = useState<TagOption[]>(tags)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagQuery, setTagQuery] = useState('')
  const [showTagDropdown, setShowTagDropdown] = useState(false)
  const [creatingTag, setCreatingTag] = useState(false)
  const tagRef = useRef<HTMLDivElement>(null)
  useClickOutside(tagRef, () => setShowTagDropdown(false))

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])

  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  const hasOrganization = creatingOrganization ? !!newOrganizationName.trim() : !!organization
  const fullName = `${form.first_name} ${form.last_name}`.trim()
  const emailTaken = duplicates.some((d) => d.reason === 'email')

  const close = () => {
    if (!saving) onClose()
  }

  const addTag = async (raw: string) => {
    const name = raw.trim().toLowerCase()
    if (!name) return
    const existing = availableTags.find((t) => t.name.toLowerCase() === name)
    if (existing) {
      if (!selectedTags.includes(existing.name)) setSelectedTags((s) => [...s, existing.name])
    } else {
      setCreatingTag(true)
      const result = await createTag(name)
      setCreatingTag(false)
      if (!result.ok) {
        showToast(result.error, 'error')
        return
      }
      setAvailableTags((t) => [...t, result.tag])
      setSelectedTags((s) => (s.includes(result.tag.name) ? s : [...s, result.tag.name]))
    }
    setTagQuery('')
    setShowTagDropdown(false)
  }

  const save = async (skipDuplicateCheck: boolean) => {
    if (!form.first_name.trim()) {
      setError('First name is required')
      return
    }
    setSaving(true)
    setError(null)

    if (!skipDuplicateCheck) {
      const check = await findPossibleDuplicates({
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
      })
      if (check.ok && check.matches.length > 0) {
        setDuplicates(check.matches)
        setSaving(false)
        return
      }
    }

    const result = await createPerson({
      ...form,
      roles,
      tags: selectedTags,
      introduced_by: introducedBy?.id ?? null,
      organization: creatingOrganization
        ? newOrganizationName.trim()
          ? { name: newOrganizationName.trim() }
          : null
        : organization
        ? { id: organization.id }
        : null,
      relationship,
      affiliation_title: affiliationTitle || null,
    })
    if (!result.ok) {
      setError(result.error)
      setSaving(false)
      return
    }
    showToast(
      result.organization
        ? `${result.person.display_name} was added at ${result.organization.display_name}`
        : `${result.person.display_name} was added`,
      'success'
    )
    // Usually the next step is taking notes, so go straight to the profile
    router.push(`/people/${result.person.id}`)
  }

  const tagMatches = availableTags
    .filter((t) => t.name.toLowerCase().includes(tagQuery.toLowerCase()) && !selectedTags.includes(t.name))
    .slice(0, 10)
  const tagExists = availableTags.some((t) => t.name.toLowerCase() === tagQuery.trim().toLowerCase())

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4" onClick={close}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${id}-title`}
          className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-start justify-between">
              <div>
                <h2 id={`${id}-title`} className="text-xl font-semibold text-gray-900">
                  Add New Person
                </h2>
                <p className="text-sm text-gray-500 mt-1">Add someone to your network</p>
              </div>
              <button type="button" onClick={close} className="text-gray-400 hover:text-gray-600 p-2 -m-2" aria-label="Close">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <form
            id={`${id}-form`}
            onSubmit={(e) => {
              e.preventDefault()
              save(false)
            }}
            className="p-6 space-y-6 overflow-y-auto"
          >
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-first`} className="block text-sm font-medium text-gray-700 mb-1.5">
                  First name <span className="text-red-500">*</span>
                </label>
                <input
                  id={`${id}-first`}
                  type="text"
                  required
                  autoFocus
                  value={form.first_name}
                  onChange={set('first_name')}
                  className="input"
                  placeholder="First name"
                />
              </div>
              <div>
                <label htmlFor={`${id}-last`} className="block text-sm font-medium text-gray-700 mb-1.5">
                  Last name
                </label>
                <input
                  id={`${id}-last`}
                  type="text"
                  value={form.last_name}
                  onChange={set('last_name')}
                  className="input"
                  placeholder="Last name"
                />
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-email`} className="block text-sm font-medium text-gray-700 mb-1.5">
                  Email
                </label>
                <input
                  id={`${id}-email`}
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  className="input"
                  placeholder="name@example.org"
                />
              </div>
              <div>
                <label htmlFor={`${id}-phone`} className="block text-sm font-medium text-gray-700 mb-1.5">
                  Phone
                </label>
                <input
                  id={`${id}-phone`}
                  type="tel"
                  value={form.phone}
                  onChange={set('phone')}
                  className="input"
                  placeholder="+1 (555) 123-4567"
                />
              </div>
            </div>

            <div>
              <label htmlFor={`${id}-title-field`} className="block text-sm font-medium text-gray-700 mb-1.5">
                Title
              </label>
              <input
                id={`${id}-title-field`}
                type="text"
                value={form.title}
                onChange={set('title')}
                className="input"
                placeholder="Job title or role"
              />
            </div>

            {/* Organization link */}
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                  <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
                    />
                  </svg>
                  Link to organization (optional)
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCreatingOrganization((c) => !c)
                    setOrganization(null)
                    setNewOrganizationName('')
                  }}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                >
                  {creatingOrganization ? 'Select existing' : '+ Create new'}
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label htmlFor={`${id}-org`} className="block text-sm font-medium text-gray-600 mb-1.5">
                    Organization
                  </label>
                  {creatingOrganization ? (
                    <input
                      id={`${id}-org`}
                      type="text"
                      value={newOrganizationName}
                      onChange={(e) => setNewOrganizationName(e.target.value)}
                      className="input"
                      placeholder="New organization name"
                    />
                  ) : (
                    <TypeAhead
                      id={`${id}-org`}
                      options={organizations}
                      value={organization}
                      onChange={setOrganization}
                      placeholder="Search organizations..."
                      onCreate={(name) => {
                        setCreatingOrganization(true)
                        setNewOrganizationName(name)
                      }}
                    />
                  )}
                </div>
                <div>
                  <label htmlFor={`${id}-relationship`} className="block text-sm font-medium text-gray-600 mb-1.5">
                    Relationship
                  </label>
                  <select
                    id={`${id}-relationship`}
                    value={relationship}
                    onChange={(e) => setRelationship(e.target.value as AffiliationRelationship)}
                    className="input"
                    disabled={!hasOrganization}
                  >
                    {RELATIONSHIP_OPTIONS.map((r) => (
                      <option key={r} value={r}>
                        {RELATIONSHIP_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`${id}-aff-title`} className="block text-sm font-medium text-gray-600 mb-1.5">
                    Title there
                  </label>
                  <input
                    id={`${id}-aff-title`}
                    type="text"
                    value={affiliationTitle}
                    onChange={(e) => setAffiliationTitle(e.target.value)}
                    className="input"
                    placeholder={form.title || 'Same as title'}
                    disabled={!hasOrganization}
                  />
                </div>
              </div>
            </div>

            {/* Roles */}
            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 mb-1.5">Roles</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {ROLE_FLAGS.map(({ flag, label }) => (
                  <label key={flag} className="flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={roles[flag] === true}
                      onChange={(e) => setRoles((r) => ({ ...r, [flag]: e.target.checked }))}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Tags */}
            <div className="p-4 bg-purple-50 rounded-lg border border-purple-100 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-purple-800">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
                  />
                </svg>
                Tags (optional)
              </div>

              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {selectedTags.map((tag) => {
                    const color = availableTags.find((t) => t.name === tag)?.color || DEFAULT_TAG_COLOR
                    return (
                      <span
                        key={tag}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-white"
                        style={{ backgroundColor: color }}
                      >
                        {tag}
                        <button
                          type="button"
                          onClick={() => setSelectedTags((s) => s.filter((t) => t !== tag))}
                          className="hover:bg-white/20 rounded-full p-0.5"
                          aria-label={`Remove tag ${tag}`}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}

              <div className="relative" ref={tagRef}>
                <input
                  type="text"
                  value={tagQuery}
                  onChange={(e) => {
                    setTagQuery(e.target.value)
                    setShowTagDropdown(true)
                  }}
                  onFocus={() => setShowTagDropdown(true)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (tagQuery.trim()) addTag(tagQuery)
                    }
                    if (e.key === 'Escape') setShowTagDropdown(false)
                  }}
                  aria-label="Search or create tags"
                  autoComplete="off"
                  className="input pr-8"
                  placeholder={selectedTags.length > 0 ? 'Add more tags...' : 'Search or create tags...'}
                />
                <button
                  type="button"
                  onClick={() => setShowTagDropdown((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Show tags"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${showTagDropdown ? 'rotate-180' : ''}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showTagDropdown && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {tagQuery.trim() && !tagExists && (
                      <button
                        type="button"
                        disabled={creatingTag}
                        onClick={() => addTag(tagQuery)}
                        className="w-full px-3 py-2 text-left hover:bg-purple-50 flex items-center gap-2 border-b border-gray-100 text-purple-600 font-medium text-sm"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        {creatingTag ? 'Creating...' : `Create "${tagQuery.trim()}"`}
                      </button>
                    )}
                    {tagMatches.map((tag) => (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => {
                          setSelectedTags((s) => [...s, tag.name])
                          setTagQuery('')
                          setShowTagDropdown(false)
                        }}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 flex items-center gap-2 text-sm"
                      >
                        <span
                          className="w-3 h-3 rounded-full flex-shrink-0"
                          style={{ backgroundColor: tag.color || DEFAULT_TAG_COLOR }}
                        />
                        <span className="flex-1">{tag.name}</span>
                      </button>
                    ))}
                    {tagMatches.length === 0 && !tagQuery.trim() && (
                      <div className="px-3 py-2 text-gray-500 text-sm text-center">
                        No tags available. Type to create one.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-linkedin`} className="block text-sm font-medium text-gray-700 mb-1.5">
                  LinkedIn URL
                </label>
                <input
                  id={`${id}-linkedin`}
                  type="url"
                  value={form.linkedin_url}
                  onChange={set('linkedin_url')}
                  className="input"
                  placeholder="https://linkedin.com/in/username"
                />
              </div>
              <div>
                <label htmlFor={`${id}-twitter`} className="block text-sm font-medium text-gray-700 mb-1.5">
                  Twitter / X URL
                </label>
                <input
                  id={`${id}-twitter`}
                  type="url"
                  value={form.twitter_url}
                  onChange={set('twitter_url')}
                  className="input"
                  placeholder="https://x.com/username"
                />
              </div>
            </div>

            <fieldset>
              <legend className="block text-sm font-medium text-gray-700 mb-1.5">Location</legend>
              <div className="grid gap-4 grid-cols-3">
                <input
                  type="text"
                  value={form.city}
                  onChange={set('city')}
                  className="input"
                  placeholder="City"
                  aria-label="City"
                />
                <input
                  type="text"
                  value={form.state}
                  onChange={set('state')}
                  className="input"
                  placeholder="State"
                  aria-label="State"
                />
                <input
                  type="text"
                  value={form.country}
                  onChange={set('country')}
                  className="input"
                  placeholder="Country"
                  aria-label="Country"
                />
              </div>
            </fieldset>

            <div>
              <label htmlFor={`${id}-bio`} className="block text-sm font-medium text-gray-700 mb-1.5">
                Bio
              </label>
              <textarea
                id={`${id}-bio`}
                value={form.description}
                onChange={set('description')}
                rows={3}
                className="input resize-none"
                placeholder="Brief background on this person..."
              />
            </div>

            {/* Relationship tracking */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-100 space-y-4">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-800">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z"
                  />
                </svg>
                Relationship tracking
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${id}-met`} className="block text-sm font-medium text-gray-700 mb-1.5">
                    First met date
                  </label>
                  <input
                    id={`${id}-met`}
                    type="date"
                    value={form.first_met_date}
                    onChange={set('first_met_date')}
                    className="input"
                  />
                </div>
                <div>
                  <label htmlFor={`${id}-intro`} className="block text-sm font-medium text-gray-700 mb-1.5">
                    Introduced by
                  </label>
                  <TypeAhead
                    id={`${id}-intro`}
                    options={people}
                    value={introducedBy}
                    onChange={setIntroducedBy}
                    placeholder="Search people..."
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`${id}-how`} className="block text-sm font-medium text-gray-700 mb-1.5">
                  How we met
                </label>
                <textarea
                  id={`${id}-how`}
                  value={form.how_we_met}
                  onChange={set('how_we_met')}
                  rows={2}
                  className="input resize-none"
                  placeholder="e.g., Met at a regional funders conference"
                />
              </div>
              <div>
                <label htmlFor={`${id}-rel-notes`} className="block text-sm font-medium text-gray-700 mb-1.5">
                  Relationship notes
                </label>
                <textarea
                  id={`${id}-rel-notes`}
                  value={form.relationship_notes}
                  onChange={set('relationship_notes')}
                  rows={2}
                  className="input resize-none"
                  placeholder="Ongoing notes about the relationship..."
                />
              </div>
            </div>
          </form>

          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3 rounded-b-xl">
            <button type="button" onClick={close} className="btn btn-secondary flex-1" disabled={saving}>
              Cancel
            </button>
            <button
              type="submit"
              form={`${id}-form`}
              disabled={saving || !form.first_name.trim()}
              className="btn btn-primary flex-1"
            >
              {saving ? 'Saving...' : 'Add Person'}
            </button>
          </div>
        </div>
      </div>

      {duplicates.length > 0 && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4">
          <div role="alertdialog" aria-modal="true" className="bg-white rounded-xl max-w-lg w-full shadow-xl">
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
                  <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">Potential duplicate found</h2>
                  <p className="text-sm text-gray-500">Similar contacts already exist</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <p className="text-gray-700 text-sm mb-4">
                Found <span className="font-semibold">{duplicates.length}</span> existing{' '}
                {duplicates.length === 1 ? 'contact' : 'contacts'} with a similar name or the same email:
              </p>
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {duplicates.map((d) => (
                  <a
                    key={d.id}
                    href={`/${d.kind === 'organization' ? 'organizations' : 'people'}/${d.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-gray-300"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-gray-400 to-gray-600 rounded-full flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
                        {initials(d.display_name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{d.display_name}</p>
                        {d.email && <p className="text-sm text-gray-500 truncate">{d.email}</p>}
                        <div className="flex items-center gap-2 mt-1">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full ${
                              d.reason === 'email' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {d.reason === 'email' ? 'Same email' : 'Similar name'}
                          </span>
                          {d.title && <span className="text-xs text-gray-500">{d.title}</span>}
                        </div>
                      </div>
                    </div>
                  </a>
                ))}
              </div>
              {emailTaken ? (
                <p className="text-sm text-red-700 mt-4">
                  Each email can belong to only one contact. Clear or change the email to add this person anyway.
                </p>
              ) : (
                <p className="text-sm text-gray-500 mt-4">
                  Are you sure you want to add a new person named{' '}
                  <span className="font-medium">&ldquo;{fullName}&rdquo;</span>?
                </p>
              )}
            </div>
            <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex gap-3 rounded-b-xl">
              <button type="button" onClick={() => setDuplicates([])} className="btn btn-secondary flex-1">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setDuplicates([])
                  save(true)
                }}
                disabled={emailTaken}
                className="btn bg-amber-600 hover:bg-amber-700 text-white flex-1"
              >
                Create anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
