import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchAll } from '@/lib/supabase/fetch-all'
import { getAuthState } from '@/lib/auth'
import { getOrgSettings } from '@/lib/settings'
import ContactNotes from '@/components/ContactNotes'
import CreateTicketButton from '@/components/CreateTicketButton'
import ContactDocuments from '@/components/crm/ContactDocuments'
import FundingSection from '@/components/crm/FundingSection'
import { loadFunding, signImages } from '@/components/crm/load'
import type { PersonOrg } from '@/components/crm/types'
import type { NoteLinkChip } from '@/components/crm/notes/types'
import type { Affiliation, Attachment, Contact } from '@/lib/supabase/types/database'
import PersonView from './PersonView'

type AffiliationWithOrg = Affiliation & {
  organization: { id: string; display_name: string; image_path: string | null } | null
}

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ edit?: string }>
}) {
  const [{ id }, { edit }] = await Promise.all([params, searchParams])
  const supabase = await createClient()

  const [{ data: contactRow }, { isAdmin }, { timezone }] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).maybeSingle(),
    getAuthState(),
    getOrgSettings(),
  ])
  // Casts needed: hand-written interface row types resolve to `never` with supabase-js
  const person = contactRow as unknown as Contact | null
  if (!person) notFound()
  if (person.kind !== 'person') redirect(`/organizations/${id}`)

  // Organizations come embedded in their affiliations (no second lookup by id)
  const [affiliations, attachmentsRes, introducerRes, funding] = await Promise.all([
    fetchAll<AffiliationWithOrg>(() =>
      supabase
        .from('affiliations')
        .select('*, organization:contacts!organization_id(id, display_name, image_path)')
        .eq('person_id', id)
        .order('id')
    ),
    supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'contact')
      .eq('entity_id', id)
      .order('created_at', { ascending: false }),
    person.introduced_by
      ? supabase.from('contacts').select('id, display_name, kind').eq('id', person.introduced_by).maybeSingle()
      : Promise.resolve({ data: null }),
    loadFunding(supabase, id, isAdmin),
  ])
  const attachments = (attachmentsRes.data ?? []) as unknown as Attachment[]
  const introducer = introducerRes.data as { id: string; display_name: string; kind: 'person' | 'organization' } | null

  const orgs = new Map(affiliations.flatMap((a) => (a.organization ? [[a.organization.id, a.organization] as const] : [])))

  const images = await signImages(supabase, [person.image_path, ...[...orgs.values()].map((o) => o.image_path)])

  const organizations: PersonOrg[] = affiliations
    .flatMap((a) => {
      const o = orgs.get(a.organization_id)
      if (!o) return []
      return [
        {
          id: a.id,
          relationship: a.relationship,
          title: a.title,
          is_primary_contact: a.is_primary_contact,
          start_date: a.start_date,
          end_date: a.end_date,
          organization: {
            id: o.id,
            display_name: o.display_name,
            imageUrl: o.image_path ? (images.get(o.image_path) ?? null) : null,
          },
        },
      ]
    })
    .sort((x, y) => x.organization.display_name.localeCompare(y.organization.display_name))

  // New notes are auto-linked to the person's main current organization (a
  // removable chip); their other current organizations are suggestions
  const current = organizations.filter((o) => !o.end_date)
  const main = current.find((o) => o.is_primary_contact) ?? current[0]
  const chip = (o: PersonOrg): NoteLinkChip => ({
    entityType: 'contact',
    entityId: o.organization.id,
    label: o.organization.display_name,
    contactKind: 'organization',
  })
  const autoLinks = main ? [chip(main)] : []
  const suggestedLinks = current
    .filter((o) => o.organization.id !== main?.organization.id)
    .filter((o, i, all) => all.findIndex((x) => x.organization.id === o.organization.id) === i)
    .map(chip)

  return (
    <PersonView
      person={person}
      imageUrl={person.image_path ? (images.get(person.image_path) ?? null) : null}
      organizations={organizations}
      introducer={introducer ? { id: introducer.id, name: introducer.display_name, kind: introducer.kind } : null}
      startEditing={edit === '1' || edit === 'true'}
      actions={<CreateTicketButton className="btn btn-secondary" />}
      funding={<FundingSection data={funding} variant="person" />}
      documents={<ContactDocuments contactId={id} attachments={attachments} revalidatePath={`/people/${id}`} timeZone={timezone} />}
      notes={
        <ContactNotes
          entityType="contact"
          entityId={id}
          label={person.display_name}
          contactKind="person"
          autoLinks={autoLinks}
          suggestedLinks={suggestedLinks}
        />
      }
    />
  )
}
