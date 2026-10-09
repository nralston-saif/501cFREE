import Anthropic from '@anthropic-ai/sdk'
import type { DeclinedStage } from '@/lib/supabase/types/database'
import { FALLBACK_MODEL, RESEARCH_MODEL } from '@/lib/ai/models'
import { organizationBlock, type AiOrgContext } from '@/lib/ai/org-context'

// Drafts the response email to a declined grant applicant. The draft lands in
// grant_proposals.draft_response_email for a team member to edit and send
// from their own email client — nothing here sends mail.

// The primary model's safety classifiers can occasionally false-positive on
// benign content in sensitive fields (e.g. health or security work). On a
// refusal we retry once on the fallback model.
const MAX_OUTPUT_TOKENS = 1500

export interface DeclineEmailInput {
  applicantName: string
  organizationName: string | null
  title: string
  summary: string | null
  /** Labels of the program areas the proposal is tagged with */
  programAreaLabels: string[]
  amountDollars: string | null
  declinedStage: DeclinedStage
  decisionNotes: string | null
  reviewerComments: string[]
}

export function isDeclineEmailEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

// Internal notes go in the user turn (facts about this proposal), never here.
export function buildDeclineEmailSystemPrompt(org: AiOrgContext): string {
  return `You draft response emails to grant applicants whose proposals ${org.name} has declined.

${organizationBlock(org)}

Email structure — always:
1. Greeting personalized with the applicant's name.
2. Genuine thanks for the proposal and the work behind it, acknowledging something specific and positive about it.
3. A clear, kind decline with a short, honest reason grounded in mission fit (the program areas) or grantmaking scope — specific enough to be useful, never harsh.
4. Brief, genuine well wishes for the work.
5. Sign-off: "Warmly,\nThe ${org.name} Team"

Ground rules:
- Warm, direct, and respectful — this is a nonprofit writing to people doing hard work, not a form letter.
- NEVER quote or paraphrase internal reviewer notes verbatim; they are context for you, not content for the applicant.
- Never promise future funding, invite a resubmission unless the internal notes explicitly suggest one, or give feedback detailed enough to start a debate.
- If no mission statement is recorded, keep the reason general ("outside our current grantmaking focus") rather than inventing one.
- Keep it short: 2-3 paragraphs.
- Output only the email: a "Subject:" line first, then a blank line, then the body. No commentary.`
}

export function buildDeclineEmailUserPrompt(input: DeclineEmailInput): string {
  const facts = [
    `Applicant: ${input.applicantName}`,
    input.organizationName ? `Organization: ${input.organizationName}` : null,
    `Proposal title: ${input.title}`,
    input.summary ? `Proposal summary: ${input.summary}` : null,
    input.programAreaLabels.length > 0
      ? `Program areas: ${input.programAreaLabels.join(', ')}`
      : 'Program areas: none selected',
    input.amountDollars ? `Amount requested: $${input.amountDollars}` : null,
    input.declinedStage === 'review'
      ? 'Declined at: initial review (before diligence)'
      : 'Declined at: final decision (after full diligence)',
  ]
    .filter(Boolean)
    .join('\n')

  const notes = [
    input.decisionNotes ? `Decision notes: ${input.decisionNotes}` : null,
    ...input.reviewerComments.map((c) => `Reviewer comment: ${c}`),
  ].filter(Boolean)

  return `Draft the decline email for this proposal.

<proposal>
${facts}
</proposal>

<internal_notes>
${notes.length > 0 ? notes.join('\n') : '(none recorded)'}
</internal_notes>`
}

export interface DeclineEmailResult {
  email: string
  model: string
}

/** Throws with a user-facing message on failure — the route reports it as-is. */
export async function generateDeclineEmail(
  input: DeclineEmailInput,
  org: AiOrgContext
): Promise<DeclineEmailResult> {
  if (!isDeclineEmailEnabled()) throw new Error('ANTHROPIC_API_KEY is not configured')
  const client = new Anthropic()

  const run = (model: string) =>
    client.messages.create({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: buildDeclineEmailSystemPrompt(org),
      messages: [{ role: 'user', content: buildDeclineEmailUserPrompt(input) }],
    })

  let model = RESEARCH_MODEL
  let response = await run(model)
  if (response.stop_reason === 'refusal') {
    model = FALLBACK_MODEL
    response = await run(model)
  }
  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined to draft this email (safety classifiers)')
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
  if (!text) throw new Error('The model returned no draft')

  return { email: text, model }
}
