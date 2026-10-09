'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireMemberId, requiredString, ActionError, runAction } from './helpers'
import { storeAttachmentFile } from '@/lib/storage/store-file'
import type { AttachmentEntityType } from '@/lib/supabase/types/database'

export async function uploadAttachment(formData: FormData) {
  return runAction(async () => {
    const memberId = await requireMemberId()
    const supabase = await createClient()

    const entityType = requiredString(formData, 'entity_type') as AttachmentEntityType
    const entityId = requiredString(formData, 'entity_id')
    const revalidate = requiredString(formData, 'revalidate_path')
    const file = formData.get('file')
    if (!(file instanceof File)) throw new ActionError('No file provided')

    await storeAttachmentFile(supabase, { entityType, entityId, file, memberId })
    revalidatePath(revalidate)
  })
}

export async function deleteAttachment(attachmentId: string, revalidate: string) {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { data: attachment, error } = await supabase
      .from('attachments')
      .select('storage_path')
      .eq('id', attachmentId)
      .single()

    if (error || !attachment) throw new ActionError('Attachment not found')

    await supabase.storage.from('documents').remove([attachment.storage_path])
    await supabase.from('attachments').delete().eq('id', attachmentId)

    revalidatePath(revalidate)
  })
}

/** Short-lived signed URL for viewing a stored file */
export async function getSignedFileUrl(storagePath: string, bucket: 'documents' | 'letters' = 'documents') {
  return runAction(async () => {
    await requireMemberId()
    const supabase = await createClient()

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 60 * 10)

    if (error || !data) throw new ActionError('Could not create signed URL')
    return data.signedUrl
  })
}
