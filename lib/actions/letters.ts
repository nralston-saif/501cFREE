'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isDemoMode } from '@/lib/supabase/demo/mock-client'
import { requireMemberId, ActionError, runAction } from './helpers'
import { buildLetterData, type LetterData } from '@/lib/pdf/letter-data'
import { getOrgSettings, orgName, orgToday } from '@/lib/settings'
import { loadPrincipalPerson } from '@/lib/pdf/principal-contact'
import { getResend, isEmailConfigured, EMAIL_NOT_CONFIGURED_MESSAGE } from '@/lib/email/resend'
import { getSignatureDataUri } from '@/lib/letters/signature'

async function renderLetterPdf(data: LetterData, signature: string | null): Promise<Buffer> {
  // Dynamic imports keep @react-pdf/renderer out of shared bundles
  const { renderToBuffer } = await import('@react-pdf/renderer')
  const { default: AcknowledgementLetter } = await import('@/lib/pdf/AcknowledgementLetter')
  const { createElement } = await import('react')
  const element = createElement(AcknowledgementLetter, { data, signature })
  // renderToBuffer's signature expects a <Document> element; ours is a
  // component that renders one, which works at runtime
  return renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0])
}

async function loadLetterInputs(contributionId: string) {
  const supabase = await createClient()

  const { data: contribution, error } = await supabase
    .from('contributions')
    .select('*')
    .eq('id', contributionId)
    .single()
  if (error || !contribution) throw new ActionError('Contribution not found')

  const { data: contact } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', contribution.contact_id)
    .single()
  if (!contact) throw new ActionError('Contact not found')

  const settings = await getOrgSettings(supabase)
  if (!settings.org_legal_name) {
    throw new ActionError(
      "Set your organization's legal name in Settings before generating letters."
    )
  }

  // Organization donors: address the letter to their primary contact person
  const attention = await loadPrincipalPerson(supabase, contact)

  const { data: stockDetail } =
    contribution.method === 'stock'
      ? await supabase
          .from('stock_contribution_details')
          .select('*')
          .eq('contribution_id', contributionId)
          .maybeSingle()
      : { data: null }

  return { contribution, contact, settings, stockDetail, attention }
}

export async function generateLetter(contributionId: string) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    // A sent letter is final (the database enforces this too). Check before
    // rendering: the PDF upload below overwrites the stored file.
    const { data: existing } = await supabase
      .from('acknowledgement_letters')
      .select('status')
      .eq('contribution_id', contributionId)
      .maybeSingle()
    if (existing?.status === 'sent') {
      throw new ActionError('This letter was already sent and can no longer be regenerated')
    }

    const { contribution, contact, settings, stockDetail, attention } =
      await loadLetterInputs(contributionId)

    let letterData: LetterData
    try {
      letterData = buildLetterData(
        contribution,
        contact,
        settings,
        await orgToday(supabase),
        stockDetail,
        attention
      )
    } catch (err) {
      throw new ActionError(err instanceof Error ? err.message : 'Could not build letter')
    }

    const signature = await getSignatureDataUri()
    const pdf = await renderLetterPdf(letterData, signature)

    const year = contribution.received_date.slice(0, 4)
    const storagePath = `contributions/${contributionId}/acknowledgement-${year}.pdf`

    // Service-role client: letters bucket writes happen server-side only
    const admin = createAdminClient()
    const { error: uploadError } = await admin.storage
      .from('letters')
      .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })

    if (uploadError) throw new ActionError(`PDF upload failed: ${uploadError.message}`)

    const { error: upsertError } = await supabase
      .from('acknowledgement_letters')
      .upsert(
        {
          contribution_id: contributionId,
          status: 'generated',
          pdf_storage_path: storagePath,
          body_snapshot: JSON.parse(JSON.stringify(letterData)),
          generated_by: memberId,
        },
        { onConflict: 'contribution_id' }
      )

    if (upsertError) throw new ActionError(upsertError.message)

    revalidatePath(`/contributions/${contributionId}`)
    revalidatePath('/contributions')
  })
}

export async function sendLetter(contributionId: string) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { data: letter } = await supabase
      .from('acknowledgement_letters')
      .select('*')
      .eq('contribution_id', contributionId)
      .maybeSingle()

    if (!letter || letter.status === 'draft' || !letter.pdf_storage_path) {
      throw new ActionError('Generate the letter before sending')
    }

    const { contact, settings } = await loadLetterInputs(contributionId)
    if (!contact.email) {
      throw new ActionError('This contact has no email address on file')
    }
    // Fail before any work, with a message the user can act on (demo mode
    // never emails, so it needs no key)
    if (!isDemoMode() && !isEmailConfigured()) {
      throw new ActionError(EMAIL_NOT_CONFIGURED_MESSAGE)
    }

    const admin = createAdminClient()
    const { data: pdfBlob, error: downloadError } = await admin.storage
      .from('letters')
      .download(letter.pdf_storage_path)

    if (downloadError || !pdfBlob) throw new ActionError('Could not load the generated PDF')

    // Demo mode: record the send without emailing anyone
    if (isDemoMode()) {
      await supabase
        .from('acknowledgement_letters')
        .update({
          status: 'sent',
          sent_to_email: contact.email,
          sent_at: new Date().toISOString(),
          resend_message_id: 'demo-mode-no-email-sent',
        })
        .eq('id', letter.id)
      revalidatePath(`/contributions/${contributionId}`)
      revalidatePath('/contributions')
      return
    }

    const fromEmail = settings.letter_from_email ?? process.env.LETTER_FROM_EMAIL
    if (!fromEmail) {
      throw new ActionError('No from-address configured. Set one in Settings.')
    }

    const name = orgName(settings)
    const resend = getResend()
    const { data: sendResult, error: sendError } = await resend.emails.send({
      from: `${name} <${fromEmail}>`,
      to: contact.email,
      subject: `Your contribution acknowledgement from ${name}`,
      text:
        `Dear ${contact.display_name},\n\n` +
        `Thank you for your contribution to ${settings.org_legal_name ?? name}. ` +
        `Your formal acknowledgement letter is attached. Please retain it for your tax records.\n\n` +
        `Sincerely,\n${settings.letter_signatory_name ?? name}`,
      attachments: [
        {
          filename: 'contribution-acknowledgement.pdf',
          content: Buffer.from(await pdfBlob.arrayBuffer()),
        },
      ],
    })

    if (sendError) throw new ActionError(`Email failed: ${sendError.message}`)

    const { error: updateError } = await supabase
      .from('acknowledgement_letters')
      .update({
        status: 'sent',
        sent_to_email: contact.email,
        sent_at: new Date().toISOString(),
        resend_message_id: sendResult?.id ?? null,
      })
      .eq('id', letter.id)

    if (updateError) throw new ActionError(updateError.message)

    revalidatePath(`/contributions/${contributionId}`)
    revalidatePath('/contributions')
  })
}
