import { after, NextResponse } from 'next/server'
import { checkFile } from '@/lib/note-intake-core'
import { isNoteIntakeEnabled, NoteIntakeError } from '@/lib/note-intake-core/config'
import type { IntakeFile, LinkableRecord } from '@/lib/note-intake-core/server'
import { createClientSnapshot } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/types/database'
import { getAuthState } from '@/lib/auth'
import { getOrgSettings, orgName } from '@/lib/settings'
import { todayInTimeZone } from '@/lib/utils/dates'
import { listLinkableRecords, searchContacts } from '@/lib/note-intake/context'

export const dynamic = 'force-dynamic'
// Reading several files plus a few contact searches takes one to three
// minutes; leave headroom.
export const maxDuration = 600

const STALE_PROCESSING_MS = 12 * 60 * 1000

/**
 * Start (or re-run) Claude on a notes-inbox drop. Responds immediately; the
 * work runs in after() and lands on the intake row, which the review page
 * polls.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { memberId, memberName } = await getAuthState()
  if (!memberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!isNoteIntakeEnabled()) {
    return NextResponse.json({ error: 'AI note filing is not configured' }, { status: 503 })
  }

  const { id } = await params
  // Cookies read up front: this client keeps working inside after()
  const supabase = await createClientSnapshot()

  const { data: intake } = await supabase
    .from('note_intakes')
    .select('id, status, processing_started_at')
    .eq('id', id)
    .maybeSingle()
  if (!intake) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (intake.status === 'filed') {
    return NextResponse.json({ error: 'These notes are already filed' }, { status: 409 })
  }
  if (intake.status === 'processing' && intake.processing_started_at) {
    const age = Date.now() - new Date(intake.processing_started_at).getTime()
    if (age < STALE_PROCESSING_MS) {
      return NextResponse.json({ error: 'Already reading these files' }, { status: 409 })
    }
  }

  const { data: fileRows } = await supabase
    .from('note_intake_files')
    .select('storage_path, file_name')
    .eq('intake_id', id)
    .order('created_at', { ascending: true })
  if (!fileRows?.length) return NextResponse.json({ error: 'No files uploaded' }, { status: 400 })

  const { error: claimError } = await supabase
    .from('note_intakes')
    .update({ status: 'processing', processing_started_at: new Date().toISOString(), error: null, draft: null })
    .eq('id', id)
  if (claimError) return NextResponse.json({ error: claimError.message }, { status: 500 })

  after(async () => {
    try {
      const settings = await getOrgSettings(supabase)
      const records: LinkableRecord[] = await listLinkableRecords(supabase).catch(() => [])
      const files: IntakeFile[] = await Promise.all(
        fileRows.map(async (row) => {
          const check = checkFile(row.file_name, 1)
          if (!check.ok) throw new NoteIntakeError(`"${row.file_name}": ${check.reason}`)
          const { data, error } = await supabase.storage.from('note-files').download(row.storage_path)
          if (error || !data) throw new NoteIntakeError(`Couldn't load "${row.file_name}" from storage.`)
          return {
            name: row.file_name,
            kind: check.kind,
            mime: check.mime,
            bytes: Buffer.from(await data.arrayBuffer()),
          }
        })
      )

      // Loaded here, not at the top: the pipeline pulls in the Anthropic SDK,
      // sharp, mammoth and xlsx, which only this background step needs
      const { runNoteIntake } = await import('@/lib/note-intake-core/server')
      const result = await runNoteIntake(files, {
        organization: { name: orgName(settings), mission: settings.mission_statement?.trim() || null },
        uploaderName: memberName ?? 'a team member',
        today: todayInTimeZone(settings.timezone),
        records,
        searchContacts: (query) => searchContacts(supabase, query),
      })

      await supabase
        .from('note_intakes')
        .update({
          status: 'ready',
          proposal: result.proposal as unknown as Json,
          model: result.model,
          processed_at: new Date().toISOString(),
        })
        .eq('id', id)
    } catch (err) {
      console.error('[note-intake] processing failed', id, err)
      const message =
        err instanceof NoteIntakeError ? err.message : 'Something went wrong reading these files. Try again.'
      await supabase.from('note_intakes').update({ status: 'failed', error: message }).eq('id', id)
    }
  })

  return NextResponse.json({ status: 'processing' }, { status: 202 })
}
