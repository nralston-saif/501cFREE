'use client'

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import {
  ENTITY_TYPE_LABELS,
  ROLE_BADGE_CLASSES,
  ROLE_FLAGS,
  contactRoles,
  externalUrl,
  initials,
  type OrganizationFilter,
} from '@/lib/contacts/crm'
import { formatCents } from '@/lib/utils/money'
import type { Contact } from '@/lib/supabase/types/database'
import AddOrganizationModal from './AddOrganizationModal'

export type OrganizationCard = Pick<
  Contact,
  | 'id'
  | 'display_name'
  | 'description'
  | 'website'
  | 'city'
  | 'state'
  | 'country'
  | 'entity_type'
  | 'image_path'
  | 'tags'
  | 'previous_names'
  | 'is_active'
  | 'is_donor'
  | 'is_grantee'
  | 'is_funder'
  | 'is_vendor'
  | 'is_lead'
> & {
  logo_url: string | null
  leadership: { id: string; name: string }[]
  granted_cents: number
  donated_cents: number
  pri_cents: number
}

const FILTER_KEY = 'organizations-filter'
const FILTER_EVENT = 'organizations-filter-change'
const FILTER_VALUES: OrganizationFilter[] = ['all', ...ROLE_FLAGS.map((r) => r.flag), 'archived']

// The chosen filter pill lives in localStorage. Read through
// useSyncExternalStore so the server render (and first client render) use
// 'all' and hydration doesn't mismatch.
function readFilter(): OrganizationFilter {
  try {
    const saved = localStorage.getItem(FILTER_KEY) as OrganizationFilter | null
    return saved && FILTER_VALUES.includes(saved) ? saved : 'all'
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

function saveFilter(value: OrganizationFilter) {
  try {
    localStorage.setItem(FILTER_KEY, value)
  } catch {
    // Storage unavailable (private mode); the choice just isn't remembered
  }
  window.dispatchEvent(new Event(FILTER_EVENT))
}

/** Whole dollars when there are no cents: "$25,000" rather than "$25,000.00" */
function money(cents: number): string {
  return formatCents(cents).replace(/\.00$/, '')
}

export default function OrganizationGrid({
  organizations,
  openAdd = false,
  ticketButton,
}: {
  organizations: OrganizationCard[]
  openAdd?: boolean
  ticketButton?: ReactNode
}) {
  const router = useRouter()
  const [searchQuery, setSearchQuery] = useState('')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [showAddModal, setShowAddModal] = useState(openAdd)
  const storedFilter = useSyncExternalStore(subscribeFilter, readFilter, () => 'all' as OrganizationFilter)

  const active = useMemo(() => organizations.filter((o) => o.is_active), [organizations])
  const archived = organizations.length - active.length

  const counts = useMemo(() => {
    const c: Partial<Record<OrganizationFilter, number>> = { all: active.length, archived }
    for (const { flag } of ROLE_FLAGS) c[flag] = active.filter((o) => o[flag]).length
    return c
  }, [active, archived])

  // A remembered pill that no longer has anything in it falls back to All
  const filter: OrganizationFilter = storedFilter !== 'all' && !counts[storedFilter] ? 'all' : storedFilter
  const scope = filter === 'archived' ? organizations.filter((o) => !o.is_active) : active

  const filtered = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return scope
      .filter((o) => {
        if (filter !== 'all' && filter !== 'archived' && !o[filter]) return false
        if (!query) return true
        return (
          o.display_name.toLowerCase().includes(query) ||
          !!o.description?.toLowerCase().includes(query) ||
          !!o.city?.toLowerCase().includes(query) ||
          o.tags.some((t) => t.toLowerCase().includes(query)) ||
          o.previous_names.some((n) => n.toLowerCase().includes(query))
        )
      })
      .sort((a, b) => {
        const cmp = a.display_name.localeCompare(b.display_name)
        return sortOrder === 'asc' ? cmp : -cmp
      })
  }, [scope, filter, searchQuery, sortOrder])

  const closeAddModal = () => {
    setShowAddModal(false)
    // Opened from ?add=1: drop it so a reload doesn't reopen the modal
    if (openAdd) router.replace('/organizations')
  }

  const pill = (key: OrganizationFilter, label: string, activeClass: string, idleClass: string) => {
    const isActive = filter === key
    return (
      <button
        key={key}
        type="button"
        onClick={() => saveFilter(isActive || key === 'all' ? 'all' : key)}
        className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
          isActive ? activeClass : idleClass
        }`}
      >
        {label} ({counts[key] ?? 0})
      </button>
    )
  }

  return (
    <div>
      {/* Header with count */}
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-semibold text-gray-900">Organizations</h1>
          <span className="text-lg text-gray-400 font-medium">
            {filtered.length === scope.length ? scope.length : `${filtered.length}/${scope.length}`}
          </span>
        </div>
        {ticketButton}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="search"
          placeholder="Search organizations by name, description, location, or tag..."
          aria-label="Search organizations"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="input py-3"
        />
      </div>

      {/* Filter pills, sort and add */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {pill('all', 'All', 'bg-gray-900 text-white', 'bg-gray-100 text-gray-700 hover:bg-gray-200')}
        {ROLE_FLAGS.map(({ flag, plural }) =>
          counts[flag]
            ? pill(flag, plural, 'bg-gray-900 text-white', `${ROLE_BADGE_CLASSES[flag]} hover:opacity-80`)
            : null
        )}
        {archived > 0 &&
          pill('archived', 'Archived', 'bg-gray-600 text-white', 'bg-gray-100 text-gray-500 hover:bg-gray-200')}

        <div className="ml-auto flex items-center gap-3">
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as 'asc' | 'desc')}
            aria-label="Sort order"
            className="px-3 py-1.5 border border-gray-200 rounded-md text-sm bg-white"
          >
            <option value="asc">A–Z</option>
            <option value="desc">Z–A</option>
          </select>
          <button type="button" onClick={() => setShowAddModal(true)} className="btn btn-primary py-1.5">
            + Add Organization
          </button>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="card p-12 text-center text-gray-400 text-sm">
          {organizations.length === 0
            ? 'No organizations yet. Add your first one to get started.'
            : 'No organizations match your search.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((org) => (
            <OrganizationCardView key={org.id} org={org} onOpen={() => router.push(`/organizations/${org.id}`)} />
          ))}
        </div>
      )}

      {showAddModal && <AddOrganizationModal onClose={closeAddModal} />}
    </div>
  )
}

function OrganizationCardView({ org, onOpen }: { org: OrganizationCard; onOpen: () => void }) {
  const router = useRouter()
  const roles = contactRoles(org)
  const info = [org.entity_type ? ENTITY_TYPE_LABELS[org.entity_type] : null, org.city].filter(Boolean)
  const moneyLines = [
    org.granted_cents > 0 ? `Granted ${money(org.granted_cents)}` : null,
    org.donated_cents > 0 ? `Donated ${money(org.donated_cents)}` : null,
    org.pri_cents > 0 ? `PRI ${money(org.pri_cents)}` : null,
  ].filter((s): s is string => !!s)

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen()
      }}
      className={`bg-white border border-gray-200 rounded-lg p-4 hover:border-gray-300 transition hover:shadow-md cursor-pointer ${
        org.is_active ? '' : 'opacity-75'
      }`}
    >
      <div className="flex items-start gap-3">
        {org.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed storage URL
          <img src={org.logo_url} alt="" className="h-12 w-12 object-contain flex-shrink-0 rounded-lg" />
        ) : (
          <div className="h-12 w-12 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-base font-bold text-gray-400">{initials(org.display_name)}</span>
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            {org.website ? (
              <a
                href={externalUrl(org.website)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-base font-semibold text-gray-900 hover:underline truncate min-w-0"
              >
                {org.display_name}
              </a>
            ) : (
              <h3 className="text-base font-semibold text-gray-900 truncate min-w-0">{org.display_name}</h3>
            )}
            {(roles.length > 0 || !org.is_active) && (
              <div className="flex flex-wrap justify-end gap-1 flex-shrink-0 max-w-[50%]">
                {!org.is_active && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                    Archived
                  </span>
                )}
                {roles.map((flag) => (
                  <span
                    key={flag}
                    className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${ROLE_BADGE_CLASSES[flag]}`}
                  >
                    {ROLE_FLAGS.find((r) => r.flag === flag)?.label}
                  </span>
                ))}
              </div>
            )}
          </div>

          {org.description && <p className="text-sm text-gray-600 line-clamp-2">{org.description}</p>}

          {info.length > 0 && (
            <div className="mt-1 flex items-center gap-2 text-xs text-gray-500 flex-wrap">
              {info.map((part, i) => (
                <span key={i} className="flex items-center gap-2">
                  {i > 0 && <span>•</span>}
                  <span>{part}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {org.leadership.length > 0 && (
        <div className="mt-2 text-xs text-gray-500">
          <span>Leadership: </span>
          {org.leadership.map((person, i) => (
            <span key={person.id}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  router.push(`/people/${person.id}`)
                }}
                className="text-gray-700 hover:underline"
              >
                {person.name}
              </button>
              {i < org.leadership.length - 1 && ', '}
            </span>
          ))}
        </div>
      )}

      {moneyLines.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex flex-wrap items-center gap-2 text-xs">
          {moneyLines.map((line, i) => (
            <span key={line} className={i === 0 ? 'font-semibold text-gray-900' : 'text-gray-500'}>
              {i > 0 && '• '}
              {line}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
