import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/types/database'
import { createDemoClient } from '@/lib/supabase/demo/mock-client'
import { getDemoStore } from '@/lib/supabase/demo/store'
import { loadContactOptions } from './options'

const demo = () => createDemoClient() as unknown as SupabaseClient<Database>

type Row = Record<string, unknown>

function contacts(): Row[] {
  return getDemoStore().tables.contacts as Row[]
}

function byName(rows: Row[]) {
  return [...rows].sort(
    (a, b) =>
      String(a.display_name).localeCompare(String(b.display_name)) || String(a.id).localeCompare(String(b.id))
  )
}

describe('loadContactOptions', () => {
  it('returns every contact as { id, display_name }, ordered by name', async () => {
    const options = await loadContactOptions(demo())
    expect(options.length).toBe(contacts().length)
    expect(options.map((o) => o.id)).toEqual(byName(contacts()).map((c) => c.id))
    for (const o of options) expect(typeof o.display_name).toBe('string')
  })

  it('pages past the page size without losing or repeating rows', async () => {
    const all = await loadContactOptions(demo())
    const paged = await loadContactOptions(demo(), { pageSize: 2 })
    expect(paged.map((o) => o.id)).toEqual(all.map((o) => o.id))
  })

  it('filters to vendors, a kind, or active contacts', async () => {
    const vendors = await loadContactOptions(demo(), { vendorsOnly: true })
    expect(vendors.map((o) => o.id)).toEqual(byName(contacts().filter((c) => c.is_vendor === true)).map((c) => c.id))
    expect(vendors.length).toBeGreaterThan(0)

    const orgs = await loadContactOptions(demo(), { kind: 'organization', activeOnly: true })
    expect(orgs.map((o) => o.id)).toEqual(
      byName(contacts().filter((c) => c.kind === 'organization' && c.is_active === true)).map((c) => c.id)
    )
  })
})
