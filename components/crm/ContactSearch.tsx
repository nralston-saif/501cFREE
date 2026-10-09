'use client'

import { useEffect, useState } from 'react'
import { searchContacts, type ContactSearchHit } from '@/lib/actions/contacts'
import type { ContactKind } from '@/lib/supabase/types/database'

/** Type-ahead over contacts of one kind. Shows results below the input and
 * reports the picked one; `excludeIds` hides contacts already linked. */
export default function ContactSearch({
  kind,
  onPick,
  excludeIds = [],
  placeholder,
  label,
  autoFocus = false,
  onNoResults,
}: {
  kind: ContactKind
  onPick: (hit: ContactSearchHit) => void
  excludeIds?: string[]
  placeholder?: string
  label: string
  autoFocus?: boolean
  /** Shown under "No matches" (e.g. a "create new instead" button) */
  onNoResults?: (query: string) => React.ReactNode
}) {
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<ContactSearchHit[]>([])
  const [searchedFor, setSearchedFor] = useState('')
  const searching = query.trim().length >= 2

  useEffect(() => {
    if (!searching) return
    let cancelled = false
    const q = query
    const timer = setTimeout(() => {
      searchContacts(q, kind)
        .then((res) => {
          if (cancelled) return
          setHits(res.ok ? res.data : [])
          setSearchedFor(q)
        })
        .catch(() => {
          if (!cancelled) setHits([])
        })
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searching, query, kind])

  const visible = searching ? hits.filter((h) => !excludeIds.includes(h.id)) : []
  const settled = searching && searchedFor === query

  return (
    <div>
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          if (e.target.value.trim().length < 2) setHits([])
        }}
        placeholder={placeholder ?? 'Start typing to search…'}
        aria-label={label}
        className="input"
        autoFocus={autoFocus}
      />
      {visible.length > 0 && (
        <ul className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-60 overflow-y-auto bg-white">
          {visible.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onPick(h)
                  setQuery('')
                  setHits([])
                }}
                className="w-full px-3 py-2 text-left hover:bg-gray-50"
              >
                <span className="block text-sm font-medium text-gray-900 truncate">{h.display_name}</span>
                {(h.email || h.title) && (
                  <span className="block text-xs text-gray-500 truncate">{[h.title, h.email].filter(Boolean).join(' · ')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {settled && visible.length === 0 && (
        <div className="text-center py-4 text-sm text-gray-500">
          <p>No matches for &ldquo;{query.trim()}&rdquo;</p>
          {onNoResults?.(query.trim())}
        </div>
      )}
    </div>
  )
}
