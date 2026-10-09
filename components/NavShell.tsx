'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { withBasePath } from '@/lib/basePath'
import { APP_NAME } from '@/lib/branding'
import { ReactNode, useEffect, useRef, useState } from 'react'
import SearchModal from './SearchModal'

// `adminOnly` leaves are hidden from staff, matching RLS (expenses and
// QuickBooks data are admin-only); the routes' own layouts are the backstop.
type NavLeaf = { href: string; label: string; adminOnly?: boolean }
type NavEntry = NavLeaf | { label: string; items: NavLeaf[] }

// Grouped by money direction: donations in, funding out, running the books.
const NAV_ITEMS: NavEntry[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/tickets', label: 'Tickets' },
  { href: '/meetings', label: 'Meetings' },
  {
    label: 'Donations',
    items: [
      { href: '/contributions', label: 'Contributions' },
      { href: '/inquiries', label: 'Inquiries' },
    ],
  },
  {
    label: 'Grantmaking',
    items: [
      { href: '/grants-out', label: 'Grants' },
      { href: '/pris', label: 'PRIs' },
      { href: '/portfolio', label: 'Portfolio' },
    ],
  },
  {
    // Books, banking, and 990 reporting — admins only
    label: 'Finance',
    items: [
      { href: '/expenses', label: 'Expenses', adminOnly: true },
      { href: '/banking', label: 'Banking', adminOnly: true },
      { href: '/reports', label: 'Reports', adminOnly: true },
    ],
  },
  {
    label: 'CRM',
    items: [
      { href: '/organizations', label: 'Organizations' },
      { href: '/people', label: 'People' },
      { href: '/notes-inbox', label: 'Notes inbox' },
    ],
  },
]
// Settings (org settings, QuickBooks, team, activity log, governance —
// admins only), Account and Sign out live in the profile menu.

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export default function NavShell({
  children,
  isAdmin = false,
  userName = null,
}: {
  children: ReactNode
  /** Admins also see finance and settings; staff never do */
  isAdmin?: boolean
  userName?: string | null
}) {
  const pathname = usePathname()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [showSearch, setShowSearch] = useState(false)
  const navRef = useRef<HTMLElement>(null)
  const profileRef = useRef<HTMLDivElement>(null)
  const PROFILE = '__profile'

  // Cmd+K / Ctrl+K opens search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  // Close any open dropdown on navigation (adjusting state during render when
  // the path changes) and on outside click / Escape
  const [menuPathname, setMenuPathname] = useState(pathname)
  if (pathname !== menuPathname) {
    setMenuPathname(pathname)
    setOpenMenu(null)
  }

  useEffect(() => {
    if (!openMenu) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (navRef.current?.contains(target) || profileRef.current?.contains(target)) return
      setOpenMenu(null)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  // Full request to the sign-out route handler (app/auth/signout)
  const handleSignOut = () => {
    window.location.href = withBasePath('/auth/signout')
  }

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname.startsWith(href)

  const visibleLeaves = (items: NavLeaf[]) => items.filter((item) => !item.adminOnly || isAdmin)

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-wrap items-center justify-between gap-y-1 min-h-14 py-1.5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
            <Link href="/" className="text-lg font-semibold tracking-tight text-[#1a1a1a]">
              {APP_NAME}
            </Link>
            <nav ref={navRef} className="flex flex-wrap items-center gap-1">
              {NAV_ITEMS.map((entry) => {
                if (!('items' in entry)) {
                  if (entry.adminOnly && !isAdmin) return null
                  return (
                    <Link
                      key={entry.href}
                      href={entry.href}
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                        isActive(entry.href)
                          ? 'bg-gray-100 text-gray-900 font-medium'
                          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {entry.label}
                    </Link>
                  )
                }

                const items = visibleLeaves(entry.items)
                if (items.length === 0) return null
                const groupActive = items.some((item) => isActive(item.href))
                const open = openMenu === entry.label
                return (
                  <div key={entry.label} className="relative">
                    <button
                      onClick={() => setOpenMenu(open ? null : entry.label)}
                      aria-expanded={open}
                      aria-haspopup="menu"
                      className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1 ${
                        groupActive
                          ? 'bg-gray-100 text-gray-900 font-medium'
                          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {entry.label} <ChevronDown open={open} />
                    </button>
                    {open && (
                      <div
                        role="menu"
                        className="absolute left-0 top-full mt-1 min-w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1"
                      >
                        {items.map((item) => (
                          <Link
                            key={item.href}
                            href={item.href}
                            role="menuitem"
                            className={`block px-3 py-1.5 text-sm ${
                              isActive(item.href)
                                ? 'bg-gray-100 text-gray-900 font-medium'
                                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                            }`}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </nav>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowSearch(true)}
              className="flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
              title="Search (⌘K)"
              aria-label="Search"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <kbd className="hidden lg:inline-flex items-center rounded border border-gray-200 bg-gray-50 px-1.5 text-xs text-gray-400">⌘K</kbd>
            </button>

            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setOpenMenu(openMenu === PROFILE ? null : PROFILE)}
                aria-expanded={openMenu === PROFILE}
                aria-haspopup="menu"
                aria-label="Account menu"
                className="flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#1a1a1a] text-sm font-medium text-white">
                  {(userName?.trim()[0] ?? '?').toUpperCase()}
                </span>
                <ChevronDown open={openMenu === PROFILE} />
              </button>
              {openMenu === PROFILE && (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-1 min-w-48 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                >
                  {userName && <p className="truncate px-3 py-1.5 text-xs text-gray-400">{userName}</p>}
                  <Link href="/account" role="menuitem" className="block px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900">
                    Account
                  </Link>
                  {isAdmin && (
                    <Link href="/settings" role="menuitem" className="block px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900">
                      Settings
                    </Link>
                  )}
                  <div className="my-1 h-px bg-gray-100" />
                  <button
                    onClick={handleSignOut}
                    role="menuitem"
                    className="block w-full px-3 py-1.5 text-left text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>
      {showSearch && <SearchModal onClose={() => setShowSearch(false)} />}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  )
}
