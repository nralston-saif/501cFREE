import { describe, expect, it, vi } from 'vitest'
import { createDemoClient, splitOrTerms } from './mock-client'
import { DEMO_RESET_MS, getDemoStore } from './store'

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

describe('demo storage', () => {
  it('signs several paths at once, flagging missing files', async () => {
    const bucket = createDemoClient().storage.from('note-files')
    await bucket.upload('intake-1/a.txt', new Uint8Array([104, 105]), { contentType: 'text/plain' })
    const { data } = await bucket.createSignedUrls(['intake-1/a.txt', 'intake-1/missing.txt'])
    expect(data[0]).toMatchObject({ path: 'intake-1/a.txt', error: null })
    expect(data[0].signedUrl).toContain('/api/demo-files?key=')
    expect(data[1]).toMatchObject({ path: 'intake-1/missing.txt', signedUrl: null })
  })
})

describe('demo store reset', () => {
  it('reseeds after DEMO_RESET_MS', async () => {
    const client = createDemoClient()
    await client.from('tags').insert({ name: 'temporary' })
    expect(getDemoStore().tables.tags.some((t) => t.name === 'temporary')).toBe(true)
    vi.useFakeTimers()
    try {
      vi.setSystemTime(Date.now() + DEMO_RESET_MS + 1000)
      expect(getDemoStore().tables.tags.some((t) => t.name === 'temporary')).toBe(false)
      expect(getDemoStore().tables.qbo_inbox.length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('demo inserts', () => {
  it('fill in the column defaults Postgres would', async () => {
    const { data } = await createDemoClient().from('note_intakes').insert({ created_by: 'x' }).select('*').single()
    expect(data).toMatchObject({ status: 'uploading', note_ids: [] })
  })
})
