import { DEMO_AI_LABEL } from '@/lib/ai/demo-label'

/**
 * Marks output from demo mode's scripted AI provider (lib/ai/demo.ts):
 * pre-written sample results, not a model reading the documents.
 */
export default function DemoAiBadge({ className = '' }: { className?: string }) {
  return (
    <span
      title="Demo mode returns pre-written sample results. No AI model reads your files."
      className={`inline-flex shrink-0 items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700 ${className}`}
    >
      {DEMO_AI_LABEL}
    </span>
  )
}
