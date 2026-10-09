import type { GrantReviewMode, ProposalReview, TeamMemberRole } from '@/lib/supabase/types/database'

// Blind-voting helpers for the proposal pipeline. The voting body is set by
// org_settings.grant_review_mode: every active team member ('all_members',
// the default) or only active admins ('admins'). A proposal in 'in_review'
// hides everyone else's review until every voter has weighed in (voted or
// recused); the database then flips votes_revealed and the voters decide:
// advance to diligence or decline. The rules themselves live in the
// database (is_grant_voter() in migration 0005, triggers in 0009) so they
// hold for every client; these mirror them for the UI and action messages.
// Making the award and paying it stay admin-only in either mode.

export const GRANT_REVIEW_MODE_LABELS: Record<GrantReviewMode, string> = {
  all_members: 'Everyone on the team',
  admins: 'Admins only',
}

/** Whether a team member votes on proposals (pass active members only). */
export function isVotingMember(member: { role: TeamMemberRole }, mode: GrantReviewMode): boolean {
  return mode === 'all_members' || member.role === 'admin'
}

/** "every team member" / "every admin", for copy like "Votes reveal once ... has voted" */
export function votingBodyPhrase(mode: GrantReviewMode): string {
  return mode === 'all_members' ? 'everyone on the team' : 'every admin'
}

export type VotingMember = { id: string }
export type VotingReview = Pick<ProposalReview, 'reviewer_id' | 'vote' | 'recused'>

/** "2/3 votes in" from the set of members who have voted or recused */
export function progressFromWeighedIn(
  members: VotingMember[],
  weighedIn: Set<string> | undefined
): { submitted: number; total: number } {
  return {
    submitted: members.filter((m) => weighedIn?.has(m.id)).length,
    total: members.length,
  }
}
