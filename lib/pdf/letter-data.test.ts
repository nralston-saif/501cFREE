import { describe, it, expect } from 'vitest'
import { buildLetterData } from './letter-data'
import type { Contribution, OrgSettings, StockContributionDetail } from '@/lib/supabase/types/database'
import { makeContact, makeOrgSettings } from '@/lib/testing/fixtures'

const settings = makeOrgSettings()

const contact = makeContact({
  kind: 'person',
  first_name: 'Jane',
  last_name: 'Donor',
  email: 'jane@example.com',
  address_line1: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62704',
  country: 'US',
  is_donor: true,
})

const orgContact = makeContact({
  kind: 'organization',
  // Display name is a short app label; the letter should use the official name.
  name: 'Northwind',
  legal_name: 'Northwind Holdings Ltd.',
  email: 'giving@northwind.example',
  is_donor: true,
})

const attention = makeContact({ kind: 'person', first_name: 'Diane', last_name: 'Stirling' })

function makeContribution(overrides: Partial<Contribution>): Contribution {
  return {
    id: 'k1',
    contact_id: 'c1',
    amount_cents: 50_000,
    received_date: '2026-05-01',
    method: 'check',
    vehicle: 'direct',
    vehicle_sponsor_name: null,
    in_kind_description: null,
    restriction: 'unrestricted',
    restriction_purpose: null,
    quid_pro_quo: false,
    goods_services_description: null,
    goods_services_value_cents: null,
    check_number: null,
    notes: null,
    entered_by: null,
    qbo_txn_type: null,
    qbo_txn_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('buildLetterData (IRS Pub 1771 branches)', () => {
  it('cash gift: short name, USD amount, deductibility, no-goods statement', () => {
    const data = buildLetterData(makeContribution({}), contact, settings, '2026-06-12')

    expect(data.orgLegalName).toBe('Example Foundation Inc.')
    expect(data.orgShortName).toBe('Example Foundation')
    expect(data.ein).toBe('00-0000000')
    expect(data.salutation).toBe('Dear Jane:')
    expect(data.giftParagraph).toContain('$500.00 USD')
    expect(data.giftParagraph).toContain('May 1, 2026')
    expect(data.deductibilityParagraph).toContain('501(c)(3)')
    expect(data.deductibilityParagraph).toContain('509(a)(1)')
    expect(data.deductibilityParagraph).toContain(
      'Example Foundation Inc. is a tax-exempt organization described in Section 501(c)(3)'
    )
    expect(data.deductibilityParagraph).toContain('deductible as charitable contributions')
    expect(data.goodsServicesParagraph).toContain(
      'did not provide any goods or services in exchange for this gift'
    )
    expect(data.inKindNote).toBeNull()
    expect(data.signatoryTitle).toBe('President, Example Foundation Inc.')
    // Recipient block: name + email, no Attention line, no postal address.
    expect(data.recipientLines).toEqual(['Jane Donor', 'Email: jane@example.com'])
  })

  it('organization donor: official name, attention + email block, third-person thanks', () => {
    const data = buildLetterData(
      makeContribution({}),
      orgContact,
      settings,
      '2026-06-12',
      null,
      attention
    )
    expect(data.salutation).toBe('Dear Diane:')
    expect(data.giftParagraph).toContain('from Northwind Holdings Ltd. on')
    expect(data.recipientLines).toEqual([
      'Northwind Holdings Ltd.',
      'Attention: Diane Stirling',
      'Email: giving@northwind.example',
    ])
  })

  it('organization donor without a contact person: greets the organization', () => {
    const data = buildLetterData(makeContribution({}), orgContact, settings, '2026-06-12')
    expect(data.salutation).toBe('Dear Northwind Holdings Ltd.:')
    expect(data.recipientLines).toEqual([
      'Northwind Holdings Ltd.',
      'Email: giving@northwind.example',
    ])
  })

  it('uses the display name from settings as the short name when set', () => {
    const data = buildLetterData(
      makeContribution({}),
      contact,
      { ...settings, org_display_name: 'Example Fdn' },
      '2026-06-12'
    )
    expect(data.orgShortName).toBe('Example Fdn')
  })

  it('quid pro quo gift includes description, good-faith estimate, and excess-deductibility language', () => {
    const data = buildLetterData(
      makeContribution({
        amount_cents: 25_000,
        quid_pro_quo: true,
        goods_services_description: 'two gala dinner tickets',
        goods_services_value_cents: 10_000,
      }),
      contact,
      settings,
      '2026-06-12'
    )

    expect(data.goodsServicesParagraph).toContain('two gala dinner tickets')
    expect(data.goodsServicesParagraph).toContain('$100.00')
    expect(data.goodsServicesParagraph).toContain('good-faith estimate')
    expect(data.goodsServicesParagraph).toContain(
      'Only the part of the gift that is more than that value can be deducted'
    )
    expect(data.goodsServicesParagraph).not.toContain('did not provide')
  })

  it('in-kind gift describes the property and never states a value', () => {
    const data = buildLetterData(
      makeContribution({
        method: 'in_kind',
        amount_cents: null,
        in_kind_description: 'one used laboratory centrifuge',
      }),
      contact,
      settings,
      '2026-06-12'
    )

    expect(data.giftParagraph).toContain('one used laboratory centrifuge')
    expect(data.giftParagraph).not.toContain('$')
    expect(data.inKindNote).toContain('does not state its value')
    expect(data.goodsServicesParagraph).toContain('did not provide any goods or services')
  })

  it('stock gift describes the securities and never states internal FMV', () => {
    const stockDetail: StockContributionDetail = {
      contribution_id: 'k1',
      security_name: 'Apple Inc. common stock',
      ticker_symbol: 'AAPL',
      cusip: '037833100',
      shares: 10,
      valuation_date: '2026-06-03',
      fmv_per_share_cents: 19_785,
      fmv_total_cents: 197_850,
      valuation_source: 'broker_statement',
      market_price_source: 'fmp',
      brokerage_account: null,
      transfer_received_date: '2026-06-03',
      sale_date: null,
      sale_gross_cents: null,
      sale_fees_cents: null,
      sale_net_cents: null,
      notes: null,
      created_at: '',
      updated_at: '',
    }

    const data = buildLetterData(
      makeContribution({
        method: 'stock',
        amount_cents: 197_850,
      }),
      contact,
      settings,
      '2026-06-12',
      stockDetail
    )

    expect(data.giftParagraph).toContain('10 shares of Apple Inc. common stock')
    expect(data.giftParagraph).toContain('AAPL')
    expect(data.inKindNote).toContain('does not state its value')
    expect(JSON.stringify(data)).not.toContain('$1,978.50')
    expect(JSON.stringify(data)).not.toContain('$197.85')
  })

  it('DAF grant: thanks the sponsor for a grant recommended by the donor, no deduction claim', () => {
    const data = buildLetterData(
      makeContribution({ vehicle: 'daf', vehicle_sponsor_name: 'Example Giving Fund' }),
      contact,
      settings,
      '2026-06-12'
    )
    expect(data.giftParagraph).toContain(
      'grant of $500.00 USD from Example Giving Fund, recommended by Jane Donor'
    )
    expect(data.deductibilityParagraph).toContain('501(c)(3)')
    expect(data.deductibilityParagraph).toContain('not separately deductible')
    expect(data.deductibilityParagraph).toContain('tax advisor')
    expect(data.deductibilityParagraph).not.toContain('deductible as charitable')
    expect(data.goodsServicesParagraph).toContain('to you or to anyone else')
  })

  it('DAF grant without a sponsor name falls back to "your donor-advised fund"', () => {
    const data = buildLetterData(makeContribution({ vehicle: 'daf' }), contact, settings, '2026-06-12')
    expect(data.giftParagraph).toContain('from your donor-advised fund, recommended by Jane Donor')
  })

  it('IRA QCD: excluded from income rather than deducted, no goods or services', () => {
    const data = buildLetterData(makeContribution({ vehicle: 'ira_qcd' }), contact, settings, '2026-06-12')
    expect(data.giftParagraph).toContain('as a qualified charitable distribution from your IRA')
    expect(data.deductibilityParagraph).toContain('excluded from taxable income rather than deducted')
    expect(data.deductibilityParagraph).toContain('tax advisor')
    expect(data.goodsServicesParagraph).toContain(
      'did not provide any goods or services in exchange for this distribution'
    )
  })

  it('refuses a quid pro quo on a DAF or QCD gift', () => {
    for (const vehicle of ['daf', 'ira_qcd'] as const) {
      expect(() =>
        buildLetterData(
          makeContribution({
            vehicle,
            quid_pro_quo: true,
            goods_services_description: 'dinner',
            goods_services_value_cents: 5_000,
          }),
          contact,
          settings,
          '2026-06-12'
        )
      ).toThrow(/cannot include goods or services/)
    }
  })

  it.each(['employer_match', 'private_foundation', 'charitable_trust', 'other'] as const)(
    '%s: thanks the paying organization and makes no deductibility claim',
    (vehicle) => {
      const data = buildLetterData(
        makeContribution({ vehicle, vehicle_sponsor_name: 'Contoso Corp' }),
        contact,
        settings,
        '2026-06-12'
      )
      expect(data.giftParagraph).toContain('We are grateful to Contoso Corp for its gift of $500.00 USD')
      expect(data.deductibilityParagraph).toBe(
        'Example Foundation Inc. is a tax-exempt organization described in Section 501(c)(3) of the Internal Revenue Code (the “Code”) and is a public charity described in Section 509(a)(1) of the Code.'
      )
      expect(data.goodsServicesParagraph).toContain('did not provide any goods or services')
    }
  )

  it('paying organization falls back to the donor on record', () => {
    const data = buildLetterData(
      makeContribution({ vehicle: 'private_foundation' }),
      orgContact,
      settings,
      '2026-06-12'
    )
    expect(data.giftParagraph).toContain('We are grateful to Northwind Holdings Ltd. for its gift')
  })

  it('a quid pro quo on an employer match still gets the good-faith estimate', () => {
    const data = buildLetterData(
      makeContribution({
        vehicle: 'employer_match',
        quid_pro_quo: true,
        goods_services_description: 'a table at the gala',
        goods_services_value_cents: 20_000,
      }),
      orgContact,
      settings,
      '2026-06-12'
    )
    expect(data.goodsServicesParagraph).toContain('good-faith estimate of their value is $200.00')
  })

  it('appends the IRS classification only when set', () => {
    const at = (public_charity_status: OrgSettings['public_charity_status']) =>
      buildLetterData(makeContribution({}), contact, { ...settings, public_charity_status }, '2026-06-12')
        .deductibilityParagraph

    expect(at('509a2')).toContain('public charity described in Section 509(a)(2)')
    expect(at('509a3')).toContain('supporting organization described in Section 509(a)(3)')
    expect(at('private_foundation')).toContain('private foundation within the meaning of Section 509(a)')
    const neutral = at(null)
    expect(neutral).toContain('Section 501(c)(3)')
    expect(neutral).not.toContain('509')
    expect(neutral).toContain('deductible as charitable contributions')
  })

  it('uses the wording saved in Settings, with placeholders filled in', () => {
    const data = buildLetterData(
      makeContribution({ vehicle: 'daf', vehicle_sponsor_name: 'Example Giving Fund' }),
      contact,
      {
        ...settings,
        letter_templates: {
          daf: { opening: '{sponsor} sent {gift} for {donor} to {orgShortName} on {date}.', tax: '' },
        },
      },
      '2026-06-12'
    )
    expect(data.giftParagraph).toBe(
      'Example Giving Fund sent $500.00 USD for Jane Donor to Example Foundation on May 1, 2026.'
    )
    // An emptied tax paragraph leaves the status sentence alone
    expect(data.deductibilityParagraph).toMatch(/of the Code\.$/)
    // Other vehicles keep the default
    const direct = buildLetterData(makeContribution({}), contact, { ...settings, letter_templates: { daf: { tax: '' } } }, '2026-06-12')
    expect(direct.deductibilityParagraph).toContain('deductible as charitable contributions')
  })

  it('throws when the legal name is missing', () => {
    expect(() =>
      buildLetterData(makeContribution({}), contact, { ...settings, org_legal_name: null }, '2026-06-12')
    ).toThrow(/legal name/)
  })

  it('throws when EIN is missing', () => {
    expect(() =>
      buildLetterData(makeContribution({}), contact, { ...settings, ein: null }, '2026-06-12')
    ).toThrow(/EIN/)
  })

  it('throws when signatory is missing', () => {
    expect(() =>
      buildLetterData(
        makeContribution({}),
        contact,
        { ...settings, letter_signatory_name: null },
        '2026-06-12'
      )
    ).toThrow(/signatory/)
  })
})
