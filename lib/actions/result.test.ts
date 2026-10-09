import { afterEach, describe, expect, it, vi } from 'vitest'
import { notFound, redirect } from 'next/navigation'
import { ActionError, GENERIC_ACTION_ERROR, actionErrorMessage, runAction, unwrap } from './result'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runAction', () => {
  it('returns the value on success', async () => {
    await expect(runAction(async () => 42)).resolves.toEqual({ ok: true, data: 42 })
  })

  it('returns an ActionError message as the error, without logging', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runAction(async () => {
      throw new ActionError('No from-address configured. Set one in Settings.')
    })
    expect(result).toEqual({ ok: false, error: 'No from-address configured. Set one in Settings.' })
    expect(log).not.toHaveBeenCalled()
  })

  it('hides unexpected errors behind a generic message and logs them', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runAction(async () => {
      throw new Error('relation "secret_table" does not exist')
    })
    expect(result).toEqual({ ok: false, error: GENERIC_ACTION_ERROR })
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('treats thrown non-Error values as unexpected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = await runAction(async () => {
      throw { message: 'raw PostgrestError object', code: '42P01' }
    })
    expect(result).toEqual({ ok: false, error: GENERIC_ACTION_ERROR })
  })

  it('rethrows redirect() so Next can navigate', async () => {
    const promise = runAction(async () => {
      redirect('/contributions/123')
    })
    await expect(promise).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_REDIRECT') })
  })

  it('rethrows notFound()', async () => {
    const promise = runAction(async () => {
      notFound()
    })
    await expect(promise).rejects.toMatchObject({ digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') })
  })
})

describe('actionErrorMessage', () => {
  it('uses the fallback for unexpected errors', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(actionErrorMessage(new Error('internal'), 'Could not save')).toBe('Could not save')
    expect(actionErrorMessage(new ActionError('Only admins can do this'), 'Could not save')).toBe(
      'Only admins can do this'
    )
  })
})

describe('unwrap', () => {
  it('returns data or throws a plain Error with the message', () => {
    expect(unwrap({ ok: true, data: 'x' })).toBe('x')
    expect(() => unwrap({ ok: false, error: 'Nope' })).toThrow(new Error('Nope'))
  })
})
