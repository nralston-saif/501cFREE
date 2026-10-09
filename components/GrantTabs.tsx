import Link from 'next/link'

interface GrantTabsProps {
  proposalId: string | null
  awardId: string | null
  active: 'proposal' | 'award'
}

/**
 * Tab bar shown on a grant's proposal and award detail pages so the team can
 * flip between the two views with one click. Renders nothing when only one
 * side exists (an unapproved proposal, or an award recorded directly with no
 * proposal record).
 */
export default function GrantTabs({ proposalId, awardId, active }: GrantTabsProps) {
  if (!proposalId || !awardId) return null

  const tabs = [
    { key: 'award' as const, label: 'Award', href: `/grants-out/awards/${awardId}` },
    { key: 'proposal' as const, label: 'Proposal', href: `/grants-out/proposals/${proposalId}` },
  ]

  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            active === t.key
              ? 'border-gray-900 text-gray-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  )
}
