import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches } from '@/lib/security/secrets'
import { parseProposalSubmission } from '@/lib/grants/intake'
import { loadProgramAreas } from '@/lib/program-areas'
import { orgToday } from '@/lib/settings'

// Public ingestion endpoint for your website's grant-proposal form. The
// public site never talks to Supabase directly: it forwards each submission
// here, server-to-server, with a shared secret. We insert via the service-role
// admin client (which bypasses RLS) because there is no signed-in user.
// Submissions land directly in the pipeline at status 'received' /
// origin 'external' — the admins' Review stage is the triage.
//
// Contract:
//   POST /api/public/grant-proposal
//   Headers:
//     content-type: application/json
//     x-proposal-secret: <GRANT_PROPOSAL_INGEST_SECRET>
//   Body:
//     applicant_name: string      (required, ≤200)
//     applicant_email: string     (required, valid email, ≤320)
//     organization_name?: string  (≤200)
//     title: string               (required, ≤300)
//     summary?: string            (≤10000)
//     program_areas?: string[]    slugs of your program areas (Settings →
//                                 Program areas, e.g. ["early-literacy"]);
//                                 unknown or inactive slugs are dropped
//     amount_requested?: string   — "$50,000" ok; junk tolerated, raw kept in
//                                   raw_submission
//   Responses:
//     201 {ok:true} | 401 | 400 invalid JSON | 422 {error} | 500 {error}
//   Attachments/PDF upload: not supported in v1 (planned: signed-upload
//   handshake in a follow-up).
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Shared-secret gate: only the trusted website proxy knows this header, so
  // the endpoint isn't an open relay. A missing env secret fails closed.
  const expected = process.env.GRANT_PROPOSAL_INGEST_SECRET
  if (!secretMatches(request.headers.get('x-proposal-secret'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = createAdminClient()

  let activeProgramAreaSlugs: string[]
  let today: string
  try {
    const [areas, orgDay] = await Promise.all([
      loadProgramAreas(supabase, { activeOnly: true }),
      orgToday(supabase),
    ])
    activeProgramAreaSlugs = areas.map((a) => a.slug)
    today = orgDay
  } catch (err) {
    console.error('grant-proposal intake setup failed:', err instanceof Error ? err.message : err)
    return NextResponse.json(
      { error: 'Could not save your proposal. Please try again or email us.' },
      { status: 500 }
    )
  }

  const parsed = parseProposalSubmission(body, { activeProgramAreaSlugs, today })
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 422 })
  }

  const { error } = await supabase.from('grant_proposals').insert(parsed.row)

  if (error) {
    // Don't leak DB internals to a public caller; the proxy logs the rest.
    console.error('grant-proposal intake insert failed:', error.message)
    return NextResponse.json(
      { error: 'Could not save your proposal. Please try again or email us.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
