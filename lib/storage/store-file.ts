import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentEntityType, Database } from '@/lib/supabase/types/database'
import { ActionError } from '@/lib/actions/helpers'

const MAX_FILE_BYTES = 10 * 1024 * 1024

/**
 * Upload a file to the private `documents` bucket and record a attachments
 * row pointing at it. Rolls the storage object back if the DB insert fails.
 * Throws ActionError on any failure. Shared by uploadAttachment and the invoice
 * import flow.
 */
export async function storeAttachmentFile(
  supabase: SupabaseClient<Database>,
  params: { entityType: AttachmentEntityType; entityId: string; file: File; memberId: string }
): Promise<void> {
  const { entityType, entityId, file, memberId } = params

  if (file.size === 0) throw new ActionError('No file provided')
  if (file.size > MAX_FILE_BYTES) throw new ActionError('File exceeds 10 MB limit')

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
  const storagePath = `${entityType}/${entityId}/${crypto.randomUUID()}-${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('documents')
    .upload(storagePath, file, { contentType: file.type || undefined })
  if (uploadError) throw new ActionError(`Upload failed: ${uploadError.message}`)

  const { error: insertError } = await supabase.from('attachments').insert({
    entity_type: entityType,
    entity_id: entityId,
    storage_path: storagePath,
    file_name: file.name,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: memberId,
  })
  if (insertError) {
    await supabase.storage.from('documents').remove([storagePath])
    throw new ActionError(`Failed to record attachment: ${insertError.message}`)
  }
}
