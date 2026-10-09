import { describe, expect, it } from 'vitest'
import {
  buildLetterTemplateOverrides,
  DEFAULT_LETTER_TEMPLATES,
  letterTemplateGroup,
  parseLetterTemplateOverrides,
  renderLetterTemplate,
  resolveLetterTemplate,
  sponsorFallback,
  unknownPlaceholders,
} from './letter-templates'

const values = {
  orgLegalName: 'Example Foundation Inc.',
  orgShortName: 'Example Foundation',
  donor: 'Jane Donor',
  sponsor: 'Example Giving Fund',
  gift: '$500.00 USD',
  date: 'May 1, 2026',
}

describe('letter templates', () => {
  it('maps every vehicle to a group', () => {
    expect(letterTemplateGroup('direct')).toBe('direct')
    expect(letterTemplateGroup('daf')).toBe('daf')
    expect(letterTemplateGroup('ira_qcd')).toBe('ira_qcd')
    for (const v of ['employer_match', 'private_foundation', 'charitable_trust', 'other'] as const) {
      expect(letterTemplateGroup(v)).toBe('organization')
    }
  })

  it('falls back to a readable sponsor', () => {
    expect(sponsorFallback('daf', 'Jane Donor')).toBe('your donor-advised fund')
    expect(sponsorFallback('ira_qcd', 'Jane Donor')).toBe('your IRA')
    expect(sponsorFallback('organization', 'Contoso Corp')).toBe('Contoso Corp')
  })

  it('fills placeholders and leaves unknown ones as typed', () => {
    expect(renderLetterTemplate('{donor} gave {gift} on {date}.', values)).toBe(
      'Jane Donor gave $500.00 USD on May 1, 2026.'
    )
    expect(renderLetterTemplate('Hi {nope}', values)).toBe('Hi {nope}')
  })

  it('finds unknown placeholders', () => {
    expect(unknownPlaceholders('{donor} {amount} {amount} {}')).toEqual(['{amount}', '{}'])
    expect(unknownPlaceholders(DEFAULT_LETTER_TEMPLATES.daf.opening)).toEqual([])
  })

  it('resolves overrides field by field over the defaults', () => {
    const t = resolveLetterTemplate('daf', { daf: { tax: 'Custom.' } })
    expect(t.tax).toBe('Custom.')
    expect(t.opening).toBe(DEFAULT_LETTER_TEMPLATES.daf.opening)
    expect(resolveLetterTemplate('direct', null)).toEqual(DEFAULT_LETTER_TEMPLATES.direct)
  })

  it('reads stored JSON defensively', () => {
    expect(parseLetterTemplateOverrides([1, 2])).toEqual({})
    expect(parseLetterTemplateOverrides({ bogus: { opening: 'x' }, daf: { opening: 5, tax: 'T' } })).toEqual({
      daf: { tax: 'T' },
    })
  })

  it('saves only what differs from the defaults', () => {
    const input = structuredClone(DEFAULT_LETTER_TEMPLATES)
    expect(buildLetterTemplateOverrides(input)).toEqual({ ok: true, overrides: {} })
    input.ira_qcd.tax = '  Ask your advisor.  '
    expect(buildLetterTemplateOverrides(input)).toEqual({
      ok: true,
      overrides: { ira_qcd: { tax: 'Ask your advisor.' } },
    })
  })

  it('rejects unknown placeholders and an empty opening', () => {
    const bad = structuredClone(DEFAULT_LETTER_TEMPLATES)
    bad.daf.opening = 'Thanks {amount}'
    const result = buildLetterTemplateOverrides(bad)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('{amount}')

    const empty = structuredClone(DEFAULT_LETTER_TEMPLATES)
    empty.direct.opening = ' '
    expect(buildLetterTemplateOverrides(empty).ok).toBe(false)
  })
})
