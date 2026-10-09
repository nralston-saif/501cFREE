import 'server-only'
import type { createClient } from '@/lib/supabase/server'

type Client = Awaited<ReturnType<typeof createClient>>

/** Short-lived signed URLs for contacts' logos/photos (documents bucket),
 * keyed by storage path. Paths that fail to sign are left out, so callers
 * fall back to initials. */
export async function signContactImages(
  supabase: Client,
  paths: (string | null | undefined)[],
  expiresInSeconds = 3600
): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))]
  const urls = new Map<string, string>()
  if (unique.length === 0) return urls
  const { data } = await supabase.storage.from('documents').createSignedUrls(unique, expiresInSeconds)
  for (const row of data ?? []) {
    if (row.path && row.signedUrl && !row.error) urls.set(row.path, row.signedUrl)
  }
  return urls
}
