'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createApplicantInline } from '@/lib/actions/contacts'
import type { ContactKind } from '@/lib/supabase/types/database'

interface ContactOption {
  id: string
  display_name: string
}

interface ApplicantSelectProps {
  name: string
  /** Id for the visible combobox input, so a <label htmlFor> can name it. */
  id?: string
  /** Accessible name when there is no visible <label> for the input. */
  'aria-label'?: string
  contacts: ContactOption[]
  required?: boolean
  placeholder?: string
}

type DropdownItem =
  | { kind: 'contact'; contact: ContactOption }
  | { kind: 'create'; type: ContactKind }

const MAX_MATCHES = 8

export default function ApplicantSelect({
  name,
  id,
  'aria-label': ariaLabel,
  contacts,
  required,
  placeholder = 'Type to search applicants…',
}: ApplicantSelectProps) {
  const [options, setOptions] = useState<ContactOption[]>(contacts)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const [creating, setCreating] = useState<ContactKind | null>(null)
  const [error, setError] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const optionId = (i: number) => `${listboxId}-option-${i}`

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const trimmed = query.trim()
  const lowerQuery = trimmed.toLowerCase()
  const matches: ContactOption[] = trimmed
    ? options
        .filter((c) => c.display_name.toLowerCase().includes(lowerQuery))
        .slice(0, MAX_MATCHES)
    : options.slice(0, MAX_MATCHES)

  const hasExactMatch = options.some((c) => c.display_name.toLowerCase() === lowerQuery)

  const items: DropdownItem[] = [
    ...matches.map((c) => ({ kind: 'contact' as const, contact: c })),
    ...(trimmed && !hasExactMatch
      ? ([
          { kind: 'create', type: 'organization' },
          { kind: 'create', type: 'person' },
        ] as DropdownItem[])
      : []),
  ]

  const listVisible = open && (items.length > 0 || trimmed === '')

  const selectContact = (contact: ContactOption) => {
    setSelectedId(contact.id)
    setQuery(contact.display_name)
    setOpen(false)
    setError(null)
  }

  const createAndSelect = async (type: ContactKind) => {
    setError(null)
    setCreating(type)
    const result = await createApplicantInline({ name: trimmed, kind: type })
    setCreating(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setOptions((prev) =>
      [...prev, result.applicant].sort((a, b) => a.display_name.localeCompare(b.display_name))
    )
    selectContact(result.applicant)
  }

  const handleSelectItem = (item: DropdownItem) => {
    if (item.kind === 'contact') {
      selectContact(item.contact)
    } else {
      void createAndSelect(item.type)
    }
  }

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      setHighlight((h) => Math.min(h + 1, Math.max(0, items.length - 1)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(0, h - 1))
    } else if (e.key === 'Enter') {
      if (open && items[highlight]) {
        e.preventDefault()
        handleSelectItem(items[highlight])
      }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setSelectedId('') // editing the text invalidates any previous pick
    setHighlight(0)
    setOpen(true)
    setError(null)
  }

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={selectedId} required={required} />

      <input
        ref={inputRef}
        id={id}
        aria-label={ariaLabel}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={query}
        onChange={handleChange}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        className="input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listVisible}
        aria-controls={listVisible ? listboxId : undefined}
        aria-activedescendant={listVisible && items[highlight] ? optionId(highlight) : undefined}
      />

      {listVisible && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto"
        >
          {items.length === 0 && trimmed === '' && (
            <li role="presentation" className="px-3 py-2 text-sm text-gray-400">Start typing to search…</li>
          )}
          {items.map((item, i) => {
            const isHi = i === highlight
            const baseCls = `px-3 py-2 text-sm cursor-pointer ${
              isHi ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`
            if (item.kind === 'contact') {
              return (
                <li
                  key={item.contact.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isHi}
                  className={`${baseCls} text-gray-900`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    handleSelectItem(item)
                  }}
                >
                  {item.contact.display_name}
                </li>
              )
            }
            const busy = creating === item.type
            return (
              <li
                key={`create-${item.type}`}
                id={optionId(i)}
                role="option"
                aria-selected={isHi}
                aria-disabled={busy || undefined}
                className={`${baseCls} border-t border-gray-100 text-gray-700`}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (!busy) handleSelectItem(item)
                }}
              >
                {busy
                  ? `Creating "${trimmed}"…`
                  : `+ Create "${trimmed}" as ${item.type === 'organization' ? 'organization' : 'person'}`}
              </li>
            )
          })}
        </ul>
      )}

      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  )
}
