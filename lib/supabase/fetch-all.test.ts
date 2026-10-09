import { describe, expect, it } from 'vitest'
import { fetchAll, fetchByKeys } from './fetch-all'
import { createDemoClient } from './demo/mock-client'
import { getDemoStore } from './demo/store'

/** A fake PostgREST table that caps every response at `maxRows`, like max_rows */
function cappedTable(total: number, maxRows: number) {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }))
  const calls: [number, number][] = []
  return {
    calls,
    build: () => ({
      range(from: number, to: number) {
        calls.push([from, to])
        const end = Math.min(to + 1, from + maxRows)
        return Promise.resolve({ data: rows.slice(from, end), error: null })
      },
    }),
  }
}

describe('fetchAll', () => {
  it('pages past the server cap until a short page', async () => {
    const table = cappedTable(2500, 1000)
    const rows = await fetchAll<{ id: number }>(table.build)
    expect(rows).toHaveLength(2500)
    expect(rows.map((r) => r.id)).toEqual(Array.from({ length: 2500 }, (_, i) => i))
    expect(table.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('makes one extra request when the total is an exact multiple of the page size', async () => {
    const table = cappedTable(2000, 1000)
    expect(await fetchAll(table.build)).toHaveLength(2000)
    expect(table.calls).toHaveLength(3)
  })

  it('returns an empty list for an empty table', async () => {
    const table = cappedTable(0, 1000)
    expect(await fetchAll(table.build)).toEqual([])
    expect(table.calls).toHaveLength(1)
  })

  it('throws instead of returning a partial list', async () => {
    let page = 0
    const build = () => ({
      range: () =>
        Promise.resolve(
          page++ === 0
            ? { data: Array.from({ length: 3 }, (_, i) => ({ id: i })), error: null }
            : { data: null, error: { message: 'boom' } }
        ),
    })
    await expect(fetchAll(build, { pageSize: 3 })).rejects.toThrow(/boom/)
  })

  it('pages the demo client the same way', async () => {
    const store = getDemoStore()
    const saved = store.tables.tags
    store.tables.tags = Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, name: `tag ${i}` }))
    try {
      const demo = createDemoClient()
      const rows = await fetchAll<{ id: string }>(() => demo.from('tags').select('id, name').order('id'), {
        pageSize: 3,
      })
      expect(rows.map((r) => r.id)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5', 't6'])
    } finally {
      store.tables.tags = saved
    }
  })
})

describe('fetchByKeys', () => {
  it('looks keys up in chunks and de-duplicates them', async () => {
    const chunks: number[][] = []
    const rows = await fetchByKeys(
      [1, 2, 3, 3, 4, 5],
      (chunk: number[]) => {
        chunks.push(chunk)
        return Promise.resolve({ data: chunk.map((id) => ({ id })), error: null })
      },
      { chunkSize: 2 }
    )
    expect(chunks).toEqual([[1, 2], [3, 4], [5]])
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('makes no request for no keys', async () => {
    let called = false
    const rows = await fetchByKeys([], () => {
      called = true
      return Promise.resolve({ data: [], error: null })
    })
    expect(rows).toEqual([])
    expect(called).toBe(false)
  })
})
