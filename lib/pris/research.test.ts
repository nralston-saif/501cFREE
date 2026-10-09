import { describe, expect, it } from 'vitest'
import { parseResearchDraft } from './research'
import { PRI_MEMO_FIELDS } from './memo'

function fullAnswers(): Record<string, string> {
  return Object.fromEntries(PRI_MEMO_FIELDS.map(([key]) => [key, `Answer for ${key}`]))
}

describe('parseResearchDraft', () => {
  it('accepts a complete draft with sources and open questions', () => {
    const draft = parseResearchDraft({
      answers: fullAnswers(),
      sources: [{ url: 'https://example.com', title: 'Example' }],
      open_questions: ['Confirm the valuation cap'],
    })
    expect(Object.keys(draft.answers)).toHaveLength(PRI_MEMO_FIELDS.length)
    expect(draft.sources).toEqual([{ url: 'https://example.com', title: 'Example' }])
    expect(draft.open_questions).toEqual(['Confirm the valuation cap'])
  })

  it('rejects a draft missing an answer', () => {
    const answers = fullAnswers()
    delete answers.q_conflicts
    expect(() => parseResearchDraft({ answers, sources: [], open_questions: [] })).toThrow(
      /q_conflicts/
    )
  })

  it('rejects blank answers', () => {
    const answers = fullAnswers()
    answers.q_risks = '   '
    expect(() => parseResearchDraft({ answers, sources: [], open_questions: [] })).toThrow(
      /q_risks/
    )
  })

  it('tolerates malformed sources and open questions', () => {
    const draft = parseResearchDraft({
      answers: fullAnswers(),
      sources: [{ title: 'no url' }, 'junk', { url: 'https://ok.com' }],
      open_questions: [42, 'real question'],
    })
    expect(draft.sources).toEqual([{ url: 'https://ok.com', title: 'https://ok.com' }])
    expect(draft.open_questions).toEqual(['real question'])
  })

  it('trims answer whitespace', () => {
    const answers = fullAnswers()
    answers.q_exempt_purpose = '  padded  '
    const draft = parseResearchDraft({ answers, sources: [], open_questions: [] })
    expect(draft.answers.q_exempt_purpose).toBe('padded')
  })
})
