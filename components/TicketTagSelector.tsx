'use client'

import { useState, useEffect, useRef } from 'react'
import { createTag, listTags } from '@/lib/actions/tickets'
import type { Tag } from '@/lib/supabase/types/database'

// Pick existing tags (most used first) or create one by typing a new name.
// Reads and writes go through the ticket server actions; usage counts are
// bumped when a ticket is saved with the tag, not here.

type TagData = Pick<Tag, 'id' | 'name' | 'color'>

type TicketTagSelectorProps = {
  /** Id for the search input, so a <label htmlFor> can name it. */
  id?: string
  selectedTags: string[]
  onChange: (tags: string[]) => void
}

export default function TicketTagSelector({ id, selectedTags, onChange }: TicketTagSelectorProps) {
  const [availableTags, setAvailableTags] = useState<TagData[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    listTags().then((res) => {
      if (!cancelled && res.ok) setAvailableTags(res.tags)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        setSearchQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const createNewTag = async () => {
    const tagName = searchQuery.trim().toLowerCase()
    if (!tagName) return

    if (availableTags.some((t) => t.name.toLowerCase() === tagName)) {
      if (!selectedTags.includes(tagName)) {
        onChange([...selectedTags, tagName])
      }
      setSearchQuery('')
      setIsOpen(false)
      return
    }

    setIsCreating(true)
    const res = await createTag(tagName)
    setIsCreating(false)

    if (res.ok) {
      setAvailableTags([...availableTags, res.tag])
      if (!selectedTags.includes(res.tag.name)) onChange([...selectedTags, res.tag.name])
      setSearchQuery('')
      setIsOpen(false)
    }
  }

  const toggleTag = (tagName: string) => {
    if (selectedTags.includes(tagName)) {
      onChange(selectedTags.filter((t) => t !== tagName))
    } else {
      onChange([...selectedTags, tagName])
    }
  }

  const removeTag = (tagName: string) => {
    onChange(selectedTags.filter((t) => t !== tagName))
  }

  const filteredTags = availableTags.filter(
    (tag) => tag.name.toLowerCase().includes(searchQuery.toLowerCase()) && !selectedTags.includes(tag.name)
  )

  const getTagColor = (tagName: string) => availableTags.find((t) => t.name === tagName)?.color || '#6B7280'

  const showCreateOption =
    searchQuery.trim() &&
    !availableTags.some((t) => t.name.toLowerCase() === searchQuery.trim().toLowerCase())

  return (
    <div className="relative" ref={dropdownRef}>
      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedTags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: getTagColor(tag) }}
            >
              {tag}
              <button
                type="button"
                onClick={() => removeTag(tag)}
                className="hover:bg-white/20 rounded-full p-0.5"
                aria-label={`Remove tag ${tag}`}
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && showCreateOption) {
              e.preventDefault()
              createNewTag()
            }
          }}
          className="input"
          placeholder={selectedTags.length > 0 ? 'Add more tags...' : 'Select or create tags...'}
        />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Hide tag list' : 'Show tag list'}
          aria-expanded={isOpen}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
        >
          <svg
            className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {showCreateOption && (
            <button
              type="button"
              onClick={createNewTag}
              disabled={isCreating}
              className="w-full px-4 py-2.5 text-left hover:bg-green-50 flex items-center gap-2 border-b border-gray-100 text-green-700 font-medium text-sm"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              {isCreating ? 'Creating...' : `Create "${searchQuery.trim()}"`}
            </button>
          )}

          {filteredTags.length === 0 && !showCreateOption ? (
            <div className="px-4 py-2.5 text-gray-500 text-sm text-center">No tags found</div>
          ) : (
            filteredTags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => {
                  toggleTag(tag.name)
                  setSearchQuery('')
                }}
                className="w-full px-4 py-2.5 text-left hover:bg-gray-50 flex items-center gap-2 text-sm"
              >
                <span
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: tag.color || '#6B7280' }}
                />
                <span className="flex-1">{tag.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
