import { describe, expect, it } from 'vitest'
import { splitOrTerms } from './mock-client'

describe('splitOrTerms', () => {
  it('splits on top-level commas', () => {
    expect(splitOrTerms('name.ilike.%a%,email.eq.x')).toEqual(['name.ilike.%a%', 'email.eq.x'])
  })

  it('keeps commas inside quoted values', () => {
    const pattern = JSON.stringify('%Smith, J%')
    expect(splitOrTerms(`display_name.ilike.${pattern},email.ilike.${pattern}`)).toEqual([
      `display_name.ilike."%Smith, J%"`,
      `email.ilike."%Smith, J%"`,
    ])
  })

  it('handles escaped quotes and backslashes inside quotes', () => {
    const value = JSON.stringify('a "b", c\\d')
    expect(splitOrTerms(`name.eq.${value},email.eq.y`)).toEqual([`name.eq.${value}`, 'email.eq.y'])
  })
})

describe('demo client', () => {
  it('resolves hinted embeds many-to-one and one-to-many', async () => {
    const { createDemoClient } = await import('./mock-client')
    const { getDemoStore } = await import('./store')
    const demo = createDemoClient()
    const grant = getDemoStore().tables.grants_out[0]
    const { data } = (await demo
      .from('grants_out')
      .select('id, grantee:contacts!grantee_contact_id(display_name), disbursements:disbursements!grant_out_id(amount_cents)')
      .eq('id', grant.id)
      .single()) as { data: { grantee: { display_name: string } | null; disbursements: { amount_cents: number }[] } }
    const contact = getDemoStore().tables.contacts.find((c) => c.id === grant.grantee_contact_id)
    expect(data.grantee?.display_name).toBe(contact?.display_name)
    expect(data.disbursements.length).toBe(
      getDemoStore().tables.disbursements.filter((d) => d.grant_out_id === grant.id).length
    )
  })

  it('pages rpc results and reports the full count', async () => {
    const { createDemoClient } = await import('./mock-client')
    const demo = createDemoClient()
    const all = (await demo.rpc('contact_money_totals', {}).order('contact_id')) as { data: { contact_id: string }[] }
    const page = (await demo.rpc('contact_money_totals', {}).order('contact_id').range(1, 2)) as {
      data: { contact_id: string }[]
    }
    expect(page.data).toEqual(all.data.slice(1, 3))
    const missing = (await demo.rpc('no_such_function', {})) as { error: { message: string } | null }
    expect(missing.error?.message).toMatch(/not available/)
  })
})
