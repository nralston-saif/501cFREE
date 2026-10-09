'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { withBasePath } from '@/lib/basePath'
import type { SearchResult } from '@/app/api/search/route'

// Global search from the nav: contacts, notes and meetings, via
// /api/search. Results open in-app pages.

const BADGE_STYLES: Record<SearchResult['type'], string> = {
  contact: 'bg-blue-100 text-blue-700',
  meeting: 'bg-purple-100 text-purple-700',
  note: 'bg-green-100 text-green-700',
}

export default function SearchModal({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search. Clearing results for a too-short query happens in the
  // input's change handler, the only place the query changes.
  useEffect(() => {
    if (query.trim().length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(withBasePath(`/api/search?q=${encodeURIComponent(query.trim())}`))
        if (cancelled) return
        if (!res.ok) {
          setError(res.status === 401 ? 'Your session has expired. Sign in again.' : 'Search is unavailable right now.')
          setItems([])
        } else {
          const data: { results?: SearchResult[] } = await res.json()
          if (cancelled) return
          setItems(data.results ?? [])
          setSelected(0)
        }
      } catch {
        if (!cancelled) {
          setError('Search is unavailable right now.')
          setItems([])
        }
      }
      if (!cancelled) setLoading(false)
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const open = useCallback(
    (item: SearchResult | undefined) => {
      if (!item) return
      onClose()
      router.push(item.href)
    },
    [onClose, router]
  )

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((v) => Math.min(v + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((v) => Math.max(v - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      open(items[selected])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center px-4 pt-[12vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-xl border border-gray-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 border-b border-gray-100">
          <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              if (e.target.value.trim().length < 2) {
                setItems([])
                setError(null)
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search contacts, notes, and meetings…"
            aria-label="Search contacts, notes, and meetings"
            className="w-full py-3 text-sm focus:outline-none placeholder-gray-400"
          />
          {loading && (
            <svg className="animate-spin w-4 h-4 text-gray-400 shrink-0" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
        </div>

        <div className="max-h-[50vh] overflow-y-auto">
          {error && <p className="px-4 py-3 text-sm text-red-600">{error}</p>}
          {!error && query.trim().length >= 2 && !loading && items.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-400">No results</p>
          )}
          {items.map((item, i) => (
            <button
              key={`${item.type}:${item.id}`}
              type="button"
              onClick={() => open(item)}
              className={`w-full text-left flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                i === selected ? 'bg-gray-100' : 'hover:bg-gray-50'
              }`}
              onMouseEnter={() => setSelected(i)}
            >
              <span className="min-w-0">
                <span className="block font-medium text-gray-900 truncate">{item.title}</span>
                {item.subtitle && <span className="block text-xs text-gray-400 truncate">{item.subtitle}</span>}
              </span>
              <span className={`shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${BADGE_STYLES[item.type]}`}>
                {item.badge}
              </span>
            </button>
          ))}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
          ↑↓ navigate · Enter open · Esc close
        </div>
      </div>
    </div>
  )
}
