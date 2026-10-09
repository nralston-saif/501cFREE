import { describe, expect, it } from 'vitest'
import {
  buildDeclineEmailSystemPrompt,
  buildDeclineEmailUserPrompt,
  type DeclineEmailInput,
} from './decline-email'
import type { AiOrgContext } from '@/lib/ai/org-context'

const ORG: AiOrgContext = {
  name: 'Example Foundation',
  legalName: null,
  mission: 'Improving literacy outcomes for children in rural communities.',
  programAreas: [{ label: 'Early literacy', description: 'Reading programs for ages 3-8' }],
  reviewerNames: ['Alex Rivera'],
}

function makeInput(overrides: Partial<DeclineEmailInput> = {}): DeclineEmailInput {
  return {
    applicantName: 'Pat Marlow',
    organizationName: 'BigSigns Media',
    title: 'Literacy awareness billboard campaign',
    summary: 'National billboards.',
    programAreaLabels: [],
    amountDollars: '200,000',
    declinedStage: 'review',
    decisionNotes: 'Outside our program areas.',
    reviewerComments: ['No measurable outcome — total vanity project.'],
    ...overrides,
  }
}

describe('buildDeclineEmailSystemPrompt', () => {
  it('carries the mission, program areas, sign-off and the never-quote-internal-notes rule', () => {
    const prompt = buildDeclineEmailSystemPrompt(ORG)
    expect(prompt).toContain(ORG.mission)
    expect(prompt).toContain('Early literacy: Reading programs for ages 3-8')
    expect(prompt).toMatch(/NEVER quote or paraphrase internal reviewer notes/)
    expect(prompt).toContain('The Example Foundation Team')
  })

  it('still builds without a recorded mission, telling the model not to guess', () => {
    const prompt = buildDeclineEmailSystemPrompt({ ...ORG, mission: null })
    expect(prompt).toContain('Mission: (not recorded)')
    expect(prompt).toMatch(/Do not guess the mission/)
  })

  it('keeps proposal-specific internal notes out of the system prompt', () => {
    expect(buildDeclineEmailSystemPrompt(ORG)).not.toContain('vanity project')
  })
})

describe('buildDeclineEmailUserPrompt', () => {
  it('includes the applicant, proposal, and declined stage', () => {
    const prompt = buildDeclineEmailUserPrompt(makeInput())
    expect(prompt).toContain('Pat Marlow')
    expect(prompt).toContain('BigSigns Media')
    expect(prompt).toContain('Literacy awareness billboard campaign')
    expect(prompt).toContain('initial review')
  })

  it('distinguishes a post-diligence decline', () => {
    const prompt = buildDeclineEmailUserPrompt(makeInput({ declinedStage: 'decision' }))
    expect(prompt).toContain('final decision (after full diligence)')
  })

  it('passes internal notes in the user turn for context', () => {
    const prompt = buildDeclineEmailUserPrompt(makeInput())
    expect(prompt).toContain('Decision notes: Outside our program areas.')
    expect(prompt).toContain('Reviewer comment: No measurable outcome — total vanity project.')
  })

  it('handles a proposal with no notes at all', () => {
    const prompt = buildDeclineEmailUserPrompt(
      makeInput({ decisionNotes: null, reviewerComments: [] })
    )
    expect(prompt).toContain('(none recorded)')
  })
})
