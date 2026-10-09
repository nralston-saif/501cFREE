import { describe, expect, it } from 'vitest'
import { parseGrantResearchDraft } from './research'
import { MEMO_SECTION_FIELDS } from './memo'

function fullAnswers(): Record<string, string> {
  return Object.fromEntries(MEMO_SECTION_FIELDS.map(([key]) => [key, `Answer for ${key}`]))
}

describe('parseGrantResearchDraft', () => {
  it('accepts a complete draft with header suggestions, sources, and open questions', () => {
    const draft = parseGrantResearchDraft({
      answers: fullAnswers(),
      header: {
        header_purpose: 'Support of the grantee’s program work',
        header_grantee_descriptor: 'a Delaware nonprofit corporation',
      },
      sources: [{ url: 'https://example.com', title: 'Example' }],
      open_questions: ['Confirm the installment schedule'],
    })
    expect(Object.keys(draft.answers)).toHaveLength(MEMO_SECTION_FIELDS.length)
    expect(draft.header.header_purpose).toBe('Support of the grantee’s program work')
    expect(draft.sources).toEqual([{ url: 'https://example.com', title: 'Example' }])
    expect(draft.open_questions).toEqual(['Confirm the installment schedule'])
  })

  it('accepts a draft with no header suggestions', () => {
    const draft = parseGrantResearchDraft({
      answers: fullAnswers(),
      sources: [],
      open_questions: [],
    })
    expect(draft.header).toEqual({})
  })

  it('never surfaces a header_decision suggestion', () => {
    const draft = parseGrantResearchDraft({
      answers: fullAnswers(),
      header: { header_decision: 'Approved unanimously' },
      sources: [],
      open_questions: [],
    })
    expect(draft.header).toEqual({})
  })

  it('rejects a draft missing a section', () => {
    const answers = fullAnswers()
    delete answers.q_counterfactual
    expect(() =>
      parseGrantResearchDraft({ answers, header: {}, sources: [], open_questions: [] })
    ).toThrow(/q_counterfactual/)
  })

  it('rejects blank sections', () => {
    const answers = fullAnswers()
    answers.q_risks_mitigations = '   '
    expect(() =>
      parseGrantResearchDraft({ answers, header: {}, sources: [], open_questions: [] })
    ).toThrow(/q_risks_mitigations/)
  })

  it('tolerates malformed sources and open questions', () => {
    const draft = parseGrantResearchDraft({
      answers: fullAnswers(),
      header: {},
      sources: [{ title: 'no url' }, 'junk', { url: 'https://ok.com' }],
      open_questions: [42, 'real question'],
    })
    expect(draft.sources).toEqual([{ url: 'https://ok.com', title: 'https://ok.com' }])
    expect(draft.open_questions).toEqual(['real question'])
  })

  it('trims answer and header whitespace', () => {
    const answers = fullAnswers()
    answers.q_summary_recommendation = '  padded  '
    const draft = parseGrantResearchDraft({
      answers,
      header: { header_purpose: '  general support  ' },
      sources: [],
      open_questions: [],
    })
    expect(draft.answers.q_summary_recommendation).toBe('padded')
    expect(draft.header.header_purpose).toBe('general support')
  })
})
