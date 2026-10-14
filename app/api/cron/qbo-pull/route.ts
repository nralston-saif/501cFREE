import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isAuthorizedCronRequest } from '@/lib/cron/auth'
import { runQboPull } from '@/lib/quickbooks/pull'

// Never cache or prerender — every run reads QBO and mutates inbox state.
export const dynamic = 'force-dynamic'
export const maxDuration = 120

/**
 * QBO pull sync: lands bank transactions accepted in QuickBooks into the
 * review inbox (/banking). Runs daily by default (Vercel Hobby only allows daily jobs; paid plans can run it every 30 minutes), which also keeps the
 * OAuth refresh token rotating so the connection can no longer expire from
 * inactivity. Protected by CRON_SECRET; Vercel Cron supplies the bearer token.
 */
export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request.headers.get('authorization'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Service-role client: the cron has no signed-in user, so it must bypass RLS.
  const supabase = createAdminClient()
  const stats = await runQboPull(supabase)

  return NextResponse.json({ ok: stats.errors.length === 0, ...stats })
}
