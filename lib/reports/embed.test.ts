import { describe, expect, it } from 'vitest'
import { oneEmbed } from './embed'

describe('oneEmbed', () => {
  it('takes the first row of an array embed', () => {
    expect(oneEmbed([{ a: 1 }, { a: 2 }])).toEqual({ a: 1 })
    expect(oneEmbed([])).toBeNull()
  })

  it('passes an object embed through and maps missing to null', () => {
    expect(oneEmbed({ a: 1 })).toEqual({ a: 1 })
    expect(oneEmbed(null)).toBeNull()
    expect(oneEmbed(undefined)).toBeNull()
  })
})
