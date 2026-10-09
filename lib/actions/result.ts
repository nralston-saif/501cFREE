import { unstable_rethrow } from 'next/navigation'

// Server actions report failures by *returning* them, never by throwing.
// Next.js replaces the message of any error thrown out of a server action
// with a generic digest in production builds, so a thrown
// ActionError('No from-address configured…') reaches the browser as
// "Minified React error". Inside an action, throw ActionError as usual and
// wrap the exported function's body in runAction(); callers get an
// ActionResult and show `error` to the user.
//
// This module has no server-only imports, so client components can use
// unwrap() and the ActionResult type.

/** A failure whose message is safe and meant to be shown to the user. */
export class ActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionError'
  }
}

export type ActionFailure = { ok: false; error: string }
export type ActionResult<T = void> = { ok: true; data: T } | ActionFailure

export const GENERIC_ACTION_ERROR = 'Something went wrong. Please try again.'

/**
 * Run a server action body and convert failures into an ActionResult.
 * - ActionError → { ok: false, error: message }
 * - redirect()/notFound() and other Next control flow → rethrown
 * - anything else → logged, generic message (internal details never leak)
 */
export async function runAction<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    unstable_rethrow(err)
    return { ok: false, error: actionErrorMessage(err) }
  }
}

/**
 * The user-facing message for a caught error: an ActionError's own message,
 * otherwise `fallback` (the unexpected error is logged, never shown). For
 * actions that build their own result shape instead of using runAction.
 */
export function actionErrorMessage(err: unknown, fallback = GENERIC_ACTION_ERROR): string {
  if (err instanceof ActionError) return err.message
  console.error('[action] unexpected error:', err)
  return fallback
}

/**
 * Client-side: return the data of a successful result, or throw a plain
 * Error carrying the user-facing message, so existing try/catch + toast
 * handlers keep working.
 */
export function unwrap<T>(result: ActionResult<T>): T {
  // An action that redirect()s on success has no result to hand back; the
  // navigation is already under way, so there's nothing to report
  if (!result) return undefined as T
  if (!result.ok) throw new Error(result.error)
  return result.data
}

/** Server-side: re-raise a failed result as an ActionError (for action-to-action calls). */
export function unwrapAction<T>(result: ActionResult<T>): T {
  if (!result.ok) throw new ActionError(result.error)
  return result.data
}
