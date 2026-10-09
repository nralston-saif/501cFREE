import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { signContactImages } from '@/lib/contacts/images'
import { fetchAll } from '@/lib/supabase/fetch-all'
import type {
  ContributionMethod,
  DisbursementStatus,
  ExpenseStatus,
  GrantOutStatus,
  LetterStatus,
  PriInstrument,
  PriStatus,
  ProposalDecision,
  ProposalStatus,
} from '@/lib/supabase/types/database'

// Server-side loaders shared by the Organization and Person detail pages.

type Client = Awaited<ReturnType<typeof createClient>>

/**
 * Signed URLs for contacts' logos/photos. Never throws: falls back to
 * signing one at a time (the demo client has no batch signer), and paths
 * that fail are left out so callers show initials.
 */
export async function signImages(supabase: Client, paths: (string | null | undefined)[]): Promise<Map<string, string>> {
  try {
    return await signContactImages(supabase, paths)
  } catch {
    const urls = new Map<string, string>()
    const unique = [...new Set(paths.filter((p): p is string => !!p))]
    await Promise.all(
      unique.map(async (path) => {
        try {
          const { data } = await supabase.storage.from('documents').createSignedUrl(path, 3600)
          if (data?.signedUrl) urls.set(path, data.signedUrl)
        } catch {
          // leave it out
        }
      })
    )
    return urls
  }
}

export type FundingGrant = {
  id: string
  purpose: string | null
  amount_awarded_cents: number
  award_date: string | null
  status: GrantOutStatus
  paid_cents: number
  scheduled_cents: number
}

export type FundingProposal = {
  id: string
  title: string
  status: ProposalStatus
  decision: ProposalDecision | null
  amount_requested_cents: number | null
  date: string | null
}

export type FundingPri = {
  id: string
  instrument: PriInstrument
  purpose: string | null
  amount_cents: number
  status: PriStatus
  date: string | null
}

export type FundingContribution = {
  id: string
  received_date: string
  amount_cents: number | null
  method: ContributionMethod
  letter_status: LetterStatus | null
}

export type FundingExpense = {
  id: string
  expense_date: string
  amount_cents: number
  description: string
  status: ExpenseStatus
}

export type FundingData = {
  grants: FundingGrant[]
  proposals: FundingProposal[]
  pris: FundingPri[]
  contributions: FundingContribution[]
  /** null when the viewer isn't an admin (expenses are admin-only) */
  expenses: FundingExpense[] | null
}

type Embedded<T> = T | T[] | null | undefined

/** An embed PostgREST may return as an object (one-to-one) or an array. */
function embeddedList<T>(value: Embedded<T>): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

/** Every money record tied to a contact, newest first. */
export async function loadFunding(supabase: Client, contactId: string, isAdmin: boolean): Promise<FundingData> {
  type GrantRow = Omit<FundingGrant, 'paid_cents' | 'scheduled_cents'> & {
    disbursements: Embedded<{ amount_cents: number; status: DisbursementStatus }>
  }
  type ContributionRow = Omit<FundingContribution, 'letter_status'> & {
    letters: Embedded<{ status: LetterStatus }>
  }
  type ProposalRow = Omit<FundingProposal, 'date'> & { received_date: string | null; entered_date: string }
  type PriRow = Omit<FundingPri, 'date'> & { investment_date: string | null; funded_date: string | null }

  // One wave: disbursements and letters come embedded in their parent rows.
  // Each list is per contact but unbounded (a long-time donor or vendor can
  // pass max_rows), so every one is paged.
  const [grantRows, proposalRows, priRows, contributionRows, expenses] = await Promise.all([
    fetchAll<GrantRow>(() =>
      supabase
        .from('grants_out')
        .select(
          'id, purpose, amount_awarded_cents, award_date, status, created_at, disbursements:disbursements!grant_out_id(amount_cents, status)'
        )
        .eq('grantee_contact_id', contactId)
        .order('created_at', { ascending: false })
        .order('id')
    ),
    fetchAll<ProposalRow>(() =>
      supabase
        .from('grant_proposals')
        .select('id, title, status, decision, amount_requested_cents, received_date, entered_date')
        .eq('applicant_contact_id', contactId)
        .order('entered_date', { ascending: false })
        .order('id')
    ),
    fetchAll<PriRow>(() =>
      supabase
        .from('pris')
        .select('id, instrument, purpose, amount_cents, status, investment_date, funded_date, created_at')
        .eq('recipient_contact_id', contactId)
        .order('created_at', { ascending: false })
        .order('id')
    ),
    fetchAll<ContributionRow>(() =>
      supabase
        .from('contributions')
        .select('id, received_date, amount_cents, method, letters:acknowledgement_letters!contribution_id(status)')
        .eq('contact_id', contactId)
        .order('received_date', { ascending: false })
        .order('id')
    ),
    isAdmin
      ? fetchAll<FundingExpense>(() =>
          supabase
            .from('expenses')
            .select('id, expense_date, amount_cents, description, status')
            .eq('vendor_contact_id', contactId)
            .order('expense_date', { ascending: false })
            .order('id')
        )
      : null,
  ])

  const paid = new Map<string, number>()
  const scheduled = new Map<string, number>()
  for (const g of grantRows) {
    for (const d of embeddedList(g.disbursements)) {
      const bucket = d.status === 'paid' ? paid : d.status === 'scheduled' ? scheduled : null
      bucket?.set(g.id, (bucket.get(g.id) ?? 0) + d.amount_cents)
    }
  }
  const letters = new Map<string, LetterStatus>()
  for (const c of contributionRows) {
    const letter = embeddedList(c.letters)[0]
    if (letter) letters.set(c.id, letter.status)
  }

  return {
    grants: grantRows.map((g) => ({
      id: g.id,
      purpose: g.purpose,
      amount_awarded_cents: g.amount_awarded_cents,
      award_date: g.award_date,
      status: g.status,
      paid_cents: paid.get(g.id) ?? 0,
      scheduled_cents: scheduled.get(g.id) ?? 0,
    })),
    proposals: proposalRows.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      decision: p.decision,
      amount_requested_cents: p.amount_requested_cents,
      date: p.received_date ?? p.entered_date,
    })),
    pris: priRows.map((p) => ({
      id: p.id,
      instrument: p.instrument,
      purpose: p.purpose,
      amount_cents: p.amount_cents,
      status: p.status,
      date: p.funded_date ?? p.investment_date,
    })),
    contributions: contributionRows.map((c) => ({
      id: c.id,
      received_date: c.received_date,
      amount_cents: c.amount_cents,
      method: c.method,
      letter_status: letters.get(c.id) ?? null,
    })),
    expenses,
  }
}
