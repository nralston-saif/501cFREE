import type { NoteIntakeStatus } from '@/lib/supabase/types/database'

const STYLES: Record<NoteIntakeStatus, { label: string; className: string }> = {
  uploading: { label: 'Not sent', className: 'bg-gray-100 text-gray-600' },
  processing: { label: 'Reading…', className: 'bg-blue-50 text-blue-700' },
  ready: { label: 'Ready to review', className: 'bg-amber-50 text-amber-800' },
  filed: { label: 'Filed', className: 'bg-green-50 text-green-700' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-700' },
}

export function IntakeStatusBadge({ status }: { status: NoteIntakeStatus }) {
  const style = STYLES[status]
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${style.className}`}>{style.label}</span>
  )
}
