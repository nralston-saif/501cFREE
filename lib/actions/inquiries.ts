'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { findContactIdByEmail, findOrganizationIdByName } from '@/lib/contacts/lookup'
import { nameFieldsFor } from '@/lib/contacts/names'
import { requireMemberId, ActionError, runAction } from './helpers'
import type { DonationInquiryStatus } from '@/lib/supabase/types/database'

const STATUSES: DonationInquiryStatus[] = ['new', 'contacted', 'archived']

/** Triage a donation inquiry: new → contacted → archived. */
export async function setInquiryStatus(
  inquiryId: string,
  status: DonationInquiryStatus
) {
  return runAction(async () => {
    await requireMemberId()

    if (!STATUSES.includes(status)) {
      throw new ActionError(`Invalid status: ${status}`)
    }

    const supabase = await createClient()
    const { error } = await supabase
      .from('donation_inquiries')
      .update({ status })
      .eq('id', inquiryId)

    if (error) throw new ActionError(error.message)

    revalidatePath('/inquiries')
  })
}

/**
 * Convert a website donation inquiry into a donor contact. An existing
 * contact with the same email (primary or alternative) is reused and flagged
 * as a donor; otherwise a person is created. When the inquiry names an
 * organization, the person is linked to it (reusing an organization with the
 * same name). Marks the inquiry contacted and lands on the contact page,
 * ready for the contribution to be recorded.
 */
export async function convertInquiryToContact(inquiryId: string) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { data: inquiry } = await supabase
      .from('donation_inquiries')
      .select('*')
      .eq('id', inquiryId)
      .maybeSingle()
    const inq = inquiry as unknown as {
      name: string
      email: string
      phone: string | null
      organization: string | null
      status: string
    } | null
    if (!inq) throw new ActionError('Inquiry not found')

    let contactId = await findContactIdByEmail(supabase, inq.email)
    if (contactId) {
      const { error } = await supabase.from('contacts').update({ is_donor: true }).eq('id', contactId)
      if (error) throw new ActionError(error.message)
    } else {
      const { data: created, error: createError } = await supabase
        .from('contacts')
        .insert({
          kind: 'person',
          ...nameFieldsFor('person', inq.name),
          email: inq.email.trim(),
          phone: inq.phone,
          is_donor: true,
          created_by: memberId,
        })
        .select('id')
        .single()
      if (createError) throw new ActionError(createError.message)
      contactId = (created as { id: string }).id
    }

    // Link the person to the organization they named, if any
    const orgName = inq.organization?.trim()
    const { data: person } = await supabase.from('contacts').select('kind').eq('id', contactId).maybeSingle()
    if (orgName && (person as { kind: string } | null)?.kind === 'person') {
      let orgId = await findOrganizationIdByName(supabase, orgName)
      if (!orgId) {
        const { data: org, error: orgError } = await supabase
          .from('contacts')
          .insert({ kind: 'organization', ...nameFieldsFor('organization', orgName), created_by: memberId })
          .select('id')
          .single()
        if (orgError) throw new ActionError(orgError.message)
        orgId = (org as { id: string }).id
      }
      const { error: linkError } = await supabase
        .from('affiliations')
        .upsert(
          { person_id: contactId, organization_id: orgId, relationship: 'contact' },
          { onConflict: 'person_id,organization_id,relationship', ignoreDuplicates: true }
        )
      if (linkError) throw new ActionError(linkError.message)
    }

    if (inq.status === 'new') {
      await supabase.from('donation_inquiries').update({ status: 'contacted' }).eq('id', inquiryId)
    }

    revalidatePath('/inquiries')
    revalidatePath('/contacts')
    redirect(`/contacts/${contactId}`)
  })
}
