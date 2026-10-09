'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMemberId, ActionError, runAction } from './helpers'
import { isMemoComplete } from '@/lib/grants/memo'
import { isPriMemoComplete } from '@/lib/pris/memo'
import { buildMemoData, type MemoData } from '@/lib/pdf/memo-data'
import { buildPriMemoData } from '@/lib/pdf/pri-memo-data'
import { getOrgSettings, orgToday } from '@/lib/settings'
import { loadPrincipalPerson } from '@/lib/pdf/principal-contact'

async function renderMemorandumPdf(data: MemoData): Promise<Buffer> {
  // Dynamic imports keep @react-pdf/renderer out of shared bundles
  const { renderToBuffer } = await import('@react-pdf/renderer')
  const { default: GrantMemorandum } = await import('@/lib/pdf/GrantMemorandum')
  const { createElement } = await import('react')
  const element = createElement(GrantMemorandum, { data })
  // renderToBuffer's signature expects a <Document> element; ours is a
  // component that renders one, which works at runtime
  return renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0])
}

/**
 * Render the Grant Memorandum PDF for a proposal and store it (regenerating
 * is always allowed — it's an internal record, re-run after paying an
 * installment to refresh the Key dates row).
 */
export async function generateGrantMemorandum(proposalId: string) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { data: proposal, error: loadError } = await supabase
      .from('grant_proposals')
      .select('*')
      .eq('id', proposalId)
      .single()
    if (loadError || !proposal) throw new ActionError('Proposal not found')
    if (!proposal.applicant_contact_id) {
      throw new ActionError('Link an applicant contact before generating the memorandum')
    }

    const { data: memo } = await supabase
      .from('proposal_memos')
      .select('*')
      .eq('proposal_id', proposalId)
      .maybeSingle()
    if (!isMemoComplete(memo)) {
      throw new ActionError('All 10 memorandum sections must be drafted before generating the PDF')
    }

    const [{ data: grantee }, { data: award }, settings] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', proposal.applicant_contact_id).maybeSingle(),
      supabase.from('grants_out').select('*').eq('proposal_id', proposalId).maybeSingle(),
      getOrgSettings(supabase),
    ])
    if (!grantee) throw new ActionError('Grantee contact not found')
    if (!settings.org_legal_name) {
      throw new ActionError(
        "Set your organization's legal name in Settings before generating memoranda."
      )
    }

    const { data: disbursements } = award
      ? await supabase.from('disbursements').select('*').eq('grant_out_id', award.id)
      : { data: [] }

    const memoData = buildMemoData(
      proposal,
      memo!,
      grantee,
      await loadPrincipalPerson(supabase, grantee),
      award ?? null,
      disbursements ?? [],
      settings,
      await orgToday(supabase)
    )

    const pdf = await renderMemorandumPdf(memoData)

    const storagePath = `memoranda/${proposalId}/grant-memorandum.pdf`

    // Service-role client: letters bucket writes happen server-side only
    const admin = createAdminClient()
    const { error: uploadError } = await admin.storage
      .from('letters')
      .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })
    if (uploadError) throw new ActionError(`PDF upload failed: ${uploadError.message}`)

    const { error: upsertError } = await supabase.from('grant_memo_pdfs').upsert(
      {
        proposal_id: proposalId,
        pdf_storage_path: storagePath,
        body_snapshot: JSON.parse(JSON.stringify(memoData)),
        generated_by: memberId,
      },
      { onConflict: 'proposal_id' }
    )
    if (upsertError) throw new ActionError(upsertError.message)

    revalidatePath(`/grants-out/proposals/${proposalId}`)
  })
}

/**
 * Render the Mission-Alignment Memorandum PDF for a PRI and file it under the
 * PRI's attachments (Instrument & documents). Regenerating is always allowed
 * and replaces the stored file in place; markPriFunded also calls this so the
 * filed copy reflects the funding date. The attachment row it creates is NOT
 * an executed instrument — the funding gate excludes it by attachment_id.
 */
export async function generatePriMemorandum(priId: string) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const { data: pri, error: loadError } = await supabase
      .from('pris')
      .select('*')
      .eq('id', priId)
      .single()
    if (loadError || !pri) throw new ActionError('PRI not found')

    const { data: memo } = await supabase
      .from('pri_memos')
      .select('*')
      .eq('pri_id', priId)
      .maybeSingle()
    if (!isPriMemoComplete(memo)) {
      throw new ActionError('All 10 memo questions must be answered before generating the PDF')
    }

    const [{ data: recipient }, settings] = await Promise.all([
      supabase.from('contacts').select('*').eq('id', pri.recipient_contact_id).maybeSingle(),
      getOrgSettings(supabase),
    ])
    if (!recipient) throw new ActionError('Recipient contact not found')
    if (!settings.org_legal_name) {
      throw new ActionError(
        "Set your organization's legal name in Settings before generating memoranda."
      )
    }

    const memoData = buildPriMemoData(
      pri,
      memo!,
      recipient,
      await loadPrincipalPerson(supabase, recipient),
      settings,
      await orgToday(supabase)
    )
    const pdf = await renderMemorandumPdf(memoData)

    // Stable path in the documents bucket — regenerates replace the file, so
    // the existing attachment row keeps pointing at the current version.
    const storagePath = `pri/${priId}/mission-alignment-memo.pdf`
    const admin = createAdminClient()
    const { error: uploadError } = await admin.storage
      .from('documents')
      .upload(storagePath, pdf, { contentType: 'application/pdf', upsert: true })
    if (uploadError) throw new ActionError(`PDF upload failed: ${uploadError.message}`)

    // Reuse the filed attachment row if it still exists; recreate it if a
    // someone deleted it from the panel.
    const { data: existing } = await supabase
      .from('pri_memo_pdfs')
      .select('attachment_id')
      .eq('pri_id', priId)
      .maybeSingle()

    let attachmentId = existing?.attachment_id ?? null
    if (attachmentId) {
      const { data: attachment } = await supabase
        .from('attachments')
        .select('id')
        .eq('id', attachmentId)
        .maybeSingle()
      if (attachment) {
        await supabase
          .from('attachments')
          .update({ size_bytes: pdf.byteLength, uploaded_by: memberId })
          .eq('id', attachmentId)
      } else {
        attachmentId = null
      }
    }
    if (!attachmentId) {
      const { data: attachment, error: attachError } = await supabase
        .from('attachments')
        .insert({
          entity_type: 'pri',
          entity_id: priId,
          storage_path: storagePath,
          file_name: 'mission-alignment-memo.pdf',
          mime_type: 'application/pdf',
          size_bytes: pdf.byteLength,
          uploaded_by: memberId,
        })
        .select('id')
        .single()
      if (attachError) throw new ActionError(attachError.message)
      attachmentId = attachment.id
    }

    const { error: upsertError } = await supabase.from('pri_memo_pdfs').upsert(
      {
        pri_id: priId,
        attachment_id: attachmentId,
        pdf_storage_path: storagePath,
        body_snapshot: JSON.parse(JSON.stringify(memoData)),
        generated_by: memberId,
      },
      { onConflict: 'pri_id' }
    )
    if (upsertError) throw new ActionError(upsertError.message)

    revalidatePath(`/pris/${priId}`)
  })
}
