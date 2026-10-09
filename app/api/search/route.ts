import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthState } from '@/lib/auth'
import { escapeLike } from '@/lib/contacts/lookup'
import type { ContactKind, NoteLinkEntityType } from '@/lib/supabase/types/database'

// Global search behind the nav's search box: contacts (name or email), note
// text and meeting titles. ilike matching; contacts.display_name has a
// trigram index. Every result carries an in-app href.

export const dynamic = 'force-dynamic'

const LIMIT = 8
const SNIPPET_CHARS = 140

export type SearchResult = {
  type: 'contact' | 'note' | 'meeting'
  id: string
  title: string
  subtitle: string | null
  badge: string
  href: string
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A window of text around the first match. */
function snippet(text: string, q: string): string {
  const at = text.toLowerCase().indexOf(q.toLowerCase())
  const start = Math.max(0, at - 40)
  const out = text.slice(start, start + SNIPPET_CHARS)
  return `${start > 0 ? '…' : ''}${out}${start + SNIPPET_CHARS < text.length ? '…' : ''}`
}

function entityHref(type: NoteLinkEntityType, id: string): string {
  switch (type) {
    case 'contact':
      return `/contacts/${id}`
    case 'grant_proposal':
      return `/grants-out/proposals/${id}`
    case 'pri':
      return `/pris/${id}`
    case 'meeting':
      return `/meetings?id=${id}`
  }
}

export async function GET(request: Request) {
  const { memberId } = await getAuthState()
  if (!memberId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) return NextResponse.json({ results: [] })

  const supabase = await createClient()
  const pattern = `%${escapeLike(q)}%`
  const quoted = JSON.stringify(pattern)

  const [contactsRes, notesRes, meetingsRes] = await Promise.all([
    supabase
      .from('contacts')
      .select('id, display_name, kind, email, title')
      .or(`display_name.ilike.${quoted},email.ilike.${quoted}`)
      .order('display_name')
      .limit(LIMIT),
    supabase
      .from('notes')
      .select('id, content, note_date, links:note_links!note_id(entity_type, entity_id, is_primary)')
      .ilike('content', pattern)
      .order('note_date', { ascending: false })
      .limit(LIMIT),
    supabase
      .from('meetings')
      .select('id, title, meeting_date')
      .ilike('title', pattern)
      .order('meeting_date', { ascending: false })
      .limit(LIMIT),
  ])

  const contacts = (contactsRes.data ?? []) as {
    id: string
    display_name: string
    kind: ContactKind
    email: string | null
    title: string | null
  }[]
  type NoteLink = { entity_type: NoteLinkEntityType; entity_id: string; is_primary: boolean }
  const notes = (notesRes.data ?? []) as unknown as {
    id: string
    content: string
    note_date: string
    links: NoteLink[] | null
  }[]
  const meetings = (meetingsRes.data ?? []) as { id: string; title: string; meeting_date: string }[]

  // Each note opens on the record it's filed under (primary link first)
  const noteTargets = new Map<string, { type: NoteLinkEntityType; id: string }>()
  const labels = new Map<string, string>()
  for (const n of notes) {
    const links = n.links ?? []
    const l = links.find((x) => x.is_primary) ?? links[0]
    if (l) noteTargets.set(n.id, { type: l.entity_type, id: l.entity_id })
  }
  if (noteTargets.size > 0) {
    // Name the records notes point at
    const byType = (type: NoteLinkEntityType) =>
      [...noteTargets.values()].filter((t) => t.type === type).map((t) => t.id)
    const [c, p, r, m] = await Promise.all([
      byType('contact').length
        ? supabase.from('contacts').select('id, display_name').in('id', byType('contact'))
        : Promise.resolve({ data: [] }),
      byType('grant_proposal').length
        ? supabase.from('grant_proposals').select('id, title').in('id', byType('grant_proposal'))
        : Promise.resolve({ data: [] }),
      byType('pri').length
        ? supabase.from('pris').select('id, purpose').in('id', byType('pri'))
        : Promise.resolve({ data: [] }),
      byType('meeting').length
        ? supabase.from('meetings').select('id, title').in('id', byType('meeting'))
        : Promise.resolve({ data: [] }),
    ])
    for (const row of (c.data ?? []) as { id: string; display_name: string }[]) labels.set(row.id, row.display_name)
    for (const row of (p.data ?? []) as { id: string; title: string }[]) labels.set(row.id, row.title)
    for (const row of (r.data ?? []) as { id: string; purpose: string | null }[]) {
      labels.set(row.id, row.purpose || 'Program-related investment')
    }
    for (const row of (m.data ?? []) as { id: string; title: string }[]) labels.set(row.id, row.title)
  }

  const results: SearchResult[] = [
    ...contacts.map((c) => ({
      type: 'contact' as const,
      id: c.id,
      title: c.display_name,
      subtitle: c.title || c.email,
      badge: c.kind === 'person' ? 'Person' : 'Organization',
      href: `/contacts/${c.id}`,
    })),
    ...meetings.map((m) => ({
      type: 'meeting' as const,
      id: m.id,
      title: m.title,
      subtitle: null,
      badge: 'Meeting',
      href: `/meetings?id=${m.id}`,
    })),
    ...notes.flatMap((n) => {
      const target = noteTargets.get(n.id)
      if (!target) return []
      return [
        {
          type: 'note' as const,
          id: n.id,
          title: labels.get(target.id) ?? 'Note',
          subtitle: snippet(plainText(n.content), q),
          badge: n.note_date,
          href: entityHref(target.type, target.id),
        },
      ]
    }),
  ]

  return NextResponse.json({ results })
}
