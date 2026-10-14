import Link from 'next/link'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import type { NoteIntakeStatus } from '@/lib/supabase/types/database'
import { isNoteIntakeEnabled } from '@/lib/note-intake-core/config'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { isScriptedAi } from '@/lib/ai/demo'
import DemoAiBadge from '@/components/DemoAiBadge'
import DropZone from './DropZone'
import { IntakeStatusBadge } from './IntakeStatusBadge'

export const dynamic = 'force-dynamic'

// Notes inbox: drop files, Claude proposes formatted notes and where they go,
// a person reviews and files them.
export default async function NotesInboxPage() {
  const { memberId } = await getAuthState()
  const supabase = await createClient()
  const { data } = memberId
    ? await supabase
        .from('note_intakes')
        .select('id, status, created_at, error, note_ids, files:note_intake_files!intake_id(file_name)')
        .eq('created_by', memberId)
        .order('created_at', { ascending: false })
        .limit(50)
    : { data: [] }
  // Embedded selects are untyped (see lib/supabase/types/database.ts)
  const intakes = (data ?? []) as unknown as {
    id: string
    status: NoteIntakeStatus
    created_at: string
    error: string | null
    note_ids: string[]
    files: { file_name: string }[] | null
  }[]

  return (
    <div>
      <PageHeader
        title="Notes inbox"
        description="Drop in meeting notes in any common format, including photos of handwritten pages. Claude writes them up and suggests which contacts, grants and PRIs they belong on. You review everything before it's saved."
      />
      {isScriptedAi() && (
        <p className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <DemoAiBadge />
          In this demo the files aren&rsquo;t read: any drop gets sample notes linked to the demo
          contacts, for you to review and file like real ones. Files up to 8 MB.
        </p>
      )}
      {isNoteIntakeEnabled() ? (
        <DropZone stageOnServer={isDemoMode()} />
      ) : (
        <p className="mb-8 text-sm text-amber-700">
          AI note filing isn&rsquo;t configured on this deployment (ANTHROPIC_API_KEY).
        </p>
      )}

      <h2 className="mb-3 text-sm font-medium text-gray-900">Your recent drops</h2>
      {!intakes.length ? (
        <EmptyState message="Nothing here yet." />
      ) : (
        <div className="card divide-y divide-gray-100">
          {intakes.map((intake) => {
            const names = (intake.files ?? []).map((f) => f.file_name)
            return (
              <Link
                key={intake.id}
                href={`/notes-inbox/${intake.id}`}
                className="flex items-center gap-4 px-4 py-3 hover:bg-gray-50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-gray-900">
                    {names.length ? names.join(', ') : 'No files uploaded'}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(intake.created_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                    {intake.status === 'filed' &&
                      ` · ${intake.note_ids.length} note${intake.note_ids.length === 1 ? '' : 's'} filed`}
                  </p>
                </div>
                <IntakeStatusBadge status={intake.status} />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
