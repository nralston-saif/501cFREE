import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types/database'

/**
 * Who has weighed in (voted or recused) on each proposal, never how. While
 * votes are blind the database only returns your own review, so progress
 * comes from the proposal_review_progress() function (migration 0009).
 */
export async function loadWeighedIn(
  supabase: SupabaseClient<Database>,
  proposalIds: string[]
): Promise<Map<string, Set<string>>> {
  const byProposal = new Map<string, Set<string>>()
  if (proposalIds.length === 0) return byProposal
  const { data, error } = await supabase.rpc('proposal_review_progress', {
    p_proposal_ids: proposalIds,
  })
  if (error) throw new Error(`Could not load review progress: ${error.message}`)
  for (const row of data ?? []) {
    const set = byProposal.get(row.proposal_id) ?? new Set<string>()
    set.add(row.reviewer_id)
    byProposal.set(row.proposal_id, set)
  }
  return byProposal
}
