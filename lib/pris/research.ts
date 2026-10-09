import Anthropic from '@anthropic-ai/sdk'
import { PRI_MEMO_FIELDS, type PriMemoKey } from './memo'
import { FALLBACK_MODEL, RESEARCH_MODEL } from '@/lib/ai/models'
import {
  MISSING_MISSION_QUESTION,
  organizationBlock,
  reviewersPhrase,
  type AiOrgContext,
} from '@/lib/ai/org-context'

// Research agent that drafts the PRI mission-alignment memo: one Messages API
// call with server-side web search/fetch, structured JSON output, and (when
// attached) the executed instrument PDF. The result is a DRAFT — a team
// member reviews it in the memo editor; nothing here writes to pri_memos.

// The primary model's safety classifiers can occasionally false-positive on
// benign content in sensitive fields (e.g. health or security work). On a
// refusal we retry the whole run once on the fallback model.
const MAX_CONTINUATIONS = 8
const MAX_OUTPUT_TOKENS = 32000

export interface PriResearchInput {
  recipientName: string
  instrumentLabel: string
  amountDollars: string
  purpose: string | null
  notes: string | null
  investmentDate: string | null
  /** What the organization's own records say about this recipient, if anything (conflicts context). */
  crmContext: string | null
  /** The organization making the investment */
  org: AiOrgContext
  /** The executed instrument (or other attached PDF), if one is attached. */
  attachment: { base64Pdf: string; fileName: string } | null
}

export interface PriResearchDraft {
  answers: Record<PriMemoKey, string>
  sources: { url: string; title: string }[]
  open_questions: string[]
}

export function isPriResearchEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}

const ANSWER_PROPERTIES = Object.fromEntries(
  PRI_MEMO_FIELDS.map(([key, prompt]) => [key, { type: 'string', description: prompt }])
)

const OUTPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    answers: {
      type: 'object',
      description: 'Draft answers to the ten mission-alignment memo questions',
      properties: ANSWER_PROPERTIES,
      required: PRI_MEMO_FIELDS.map(([key]) => key),
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
  required: ['answers', 'sources', 'open_questions'],
  additionalProperties: false,
}

function buildPrompt(input: PriResearchInput): string {
  const facts = [
    `Recipient: ${input.recipientName}`,
    `Instrument: ${input.instrumentLabel}`,
    `Amount: $${input.amountDollars}`,
    input.investmentDate ? `Investment date: ${input.investmentDate}` : null,
    input.purpose ? `Stated purpose: ${input.purpose}` : null,
    input.notes ? `Internal notes: ${input.notes}` : null,
    input.crmContext ? `Existing records: ${input.crmContext}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const questionList = PRI_MEMO_FIELDS.map(([key, prompt]) => `- ${key}: ${prompt}`).join('\n')

  const org = input.org
  const reviewers = reviewersPhrase(org)

  return `You are drafting the internal mission-alignment memo for a program-related investment (PRI)
by ${org.name}. A PRI must be made primarily to further the charity's exempt purposes, with production
of income or appreciation not a significant purpose.

${organizationBlock(org)}

<investment>
${facts}
</investment>
${input.attachment ? `\nThe executed investment document ("${input.attachment.fileName}") is attached — use it as the authoritative source for the key terms.\n` : ''}
Research the recipient on the web: what it does, its team, its product and stage, recent
news, and how its work relates to ${org.name}'s mission. Also check whether it has raised from
commercial investors (relevant to the income-not-significant analysis and to conflicts).

Then draft an answer to each memo question:
${questionList}

Ground rules:
- These are DRAFTS for ${reviewers} to review, edit, and approve. Write in a
  direct, factual memo style — no hedging boilerplate, no marketing language.
- Where a question calls for the team's judgment (why an investment rather than a grant, whether
  income is a significant purpose, conflicts of interest, monitoring plans), draft the strongest
  reasonable starting position from the facts and mark anything you are assuming with [TO CONFIRM].
- Never invent facts about the recipient, its terms, or any relationship between ${org.name}'s
  people and the recipient. If the web gives you nothing on a point, say so and put it in open_questions.
- Cite only sources you actually used, and prefer primary sources (company site, filings,
  reputable press).${org.mission ? '' : `\n- Include this exact item in open_questions: "${MISSING_MISSION_QUESTION}"`}`
}

function buildContent(input: PriResearchInput): Anthropic.ContentBlockParam[] {
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

export function parseResearchDraft(raw: unknown): PriResearchDraft {
  if (typeof raw !== 'object' || raw === null) throw new Error('Research output was not an object')
  const obj = raw as Record<string, unknown>
  const answers = obj.answers
  if (typeof answers !== 'object' || answers === null) {
    throw new Error('Research output missing answers')
  }
  const answerMap = answers as Record<string, unknown>
  const out = {} as Record<PriMemoKey, string>
  for (const [key] of PRI_MEMO_FIELDS) {
    const value = answerMap[key]
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`Research output missing answer for ${key}`)
    }
    out[key] = value.trim()
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
  return { answers: out, sources, open_questions: openQuestions }
}

async function runOnModel(
  client: Anthropic,
  model: string,
  input: PriResearchInput
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

export interface PriResearchResult {
  draft: PriResearchDraft
  model: string
}

/**
 * Run the research agent. Throws with a user-facing message on failure —
 * callers record the error on the pri_research row.
 */
export async function runPriResearch(input: PriResearchInput): Promise<PriResearchResult> {
  if (!isPriResearchEnabled()) throw new Error('ANTHROPIC_API_KEY is not configured')
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

  return { draft: parseResearchDraft(JSON.parse(textBlock.text)), model }
}
