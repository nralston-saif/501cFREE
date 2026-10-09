import { secretMatches } from '@/lib/security/secrets'

/**
 * Cron auth check. Vercel Cron automatically sends
 * `Authorization: Bearer <CRON_SECRET>` when a CRON_SECRET env var is set, so
 * we require an exact match. A missing/empty secret denies all requests (the
 * endpoint is never open).
 */
export function isAuthorizedCronRequest(
  authHeader: string | null,
  secret: string | undefined
): boolean {
  if (!secret || !authHeader?.startsWith('Bearer ')) return false
  return secretMatches(authHeader.slice('Bearer '.length), secret)
}
