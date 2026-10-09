import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types/database'
import { getOrgSettings, orgName } from '@/lib/settings'
import { loadProgramAreas } from '@/lib/program-areas'
import { isVotingMember } from '@/lib/grants/voting'

// What the AI features know about the organization they work for. Everything
// comes from org settings, the program-areas table and the team list, so
// nothing about any particular organization is baked into the prompts.

export interface AiOrgContext {
  /** Display name, e.g. used in "the X team" sign-offs */
  name: string
  /** Legal name, when it differs from the display name */
  legalName: string | null
  /** org_settings.mission_statement; null when not yet recorded */
  mission: string | null
  programAreas: { label: string; description: string | null }[]
  /** The grant-review voting body (org_settings.grant_review_mode): who reviews and approves */
  reviewerNames: string[]
}

export async function loadAiOrgContext(supabase: SupabaseClient<Database>): Promise<AiOrgContext> {
  const [settings, areas, { data: members }] = await Promise.all([
    getOrgSettings(supabase),
    loadProgramAreas(supabase, { activeOnly: true }),
    supabase
      .from('team_members')
      .select('full_name, role')
      .eq('is_active', true)
      .order('full_name'),
  ])
  const reviewers = (members ?? []).filter((m) => isVotingMember(m, settings.grant_review_mode))
  const name = orgName(settings)
  return {
    name,
    legalName: settings.org_legal_name && settings.org_legal_name !== name ? settings.org_legal_name : null,
    mission: settings.mission_statement?.trim() || null,
    programAreas: areas.map((a) => ({ label: a.label, description: a.description })),
    reviewerNames: reviewers.map((m) => m.full_name).filter(Boolean),
  }
}

/**
 * The <organization> block shared by every prompt. When no mission statement
 * has been recorded the features still run: the model is told to judge fit
 * only against the program areas and the record itself, to flag mission-fit
 * statements for confirmation, and (via MISSING_MISSION_QUESTION) to ask the
 * team to record the mission.
 */
export function organizationBlock(ctx: AiOrgContext): string {
  const lines = [`Name: ${ctx.name}`]
  if (ctx.legalName) lines.push(`Legal name: ${ctx.legalName}`)
  lines.push(
    ctx.mission
      ? `Mission: ${ctx.mission}`
      : 'Mission: (not recorded). Do not guess the mission. Judge fit only against the program areas below and the record itself, and mark every mission-fit statement with [TO CONFIRM].'
  )
  if (ctx.programAreas.length > 0) {
    lines.push('Program areas:')
    for (const area of ctx.programAreas) {
      lines.push(`- ${area.label}${area.description ? `: ${area.description}` : ''}`)
    }
  }
  return `<organization>\n${lines.join('\n')}\n</organization>`
}

export const MISSING_MISSION_QUESTION =
  'No mission statement is recorded in Settings; add one so mission-fit analysis can be grounded in it.'

/** "the review team (Ana Ruiz, Sam Lee)" or just "the review team" */
export function reviewersPhrase(ctx: AiOrgContext): string {
  return ctx.reviewerNames.length > 0
    ? `the review team (${ctx.reviewerNames.join(', ')})`
    : 'the review team'
}
