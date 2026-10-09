'use client'

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  PEOPLE_FILTERS,
  PEOPLE_FILTER_RELATIONSHIPS,
  RELATIONSHIP_BADGE_CLASSES,
  RELATIONSHIP_LABELS,
  ROLE_BADGE_CLASSES,
  ROLE_FLAGS,
  contactRoles,
  externalUrl,
  initials,
  type PeopleFilter,
} from '@/lib/contacts/crm'
import type { AffiliationRelationship, Contact } from '@/lib/supabase/types/database'
import type { TagOption } from '@/lib/actions/crm-create'
import AddPersonModal from './AddPersonModal'

export type PersonCard = Pick<
  Contact,
  | 'id'
  | 'display_name'
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'alternative_emails'
  | 'title'
  | 'description'
  | 'image_path'
  | 'linkedin_url'
  | 'city'
  | 'state'
  | 'country'
  | 'tags'
  | 'is_active'
  | 'is_donor'
  | 'is_grantee'
  | 'is_funder'
  | 'is_vendor'
  | 'is_lead'
  | 'created_at'
> & {
  photo_url: string | null
  affiliations: {
    organization_id: string
    organization_name: string
    relationship: AffiliationRelationship
    title: string | null
    is_primary_contact: boolean
    /** No end date */
    current: boolean
    created_at: string
  }[]
  note_count: number
}

export type OrganizationOption = { id: string; name: string }

type SortOption = 'name-az' | 'name-za' | 'date-newest' | 'date-oldest'
type StatusFilter = 'active' | 'archived'

const FILTER_KEY = 'people-filter'
const FILTER_EVENT = 'people-filter-change'

// The chosen filter pill lives in localStorage. Read through
// useSyncExternalStore so the server render (and first client render) use
// 'all' and hydration doesn't mismatch.
function readFilter(): PeopleFilter {
  try {
    const saved = localStorage.getItem(FILTER_KEY)
    return PEOPLE_FILTERS.find((f) => f.key === saved)?.key ?? 'all'
  } catch {
    return 'all'
  }
}

function subscribeFilter(onChange: () => void) {
  window.addEventListener(FILTER_EVENT, onChange)
  window.addEventListener('storage', onChange)
  return () => {
    window.removeEventListener(FILTER_EVENT, onChange)
    window.removeEventListener('storage', onChange)
  }
}

function saveFilter(value: PeopleFilter) {
  try {
    localStorage.setItem(FILTER_KEY, value)
  } catch {
    // Storage unavailable (private mode); the choice just isn't remembered
  }
  window.dispatchEvent(new Event(FILTER_EVENT))
}

function matchesFilter(person: PersonCard, filter: PeopleFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'donors') return person.is_donor
  if (filter === 'leads') return person.is_lead
  const relationships = PEOPLE_FILTER_RELATIONSHIPS[filter] ?? []
  return person.affiliations.some((a) => a.current && relationships.includes(a.relationship))
}

function personLocation(p: Pick<Contact, 'city' | 'state' | 'country'>): string {
  return [p.city, p.state, p.country].filter(Boolean).join(', ')
}

export default function PeopleClient({
  people,
  organizations,
  tags,
  initialSearch = '',
  openAdd = false,
  ticketButton,
}: {
  people: PersonCard[]
  organizations: OrganizationOption[]
  tags: TagOption[]
  initialSearch?: string
  openAdd?: boolean
  ticketButton?: ReactNode
}) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState(initialSearch)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [sortOption, setSortOption] = useState<SortOption>('name-az')
  const [showAddModal, setShowAddModal] = useState(openAdd)
  const storedFilter = useSyncExternalStore(subscribeFilter, readFilter, () => 'all' as PeopleFilter)

  const scope = useMemo(
    () => people.filter((p) => (statusFilter === 'active' ? p.is_active : !p.is_active)),
    [people, statusFilter]
  )

  const counts = useMemo(() => {
    const c = {} as Record<PeopleFilter, number>
    for (const { key } of PEOPLE_FILTERS) c[key] = scope.filter((p) => matchesFilter(p, key)).length
    return c
  }, [scope])

  // A remembered pill with nothing in it falls back to All
  const filter: PeopleFilter = counts[storedFilter] ? storedFilter : 'all'

  const filteredPeople = useMemo(() => {
    let filtered = scope.filter((p) => matchesFilter(p, filter))

    // Multi-word search: every word must appear somewhere
    const words = searchQuery.toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length > 0) {
      filtered = filtered.filter((person) => {
        const text = [
          person.display_name,
          person.email,
          ...person.alternative_emails,
          person.title,
          person.description,
          ...person.affiliations.map((a) => a.organization_name),
          ...person.tags,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return words.every((w) => text.includes(w))
      })
    }

    return [...filtered].sort((a, b) => {
      switch (sortOption) {
        case 'name-za':
          return b.display_name.localeCompare(a.display_name)
        case 'date-newest':
          return b.created_at.localeCompare(a.created_at)
        case 'date-oldest':
          return a.created_at.localeCompare(b.created_at)
        default:
          return a.display_name.localeCompare(b.display_name)
      }
    })
  }, [scope, filter, searchQuery, sortOption])

  const closeAddModal = () => {
    setShowAddModal(false)
    // Opened from ?add=1: drop it so a reload doesn't reopen the modal
    if (openAdd) router.replace('/people')
  }

  return (
    <div>
      {/* Header with count */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold text-gray-900">People</h1>
          <span className="text-lg text-gray-400 font-medium">
            {filteredPeople.length === scope.length ? scope.length : `${filteredPeople.length}/${scope.length}`}
          </span>
        </div>
        {ticketButton}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          placeholder="Search people by name, email, organization, or title..."
          aria-label="Search people"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input py-3"
        />
      </div>

      {/* Filter pills, status, sort and add */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {PEOPLE_FILTERS.map(({ key, label }) => {
          const count = counts[key]
          if (key !== 'all' && count === 0) return null
          const isActive = filter === key
          return (
            <button
              key={key}
              type="button"
              onClick={() => saveFilter(isActive || key === 'all' ? 'all' : key)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {label} ({count})
            </button>
          )
        })}

        <div className="ml-auto flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            aria-label="Show active or archived people"
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
          >
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
          <select
            value={sortOption}
            onChange={(e) => setSortOption(e.target.value as SortOption)}
            aria-label="Sort order"
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
          >
            <option value="name-az">A–Z</option>
            <option value="name-za">Z–A</option>
            <option value="date-newest">Newest</option>
            <option value="date-oldest">Oldest</option>
          </select>
          <button type="button" onClick={() => setShowAddModal(true)} className="btn btn-primary py-1.5">
            + Add Person
          </button>
        </div>
      </div>

      {/* Grid */}
      {filteredPeople.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.5 20.1a7.5 7.5 0 0115 0A17.9 17.9 0 0112 21.75c-2.7 0-5.2-.6-7.5-1.65z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">
            {scope.length === 0
              ? statusFilter === 'archived'
                ? 'No archived people'
                : 'No people yet'
              : 'No matches found'}
          </h3>
          <p className="text-gray-500 mb-6 text-sm">
            {scope.length === 0
              ? statusFilter === 'archived'
                ? 'People you archive will show up here.'
                : 'Start tracking your network by adding your first contact.'
              : 'Try adjusting your search or filters.'}
          </p>
          {people.length === 0 && (
            <button type="button" onClick={() => setShowAddModal(true)} className="btn btn-primary">
              Add Person
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPeople.map((person) => (
            <PersonCardView key={person.id} person={person} onOpen={() => router.push(`/people/${person.id}`)} />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddPersonModal
          people={people.map((p) => ({ id: p.id, name: p.display_name }))}
          organizations={organizations}
          tags={tags}
          onClose={closeAddModal}
        />
      )}
    </div>
  )
}

function PersonCardView({ person, onOpen }: { person: PersonCard; onOpen: () => void }) {
  const current = person.affiliations.filter((a) => a.current)
  const organization = current[0]?.organization_name
  const relationships = [...new Set(current.map((a) => a.relationship))]
  const roles = contactRoles(person)
  const location = personLocation(person)

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className={`bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition hover:shadow-md cursor-pointer relative ${
        person.is_active ? '' : 'opacity-75'
      }`}
    >
      {/* Actions, top right */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        {person.linkedin_url && (
          <a
            href={externalUrl(person.linkedin_url)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 text-gray-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors"
            title="LinkedIn"
            aria-label={`${person.display_name} on LinkedIn`}
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" />
            </svg>
          </a>
        )}
        <Link
          href={`/people/${person.id}`}
          onClick={(e) => e.stopPropagation()}
          className="p-1.5 text-gray-400 hover:text-gray-900 rounded hover:bg-gray-100 transition-colors relative"
          title="View profile & notes"
          aria-label={`View ${person.display_name}'s profile and notes`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          {person.note_count > 0 && (
            <span className="absolute -top-1 -right-1 min-w-3.5 h-3.5 px-0.5 bg-gray-900 text-white text-[9px] font-medium rounded-full flex items-center justify-center">
              {person.note_count}
            </span>
          )}
        </Link>
      </div>

      <div className="flex items-start gap-3">
        {person.photo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL
          <img src={person.photo_url} alt="" className="w-12 h-12 rounded-full object-cover flex-shrink-0" />
        ) : (
          <div className="w-12 h-12 bg-gradient-to-br from-gray-200 to-gray-300 rounded-full flex items-center justify-center flex-shrink-0">
            <span className="text-base font-semibold text-gray-500">{initials(person.display_name)}</span>
          </div>
        )}

        <div className="flex-1 min-w-0 pr-14">
          <h3 className="text-base font-semibold text-gray-900 truncate">{person.display_name}</h3>
          {person.title && <p className="text-sm text-gray-600 truncate">{person.title}</p>}
          {organization && <p className="text-sm text-gray-500 truncate">{organization}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {!person.is_active && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                Archived
              </span>
            )}
            {relationships.map((r) => (
              <span
                key={r}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${RELATIONSHIP_BADGE_CLASSES[r]}`}
              >
                {RELATIONSHIP_LABELS[r]}
              </span>
            ))}
            {roles.map((flag) => (
              <span
                key={flag}
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_BADGE_CLASSES[flag]}`}
              >
                {ROLE_FLAGS.find((f) => f.flag === flag)?.label}
              </span>
            ))}
            {location && <span className="text-xs text-gray-400 truncate">{location}</span>}
          </div>
        </div>
      </div>
    </div>
  )
}
