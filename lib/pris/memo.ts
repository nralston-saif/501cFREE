import type { PriMemo } from '@/lib/supabase/types/database'

/**
 * Mission-alignment memo prompts for a program-related investment. All must
 * be answered before the PRI can be funded — this memo (plus the executed
 * instrument and board approval) is the record showing the investment was
 * made primarily in furtherance of the organization's exempt purposes.
 */
export const PRI_MEMO_FIELDS = [
  ['q_exempt_purpose', 'What charitable / exempt purpose does this investment further, and how?'],
  ['q_why_investment', 'Why is an investment the right structure rather than a grant?'],
  ['q_income_not_significant', 'Why is production of income or appreciation NOT a significant purpose of this investment?'],
  ['q_use_of_funds', 'How will the recipient use the funds?'],
  ['q_key_terms', 'Key terms of the instrument (amount, cap / discount, maturity, rights)?'],
  ['q_success_outcomes', 'If successful, what charitable outcomes result?'],
  ['q_risks', 'Major risks / failure modes, including loss of principal?'],
  ['q_exit_plan', 'What happens on conversion, repayment, or exit — how do proceeds return to charitable use?'],
  ['q_conflicts', 'Conflicts of interest (e.g. board, staff or affiliated-fund ties to the recipient) and how they are managed?'],
  ['q_monitoring', 'How will we monitor the investment and the recipient’s charitable performance?'],
] as const satisfies ReadonlyArray<readonly [keyof PriMemo, string]>

export type PriMemoKey = (typeof PRI_MEMO_FIELDS)[number][0]

export function isPriMemoComplete(memo: PriMemo | null | undefined): boolean {
  if (!memo) return false
  return PRI_MEMO_FIELDS.every(([key]) => {
    const value = memo[key]
    return typeof value === 'string' && value.trim().length > 0
  })
}

export function priMemoAnsweredCount(memo: PriMemo | null | undefined): number {
  if (!memo) return 0
  return PRI_MEMO_FIELDS.reduce((acc, [key]) => {
    const value = memo[key]
    return acc + (typeof value === 'string' && value.trim().length > 0 ? 1 : 0)
  }, 0)
}
