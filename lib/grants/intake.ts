import type { Json } from '@/lib/supabase/types/database'

// Validation for the public grant-proposal intake endpoint. Pure so the
// hostile-input handling is unit-testable; the route stays a thin shell.

export interface ProposalSubmissionRow {
  applicant_contact_id: null
  applicant_name: string
  applicant_email: string
  organization_name: string | null
  title: string
  summary: string | null
  /** program_areas.slug values */
  program_areas: string[]
  amount_requested_cents: number | null
  received_date: string
  entered_date: string
  source: string
  status: 'received'
  origin: 'external'
  votes_revealed: false
  raw_submission: Json
}

export interface IntakeContext {
  /** Slugs of the organization's active program areas */
  activeProgramAreaSlugs: readonly string[]
  /** Today as YYYY-MM-DD in the organization's time zone */
  today: string
}

export type ParseResult =
  | { ok: true; row: ProposalSubmissionRow }
  | { ok: false; error: string }

// Trim, drop empties, and cap length so a hostile caller can't store megabytes.
function clip(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed.slice(0, max)
}

// Tolerate junk: an applicant may type "TBD" or a range. Returns null unless
// the input is a clean dollar figure; raw_submission preserves the raw string.
function parseAmountCents(input: unknown): number | null {
  if (typeof input !== 'string') return null
  const cleaned = input.replace(/[$,\s]/g, '')
  if (cleaned === '' || !/^\d+(\.\d+)?$/.test(cleaned)) return null
  const value = Number(cleaned)
  if (!Number.isFinite(value) || value < 0) return null
  return Math.round(value * 100)
}

// Keep only slugs of active program areas (in the caller's order, deduped);
// unknown or inactive values are dropped rather than rejecting the proposal.
function parseProgramAreas(input: unknown, active: readonly string[]): string[] {
  if (!Array.isArray(input)) return []
  const wanted = new Set(input.filter((v): v is string => typeof v === 'string'))
  return active.filter((slug) => wanted.has(slug))
}

export function parseProposalSubmission(
  body: Record<string, unknown>,
  ctx: IntakeContext
): ParseResult {
  const applicant_name = clip(body.applicant_name, 200)
  const applicant_email = clip(body.applicant_email, 320)
  const title = clip(body.title, 300)

  if (!applicant_name || !applicant_email || !title) {
    return { ok: false, error: 'Name, email, and proposal title are required' }
  }
  // Light sanity check; the form validates more strictly client-side.
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(applicant_email)) {
    return { ok: false, error: 'Please provide a valid email address' }
  }

  const today = ctx.today
  const program_areas = parseProgramAreas(body.program_areas, ctx.activeProgramAreaSlugs)

  // Echo the submission back clipped, field by field, so the raw record can't
  // smuggle in unbounded payloads under unexpected keys.
  const raw_submission: Json = {
    applicant_name,
    applicant_email,
    organization_name: clip(body.organization_name, 200),
    title,
    summary: clip(body.summary, 10_000),
    program_areas,
    amount_requested: clip(body.amount_requested, 100),
  }

  return {
    ok: true,
    row: {
      applicant_contact_id: null,
      applicant_name,
      applicant_email,
      organization_name: clip(body.organization_name, 200),
      title,
      summary: clip(body.summary, 10_000),
      program_areas,
      amount_requested_cents: parseAmountCents(body.amount_requested),
      received_date: today,
      entered_date: today,
      source: 'website',
      status: 'received',
      origin: 'external',
      votes_revealed: false,
      raw_submission,
    },
  }
}
