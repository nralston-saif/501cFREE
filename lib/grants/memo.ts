import type { ProposalMemo } from '@/lib/supabase/types/database'

// The 10 numbered sections of the Grant Memorandum, in print order.
// Headings are the exact section titles rendered in the generated PDF.
export const MEMO_SECTION_FIELDS = [
  ['q_summary_recommendation', 'Summary and recommendation'],
  ['q_org_background', 'Organization background'],
  ['q_cause_area_fit', 'Cause area and mission fit'],
  ['q_theory_of_change', 'Theory of change'],
  ['q_grant_size_structure', 'Grant size and structure'],
  ['q_counterfactual', 'Counterfactual'],
  ['q_success_disappointment', 'What success and disappointment look like'],
  ['q_risks_mitigations', 'Risks and mitigations'],
  ['q_legal_compliance', 'Legal and compliance diligence'],
  ['q_monitoring_evaluation', 'Monitoring and evaluation'],
] as const satisfies ReadonlyArray<readonly [keyof ProposalMemo, string]>

// Free-text rows of the memorandum's header table. Everything else in the
// header (grantee, contact, tax status, amount, key dates) is derived from
// record data at PDF time. These do NOT count toward decision-readiness:
// the Decision line in particular is written at/after decision time.
export const MEMO_HEADER_FIELDS = [
  ['header_grantee_descriptor', 'Grantee descriptor', 'e.g. "a Delaware nonprofit corporation"'],
  ['header_purpose', 'Purpose', 'Short phrase, e.g. "General support of the grantee’s program work"'],
  ['header_structure', 'Structure', 'Gift agreement + installment schedule in prose'],
  ['header_decision', 'Decision', 'e.g. "Approved at admin review on … X recused …"'],
] as const satisfies ReadonlyArray<readonly [keyof ProposalMemo, string, string]>

export type MemoSectionKey = (typeof MEMO_SECTION_FIELDS)[number][0]
export type MemoHeaderKey = (typeof MEMO_HEADER_FIELDS)[number][0]

export function isMemoComplete(memo: ProposalMemo | null | undefined): boolean {
  if (!memo) return false
  return MEMO_SECTION_FIELDS.every(([key]) => {
    const value = memo[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

export function memoAnsweredCount(memo: ProposalMemo | null | undefined): number {
  if (!memo) return 0
  return MEMO_SECTION_FIELDS.reduce((acc, [key]) => {
    const value = memo[key]
    return acc + (typeof value === 'string' && value.trim().length > 0 ? 1 : 0)
  }, 0)
}
