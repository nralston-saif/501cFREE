import { createAdminClient } from '@/lib/supabase/admin'

// The letter signatory's signature image lives in the private `letters`
// bucket (uploaded from Settings) and is embedded into each PDF at render
// time. One fixed object; its content type says whether it's PNG or JPEG.
export const SIGNATURE_STORAGE_PATH = 'assets/signature'
export const SIGNATURE_MAX_BYTES = 1024 * 1024
export const SIGNATURE_TYPES = ['image/png', 'image/jpeg'] as const

/** The signature as a base64 data URI, or null if none has been uploaded. */
export async function getSignatureDataUri(): Promise<string | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin.storage.from('letters').download(SIGNATURE_STORAGE_PATH)
    if (error || !data) return null
    const type = (SIGNATURE_TYPES as readonly string[]).includes(data.type) ? data.type : 'image/png'
    const buf = Buffer.from(await data.arrayBuffer())
    return `data:${type};base64,${buf.toString('base64')}`
  } catch {
    return null
  }
}
