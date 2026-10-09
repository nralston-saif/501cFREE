import { Resend } from 'resend'
import { ActionError } from '@/lib/actions/result'

let client: Resend | null = null

export const EMAIL_NOT_CONFIGURED_MESSAGE =
  "Email isn't set up: add RESEND_API_KEY to the environment to send email from the app."

/** Whether outgoing email (Resend) is configured. Server only: reads the env. */
export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

/**
 * The Resend client. Throws an ActionError (shown to the user as-is by
 * runAction) when RESEND_API_KEY is missing; pages hide their send buttons
 * with isEmailConfigured() first.
 */
export function getResend(): Resend {
  if (!process.env.RESEND_API_KEY) {
    throw new ActionError(EMAIL_NOT_CONFIGURED_MESSAGE)
  }
  if (!client) {
    client = new Resend(process.env.RESEND_API_KEY)
  }
  return client
}
