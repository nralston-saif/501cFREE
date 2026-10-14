import DemoAiBadge from '@/components/DemoAiBadge'

/**
 * The note above a demo-mode AI result: the "Demo: sample AI output" badge
 * (unless the panel heading has it) plus what a real installation would do (texts in lib/ai/demo-label.ts).
 */
export default function DemoSampleNote({
  children,
  badge = true,
}: {
  children: React.ReactNode
  /** Off where the panel heading already carries the badge */
  badge?: boolean
}) {
  return (
    <div className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm text-purple-900">
      {badge && <DemoAiBadge className="mb-1 bg-white" />}
      <p>{children}</p>
    </div>
  )
}
