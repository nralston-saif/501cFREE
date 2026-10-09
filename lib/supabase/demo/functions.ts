// Demo-mode stand-ins for the database functions the app calls with rpc().
// Each mirrors its SQL definition (supabase/migrations/0009 and 0010) over
// the in-memory tables. The demo runs no RLS, so the demo user sees
// everything, like an admin.

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

const MEMO_SECTIONS = [
  'q_summary_recommendation',
  'q_org_background',
  'q_cause_area_fit',
  'q_theory_of_change',
  'q_grant_size_structure',
  'q_counterfactual',
  'q_success_disappointment',
  'q_risks_mitigations',
  'q_legal_compliance',
  'q_monitoring_evaluation',
] as const

const inRange = (value: unknown, start: unknown, end: unknown) =>
  typeof value === 'string' && value >= String(start) && value < String(end)

const cents = (value: unknown) => (typeof value === 'number' ? value : 0)

const sum = (rows: Row[], column: string) => rows.reduce((acc, r) => acc + cents(r[column]), 0)

const t = (tables: Tables, name: string) => tables[name] ?? []

export const DEMO_FUNCTIONS: Record<string, (tables: Tables, args: Record<string, unknown>) => Row[]> = {
  proposal_review_progress(tables, args) {
    const ids = new Set(args.p_proposal_ids as string[])
    return t(tables, 'proposal_reviews')
      .filter((r) => ids.has(r.proposal_id as string) && (r.recused || r.vote !== null))
      .map((r) => ({ proposal_id: r.proposal_id, reviewer_id: r.reviewer_id }))
  },

  fiscal_year_totals(tables, { p_start, p_end }) {
    return [
      {
        contributions_cents: sum(
          t(tables, 'contributions').filter(
            (c) => inRange(c.received_date, p_start, p_end) && c.method !== 'in_kind' && c.amount_cents != null
          ),
          'amount_cents'
        ),
        expenses_cents: sum(
          t(tables, 'expenses').filter((e) => inRange(e.expense_date, p_start, p_end)),
          'amount_cents'
        ),
        grants_paid_cents: sum(
          t(tables, 'disbursements').filter((d) => d.status === 'paid' && inRange(d.paid_date, p_start, p_end)),
          'amount_cents'
        ),
      },
    ]
  },

  contribution_summary(tables, { p_start, p_end }) {
    const rows = t(tables, 'contributions').filter((c) => inRange(c.received_date, p_start, p_end))
    const cash = rows.filter((c) => c.method !== 'in_kind' && c.method !== 'stock')
    const stock = rows.filter((c) => c.method === 'stock')
    return [
      {
        cash_cents: sum(cash, 'amount_cents'),
        cash_count: cash.length,
        stock_cents: sum(stock, 'amount_cents'),
        stock_count: stock.length,
      },
    ]
  },

  expense_summary(tables, { p_start, p_end }) {
    const classOf = new Map(t(tables, 'expense_categories').map((c) => [c.id, c.functional_class]))
    const expenses = t(tables, 'expenses')
    const period = expenses.filter((e) => inRange(e.expense_date, p_start, p_end))
    const inClass = (fc: string) => sum(period.filter((e) => classOf.get(e.category_id) === fc), 'amount_cents')
    const unpaid = expenses.filter((e) => e.status === 'pending')
    return [
      {
        total_cents: sum(period, 'amount_cents'),
        program_cents: inClass('program'),
        management_general_cents: inClass('management_general'),
        fundraising_cents: inClass('fundraising'),
        unpaid_count: unpaid.length,
        unpaid_cents: sum(unpaid, 'amount_cents'),
      },
    ]
  },

  contact_money_totals(tables, { p_kind }) {
    const totals = new Map<string, { granted_cents: number; donated_cents: number; pri_cents: number }>()
    const add = (id: unknown, key: 'granted_cents' | 'donated_cents' | 'pri_cents', amount: unknown) => {
      if (typeof id !== 'string') return
      const entry = totals.get(id) ?? { granted_cents: 0, donated_cents: 0, pri_cents: 0 }
      entry[key] += cents(amount)
      totals.set(id, entry)
    }
    for (const g of t(tables, 'grants_out')) add(g.grantee_contact_id, 'granted_cents', g.amount_awarded_cents)
    for (const c of t(tables, 'contributions')) add(c.contact_id, 'donated_cents', c.amount_cents)
    for (const p of t(tables, 'pris')) add(p.recipient_contact_id, 'pri_cents', p.amount_cents)
    const kindOf = new Map(t(tables, 'contacts').map((c) => [c.id, c.kind]))
    return [...totals.entries()]
      .filter(([id]) => p_kind == null || kindOf.get(id) === p_kind)
      .map(([contact_id, entry]) => ({ contact_id, ...entry }))
  },

  contact_note_counts(tables) {
    const notes = new Map<string, Set<unknown>>()
    for (const l of t(tables, 'note_links')) {
      if (l.entity_type !== 'contact') continue
      const set = notes.get(l.entity_id as string) ?? new Set()
      set.add(l.note_id)
      notes.set(l.entity_id as string, set)
    }
    return [...notes.entries()].map(([contact_id, set]) => ({ contact_id, note_count: set.size }))
  },

  proposal_memo_progress(tables, args) {
    const ids = new Set(args.p_proposal_ids as string[])
    return t(tables, 'proposal_memos')
      .filter((m) => ids.has(m.proposal_id as string))
      .map((m) => ({
        proposal_id: m.proposal_id,
        answered: MEMO_SECTIONS.filter((k) => typeof m[k] === 'string' && /\S/.test(m[k] as string)).length,
      }))
  },
}
