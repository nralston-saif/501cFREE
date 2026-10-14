import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isReviewDraft, type NoteIntakeProposal } from '@/lib/note-intake-core'
import { createClient } from '@/lib/supabase/server'
import type { NoteLinkEntityType } from '@/lib/supabase/types/database'
import { fetchByKeys } from '@/lib/supabase/fetch-all'
import ReviewClient, { type FiledLink, type IntakeFileView } from './ReviewClient'
import { DEMO_AI_MODEL } from '@/lib/ai/demo-label'
import DemoAiBadge from '@/components/DemoAiBadge'

export const dynamic = 'force-dynamic'

type Client = Awaited<ReturnType<typeof createClient>>

function entityHref(type: NoteLinkEntityType, id: string): string | null {
  switch (type) {
    case 'contact':
      return `/contacts/${id}`
    case 'grant_proposal':
      return `/grants-out/proposals/${id}`
    case 'pri':
      return `/pris/${id}`
    default:
      return null
  }
}

/** Where filed notes went, for the confirmation view */
async function loadFiledLinks(supabase: Client, noteIds: string[]): Promise<FiledLink[]> {
  const links = await fetchByKeys<{ entity_type: NoteLinkEntityType; entity_id: string }, string>(noteIds, (chunk) =>
    supabase.from('note_links').select('entity_type, entity_id').in('note_id', chunk)
  )
  const unique = [...new Map(links.map((l) => [`${l.entity_type}:${l.entity_id}`, l])).values()]
  const idsOf = (type: NoteLinkEntityType) => unique.filter((l) => l.entity_type === type).map((l) => l.entity_id)

  // Labels for exactly the linked records (same wording as the review list)
  const [contacts, proposals, pris] = await Promise.all([
    fetchByKeys<{ id: string; display_name: string }, string>(idsOf('contact'), (chunk) =>
      supabase.from('contacts').select('id, display_name').in('id', chunk)
    ),
    fetchByKeys<{ id: string; title: string }, string>(idsOf('grant_proposal'), (chunk) =>
      supabase.from('grant_proposals').select('id, title').in('id', chunk)
    ),
    fetchByKeys<{ id: string; recipient: { display_name: string } | null }, string>(idsOf('pri'), (chunk) =>
      supabase.from('pris').select('id, recipient:contacts!recipient_contact_id(display_name)').in('id', chunk)
    ),
  ])
  const labels = new Map<string, string>()
  for (const c of contacts) labels.set(`contact:${c.id}`, c.display_name)
  for (const p of proposals) labels.set(`grant_proposal:${p.id}`, `Grant proposal: ${p.title}`)
  for (const p of pris) labels.set(`pri:${p.id}`, `PRI: ${p.recipient?.display_name ?? 'Unknown recipient'}`)
  return unique.flatMap((l) => {
    const label = labels.get(`${l.entity_type}:${l.entity_id}`)
    const href = entityHref(l.entity_type, l.entity_id)
    return label && href ? [{ label, href }] : []
  })
}

export default async function NoteIntakePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: intake }, { data: fileRows }] = await Promise.all([
    supabase
      .from('note_intakes')
      .select('id, status, error, proposal, draft, model, note_ids, created_at, processed_at')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('note_intake_files')
      .select('storage_path, file_name, mime_type')
      .eq('intake_id', id)
      .order('created_at', { ascending: true }),
  ])
  if (!intake) notFound()

  const paths = (fileRows ?? []).map((f) => f.storage_path)
  const [{ data: signed }, filedLinks] = await Promise.all([
    paths.length
      ? supabase.storage.from('note-files').createSignedUrls(paths, 60 * 60)
      : Promise.resolve({ data: [] }),
    intake.status === 'filed' && intake.note_ids.length
      ? loadFiledLinks(supabase, intake.note_ids).catch((): FiledLink[] => [])
      : Promise.resolve([]),
  ])
  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]))
  const files: IntakeFileView[] = (fileRows ?? []).map((f) => ({
    name: f.file_name,
    mime: f.mime_type,
    url: urlByPath.get(f.storage_path) ?? null,
  }))

  return (
    <div>
      <div className="mb-2 text-sm">
        <Link href="/notes-inbox" className="text-gray-500 hover:text-gray-800 hover:underline">
          ← Notes inbox
        </Link>
      </div>
      {intake.model === DEMO_AI_MODEL && intake.status !== 'filed' && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <DemoAiBadge />
          These notes are pre-written samples, not a reading of your files.
        </p>
      )}
      <ReviewClient
        // Remount when a fresh proposal lands (after a re-read)
        key={intake.processed_at ?? 'pending'}
        intakeId={intake.id}
        status={intake.status}
        error={intake.error}
        proposal={(intake.proposal as unknown as NoteIntakeProposal | null) ?? null}
        draft={isReviewDraft(intake.draft) ? intake.draft : null}
        files={files}
        filedCount={intake.note_ids.length}
        filedLinks={filedLinks}
      />
    </div>
  )
}
