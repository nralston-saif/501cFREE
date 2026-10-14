import Anthropic from '@anthropic-ai/sdk'
import {
  MEMO_SECTION_FIELDS,
  MEMO_HEADER_FIELDS,
  type MemoSectionKey,
  type MemoHeaderKey,
} from './memo'
import { FALLBACK_MODEL, RESEARCH_MODEL } from '@/lib/ai/models'
import { DEMO_AI_MODEL, demoAiDelay, isAiAvailable, isScriptedAi } from '@/lib/ai/demo'
import { scriptedGrantResearch } from '@/lib/ai/demo-scripts'
import {
  MISSING_MISSION_QUESTION,
  organizationBlock,
  reviewersPhrase,
  type AiOrgContext,
} from '@/lib/ai/org-context'

// Research agent that drafts the Grant Memorandum sections for a proposal: one
// Messages API call with server-side web search/fetch, structured JSON output,
// and (when attached) the applicant's own proposal letter PDF. The result is a
// DRAFT — a team member reviews it in the memo editor; nothing here writes
// to proposal_memos.

// The primary model's safety classifiers can occasionally false-positive on
// benign content in sensitive fields (e.g. health or security work). On a
// refusal we retry the whole run once on the fallback model.
const MAX_CONTINUATIONS = 8
const MAX_OUTPUT_TOKENS = 32000

// Header fields the agent may suggest. header_decision is deliberately
// excluded — the decision line records what the team actually decided.
const DRAFTABLE_HEADER_KEYS = ['header_purpose', 'header_structure', 'header_grantee_descriptor'] as const satisfies readonly MemoHeaderKey[]
type DraftableHeaderKey = (typeof DRAFTABLE_HEADER_KEYS)[number]

export interface GrantResearchInput {
  applicantName: string
  title: string
  summary: string | null
  /** Labels of the program areas the proposal is tagged with */
  programAreaLabels: string[]
  amountDollars: string
  receivedDate: string | null
  source: string | null
  /** What the organization's own records say about this applicant, if anything (conflicts context). */
  crmContext: string | null
  /** The organization doing the grantmaking */
  org: AiOrgContext
  /** The applicant's proposal letter, if a PDF is attached. */
  attachment: { base64Pdf: string; fileName: string } | null
}

export interface GrantResearchDraft {
  answers: Record<MemoSectionKey, string>
  header: Partial<Record<DraftableHeaderKey, string>>
  sources: { url: string; title: string }[]
  open_questions: string[]
}

/** A key, or demo mode's scripted provider (lib/ai/demo.ts) */
export function isGrantResearchEnabled(): boolean {
  return isAiAvailable()
}

const SECTION_PROPERTIES = Object.fromEntries(
  MEMO_SECTION_FIELDS.map(([key, heading], index) => [
    key,
    { type: 'string', description: `Section ${index + 1}: ${heading}` },
  ])
)

const HEADER_PROPERTIES = Object.fromEntries(
  MEMO_HEADER_FIELDS.filter(([key]) =>
    (DRAFTABLE_HEADER_KEYS as readonly string[]).includes(key)
  ).map(([key, label, hint]) => [key, { type: 'string', description: `${label} — ${hint}` }])
)

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    answers: {
      type: 'object',
      description: 'Draft prose for the ten numbered memorandum sections',
      properties: SECTION_PROPERTIES,
      required: MEMO_SECTION_FIELDS.map(([key]) => key),
      additionalProperties: false,
    },
    header: {
      type: 'object',
      description: 'Suggested free-text header rows for the memorandum header table',
      properties: HEADER_PROPERTIES,
      required: [],
      additionalProperties: false,
    },
    sources: {
      type: 'array',
      description: 'Web sources actually relied on for the answers',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['url', 'title'],
        additionalProperties: false,
      },
    },
    open_questions: {
      type: 'array',
      description: 'Points the review team must confirm or decide themselves',
      items: { type: 'string' },
    },
  },
  required: ['answers', 'header', 'sources', 'open_questions'],
  additionalProperties: false,
}

function buildPrompt(input: GrantResearchInput): string {
  const facts = [
    `Applicant / grantee: ${input.applicantName}`,
    `Proposal title: ${input.title}`,
    `Amount requested: $${input.amountDollars}`,
    input.programAreaLabels.length > 0 ? `Program areas: ${input.programAreaLabels.join(', ')}` : null,
    input.receivedDate ? `Proposal received: ${input.receivedDate}` : null,
    input.source ? `Source: ${input.source}` : null,
    input.summary ? `Internal summary: ${input.summary}` : null,
    input.crmContext ? `Existing records: ${input.crmContext}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const sectionList = MEMO_SECTION_FIELDS.map(
    ([key, heading], index) => `- ${key}: Section ${index + 1}, "${heading}"`
  ).join('\n')

  const org = input.org
  const reviewers = reviewersPhrase(org)

  return `You are drafting ${org.name}'s internal Grant Memorandum for a grant proposal under
review. The memorandum is the permanent grant record: ten numbered prose sections plus a header
table. Model the tone on a rigorous foundation grant memo — direct, factual, honest about risks
and counterfactuals.

${organizationBlock(org)}

<proposal>
${facts}
</proposal>
${input.attachment ? `\nThe applicant's own proposal letter ("${input.attachment.fileName}") is attached — it is the authoritative source for what they are asking for and promising. Verify its factual claims (track record, team, figures) via web research rather than repeating them as established fact.\n` : ''}
Research the applicant organization on the web: what it does, its leadership and track record,
tax-exempt status, other funders, recent news, and how the proposed work relates to
${org.name}'s mission and program areas.

Then draft each memorandum section:
${sectionList}

Also suggest the free-text header rows where you have enough information:
- header_grantee_descriptor: a short legal descriptor, e.g. "a Delaware nonprofit corporation"
- header_purpose: a one-line purpose, e.g. "General support of the grantee's program work"
- header_structure: how the gift would be structured (agreement + installments), if the proposal
  implies one; otherwise omit it

Ground rules:
- These are DRAFTS for ${reviewers} to review, edit, and approve. Write in a
  direct, factual memo style — no hedging boilerplate, no marketing language.
- Where a section calls for the team's judgment (the recommendation, grant sizing, counterfactual,
  risk tolerance, monitoring plans), draft the strongest reasonable starting position from the
  facts and mark anything you are assuming with [TO CONFIRM].
- Never invent facts about the organization, its finances, its tax status, or ${org.name}'s own
  relationships with it. If the web gives you nothing on a point, say so and put it in open_questions.
- Cite only sources you actually used, and prefer primary sources (the org's site, IRS/state
  filings, reputable press).${org.mission ? '' : `\n- Include this exact item in open_questions: "${MISSING_MISSION_QUESTION}"`}`
}

function buildContent(input: GrantResearchInput): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = []
  if (input.attachment) {
    blocks.push({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: input.attachment.base64Pdf,
      },
    })
  }
  blocks.push({ type: 'text', text: buildPrompt(input) })
  return blocks
}

export function parseGrantResearchDraft(raw: unknown): GrantResearchDraft {
  if (typeof raw !== 'object' || raw === null) throw new Error('Research output was not an object')
  const obj = raw as Record<string, unknown>
  const answers = obj.answers
  if (typeof answers !== 'object' || answers === null) {
    throw new Error('Research output missing answers')
  }
  const answerMap = answers as Record<string, unknown>
  const out = {} as Record<MemoSectionKey, string>
  for (const [key] of MEMO_SECTION_FIELDS) {
    const value = answerMap[key]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Research output missing answer for ${key}`)
    }
    out[key] = value.trim()
  }
  const header: Partial<Record<DraftableHeaderKey, string>> = {}
  if (typeof obj.header === 'object' && obj.header !== null) {
    const headerMap = obj.header as Record<string, unknown>
    for (const key of DRAFTABLE_HEADER_KEYS) {
      const value = headerMap[key]
      if (typeof value === 'string' && value.trim() !== '') header[key] = value.trim()
    }
  }
  const sources = Array.isArray(obj.sources)
    ? obj.sources.flatMap((s) => {
        if (typeof s !== 'object' || s === null) return []
        const src = s as Record<string, unknown>
        if (typeof src.url !== 'string') return []
        return [{ url: src.url, title: typeof src.title === 'string' ? src.title : src.url }]
      })
    : []
  const openQuestions = Array.isArray(obj.open_questions)
    ? obj.open_questions.filter((q): q is string => typeof q === 'string')
    : []
  return { answers: out, header, sources, open_questions: openQuestions }
}

async function runOnModel(
  client: Anthropic,
  model: string,
  input: GrantResearchInput
): Promise<Anthropic.Message> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: buildContent(input) }]

  let response = await client.messages
    .stream({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      tools: [
        { type: 'web_search_20260209', name: 'web_search', max_uses: 12 },
        { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 12 },
      ],
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages,
    })
    .finalMessage()

  // Server-side tool loops can pause; resume until the turn completes.
  let continuations = 0
  while (response.stop_reason === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
    continuations += 1
    messages.push({ role: 'assistant', content: response.content })
    response = await client.messages
      .stream({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: [
          { type: 'web_search_20260209', name: 'web_search', max_uses: 12 },
          { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 12 },
        ],
        output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
        messages,
      })
      .finalMessage()
  }
  return response
}

export interface GrantResearchResult {
  draft: GrantResearchDraft
  model: string
}

/**
 * Run the research agent. Throws with a user-facing message on failure —
 * callers record the error on the grant_research row.
 */
export async function runGrantResearch(input: GrantResearchInput): Promise<GrantResearchResult> {
  if (!isGrantResearchEnabled()) throw new Error('ANTHROPIC_API_KEY is not configured')
  if (isScriptedAi()) {
    await demoAiDelay(input.applicantName)
    return { draft: scriptedGrantResearch(input), model: DEMO_AI_MODEL }
  }
  const client = new Anthropic()

  let model = RESEARCH_MODEL
  let response = await runOnModel(client, model, input)

  if (response.stop_reason === 'refusal') {
    model = FALLBACK_MODEL
    response = await runOnModel(client, model, input)
  }

  if (response.stop_reason === 'refusal') {
    throw new Error('The model declined this research request (safety classifiers)')
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Research output was truncated — try again')
  }
  if (response.stop_reason === 'pause_turn') {
    throw new Error('Research did not complete within the tool-use limit — try again')
  }

  const textBlock = [...response.content]
    .reverse()
    .find((block): block is Anthropic.TextBlock => block.type === 'text')
  if (!textBlock) throw new Error('Research returned no answer')

  return { draft: parseGrantResearchDraft(JSON.parse(textBlock.text)), model }
}
