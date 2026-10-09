'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { deleteNote, noteFileUrl, setNoteLinks, updateNote } from '@/lib/actions/notes'
import NoteComposer from './crm/notes/NoteComposer'
import NotesTimeline from './crm/notes/NotesTimeline'
import EditNoteModal, { type EditableNoteLink } from './crm/notes/EditNoteModal'
import DeleteNoteModal from './crm/notes/DeleteNoteModal'
import {
  linkKey,
  noteText,
  type LinkLabels,
  type NoteLinkChip,
  type TimelineMeeting,
  type TimelineNote,
} from './crm/notes/types'

// Client half of the notes section (see ContactNotes.tsx): the server
// component loads the timeline, this one writes through server actions and
// refreshes the page.

export default function ContactNotesClient({
  primary,
  autoLinks,
  suggestedLinks,
  notes,
  meetings,
  linkLabels,
  viewerMemberId,
  today,
  title = 'Notes',
}: {
  primary: NoteLinkChip
  autoLinks: NoteLinkChip[]
  suggestedLinks: NoteLinkChip[]
  notes: TimelineNote[]
  meetings: TimelineMeeting[]
  linkLabels: LinkLabels
  viewerMemberId: string | null
  /** Today (YYYY-MM-DD) in the organization's time zone, from the server */
  today: string
  title?: string
}) {
  const router = useRouter()
  const [openNoteId, setOpenNoteId] = useState<string | null>(null)
  const [editing, setEditing] = useState<TimelineNote | null>(null)
  const [deleting, setDeleting] = useState<TimelineNote | null>(null)
  const [busy, setBusy] = useState(false)
  const [modalError, setModalError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const closeModals = () => {
    setEditing(null)
    setDeleting(null)
    setModalError(null)
  }

  async function saveEdit(content: string, noteDate: string, links: EditableNoteLink[]) {
    if (!editing) return
    setBusy(true)
    setModalError(null)
    const res = await updateNote(editing.id, { content, noteDate })
    let error = res.ok ? null : res.error
    const before = editing.links.filter((l) => !l.is_primary).length
    const after = links.filter((l) => !l.isPrimary)
    if (!error && after.length !== before) {
      const linkRes = await setNoteLinks(
        editing.id,
        after.map((l) => ({ entityType: l.entityType, entityId: l.entityId }))
      )
      if (!linkRes.ok) error = linkRes.error
    }
    setBusy(false)
    if (error) {
      setModalError(error)
      return
    }
    closeModals()
    router.refresh()
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    setModalError(null)
    const res = await deleteNote(deleting.id)
    setBusy(false)
    if (!res.ok) {
      setModalError(res.error)
      return
    }
    closeModals()
    router.refresh()
  }

  async function openFile(path: string) {
    setFileError(null)
    const res = await noteFileUrl(path).catch(() => null)
    if (res?.ok && res.data) window.open(res.data, '_blank', 'noopener')
    else setFileError(res && !res.ok ? res.error : 'Could not open that file')
  }

  const labelFor = (type: string, id: string) => linkLabels[linkKey(type, id)]?.label ?? 'Linked record'

  return (
    <div id="notes" className="card p-6 scroll-mt-24">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{title}</h2>
      <div className="space-y-6">
        <NoteComposer
          primary={primary}
          autoLinks={autoLinks}
          suggestedLinks={suggestedLinks}
          today={today}
          onOpenNoteChange={setOpenNoteId}
          onDone={() => router.refresh()}
        />
        {fileError && <p className="text-xs text-red-600">{fileError}</p>}
        <NotesTimeline
          entityType={primary.entityType}
          entityId={primary.entityId}
          notes={openNoteId ? notes.filter((n) => n.id !== openNoteId) : notes}
          meetings={meetings}
          linkLabels={linkLabels}
          viewerMemberId={viewerMemberId}
          onEdit={(n) => {
            setModalError(null)
            setEditing(n)
          }}
          onDelete={(n) => {
            setModalError(null)
            setDeleting(n)
          }}
          onOpenFile={openFile}
        />
      </div>

      {editing && (
        <EditNoteModal
          key={editing.id}
          onClose={closeModals}
          onSave={saveEdit}
          isSaving={busy}
          initialContent={editing.content}
          initialDate={editing.note_date}
          initialLinks={editing.links.map((l) => ({
            entityType: l.entity_type,
            entityId: l.entity_id,
            label: labelFor(l.entity_type, l.entity_id),
            isPrimary: l.is_primary,
          }))}
          error={modalError}
        />
      )}

      <DeleteNoteModal
        isOpen={!!deleting}
        onClose={closeModals}
        onConfirm={confirmDelete}
        isDeleting={busy}
        notePreview={deleting ? noteText(deleting.content) : undefined}
        error={modalError}
      />
    </div>
  )
}
