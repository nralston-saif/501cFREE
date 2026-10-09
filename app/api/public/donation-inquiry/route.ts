import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { secretMatches } from '@/lib/security/secrets'
import type { GiftMethodPreference } from '@/lib/supabase/types/database'

// Public ingestion endpoint for your website's donate form. The public site
// never talks to Supabase directly: it forwards each submission here,
// server-to-server, with a shared secret. We insert via the service-role admin
// client (which bypasses RLS) because there is no signed-in user. Never
// cache — every call is a distinct write.
export const dynamic = 'force-dynamic'

const GIFT_METHODS: GiftMethodPreference[] = [
  'check',
  'wire_ach',
  'daf',
  'stock_crypto',
  'other',
]

// Trim, drop empties, and cap length so a hostile caller can't store megabytes.
function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed.slice(0, max)
}

// Mirror parseDollarsToCents, but tolerate junk: a donor may type "TBD", a
// range, or crypto units. Returns null unless the input is a clean dollar
// figure; amount_text always preserves the raw string regardless.
function parseAmountCents(input: unknown): number | null {
  if (typeof input !== 'string') return null
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Shared-secret gate: only the trusted website proxy knows this header, so
  // the endpoint isn't an open relay. A missing env secret fails closed.
  const expected = process.env.DONATION_INQUIRY_INGEST_SECRET
  if (!secretMatches(request.headers.get('x-inquiry-secret'), expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const name = clip(body.name, 200)
  const email = clip(body.email, 320)
  if (!name || !email) {
    return NextResponse.json(
      { error: 'Name and email are required' },
      { status: 422 }
    )
  }
  // Light sanity check; the form validates more strictly client-side.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json(
      { error: 'Please provide a valid email address' },
      { status: 422 }
    )
  }

  const rawMethod = typeof body.gift_method === 'string' ? body.gift_method : ''
  const gift_method: GiftMethodPreference = (
    GIFT_METHODS as string[]
  ).includes(rawMethod)
    ? (rawMethod as GiftMethodPreference)
    : 'other'

  const supabase = createAdminClient()
  const { error } = await supabase.from('donation_inquiries').insert({
    name,
    email,
    phone: clip(body.phone, 50),
    organization: clip(body.organization, 200),
    gift_method,
    amount_cents: parseAmountCents(body.amount),
    amount_text: clip(body.amount, 100),
    message: clip(body.message, 5000),
    status: 'new',
    source: 'website',
  })

  if (error) {
    // Don't leak DB internals to a public caller; the proxy logs the rest.
    console.error('donation-inquiry insert failed:', error.message)
    return NextResponse.json(
      { error: 'Could not save your inquiry. Please try again or email us.' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
