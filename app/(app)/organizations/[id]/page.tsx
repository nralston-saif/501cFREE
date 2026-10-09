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
import type { OrgMember } from '@/components/crm/types'
import type { Affiliation, Attachment, Contact } from '@/lib/supabase/types/database'
import OrganizationView from './OrganizationView'

type PersonRow = Omit<OrgMember['person'], 'imageUrl'> & { image_path: string | null }
type AffiliationWithPerson = Affiliation & { person: PersonRow | null }

export default async function OrganizationPage({
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
  const organization = contactRow as unknown as Contact | null
  if (!organization) notFound()
  if (organization.kind !== 'organization') redirect(`/people/${id}`)

  // People come embedded in their affiliations (no second lookup by id)
  const [affiliations, attachmentsRes, funding] = await Promise.all([
    fetchAll<AffiliationWithPerson>(() =>
      supabase
        .from('affiliations')
        .select(
          '*, person:contacts!person_id(id, display_name, title, description, city, state, country, linkedin_url, twitter_url, email, image_path)'
        )
        .eq('organization_id', id)
        .order('id')
    ),
    supabase
      .from('attachments')
      .select('*')
      .eq('entity_type', 'contact')
      .eq('entity_id', id)
      .order('created_at', { ascending: false }),
    loadFunding(supabase, id, isAdmin),
  ])
  const attachments = (attachmentsRes.data ?? []) as unknown as Attachment[]

  const people = new Map(affiliations.flatMap((a) => (a.person ? [[a.person.id, a.person] as const] : [])))

  const images = await signImages(supabase, [organization.image_path, ...[...people.values()].map((p) => p.image_path)])

  const members: OrgMember[] = affiliations
    .flatMap((a) => {
      const p = people.get(a.person_id)
      if (!p) return []
      const { image_path, ...person } = p
      return [
        {
          id: a.id,
          relationship: a.relationship,
          title: a.title,
          is_primary_contact: a.is_primary_contact,
          start_date: a.start_date,
          end_date: a.end_date,
          person: { ...person, imageUrl: image_path ? (images.get(image_path) ?? null) : null },
        },
      ]
    })
    .sort((x, y) => x.person.display_name.localeCompare(y.person.display_name))

  // Current people are offered as one-click links on new notes, so a
  // conversation with the org also shows on each participant's page
  const suggestedLinks = members
    .filter((m) => !m.end_date)
    .filter((m, i, all) => all.findIndex((o) => o.person.id === m.person.id) === i)
    .map((m) => ({
      entityType: 'contact' as const,
      entityId: m.person.id,
      label: m.person.display_name,
      contactKind: 'person' as const,
    }))

  return (
    <OrganizationView
      organization={organization}
      imageUrl={organization.image_path ? (images.get(organization.image_path) ?? null) : null}
      members={members}
      startEditing={edit === '1' || edit === 'true'}
      actions={<CreateTicketButton className="btn btn-secondary" />}
      funding={<FundingSection data={funding} variant="organization" />}
      documents={<ContactDocuments contactId={id} attachments={attachments} revalidatePath={`/organizations/${id}`} timeZone={timezone} />}
      notes={
        <ContactNotes
          entityType="contact"
          entityId={id}
          label={organization.display_name}
          contactKind="organization"
          autoLinks={[]}
          suggestedLinks={suggestedLinks}
        />
      }
    />
  )
}
