import Link from 'next/link'
import PageHeader from '@/components/PageHeader'
import EmptyState from '@/components/EmptyState'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import type { NoteIntakeStatus } from '@/lib/supabase/types/database'
import { isNoteIntakeEnabled } from '@/lib/note-intake-core/config'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { isScriptedAi } from '@/lib/ai/demo'
import type { DemoContact, DemoRecord } from '@/lib/ai/demo-scripts'
import { listLinkableRecords } from '@/lib/note-intake/context'
import { getOrgSettings } from '@/lib/settings'
import { todayInTimeZone } from '@/lib/utils/dates'
import DropZone from './DropZone'
import DemoNotesInbox from './DemoNotesInbox'
import { IntakeStatusBadge } from './IntakeStatusBadge'

export const dynamic = 'force-dynamic'

const DESCRIPTION =
  "Drop in meeting notes in any common format, including photos of handwritten pages. Claude writes them up and suggests which contacts, grants and PRIs they belong on. You review everything before it's saved."

// Notes inbox: drop files, Claude proposes formatted notes and where they go,
// a person reviews and files them.
export default async function NotesInboxPage() {
  const supabase = await createClient()
  // Demo mode without a key: sample notes built in the browser, nothing uploaded or saved
  if (isScriptedAi()) {
    const [{ data: contactRows }, records, settings] = await Promise.all([
      supabase
        .from('contacts')
        .select('id, kind, display_name')
        .eq('is_active', true)
        .eq('is_vendor', false)
        .order('display_name')
        .limit(100),
      listLinkableRecords(supabase).catch(() => []),
      getOrgSettings(supabase),
    ])
    const contacts: DemoContact[] = (contactRows ?? []).map((c) => ({ id: c.id, kind: c.kind, name: c.display_name }))
    const demoRecords: DemoRecord[] = records.map((r) => ({ id: r.id, type: r.type, label: r.label }))
    return (
      <div>
        <PageHeader title="Notes inbox" description={DESCRIPTION} />
        <DemoNotesInbox contacts={contacts} records={demoRecords} today={todayInTimeZone(settings.timezone)} />
      </div>
    )
  }

  const { memberId } = await getAuthState()
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
      <PageHeader title="Notes inbox" description={DESCRIPTION} />
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
