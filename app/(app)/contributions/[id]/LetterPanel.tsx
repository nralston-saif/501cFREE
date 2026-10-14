'use client'

import { useTransition } from 'react'
import { generateLetter, sendLetter } from '@/lib/actions/letters'
import StatusBadge from '@/components/StatusBadge'
import { useToast } from '@/components/Toast'
import { withBasePath } from '@/lib/basePath'
import type { LetterStatus } from '@/lib/supabase/types/database'
import { unwrap } from '@/lib/actions/result'

interface LetterPanelProps {
  contributionId: string
  letter: { status: LetterStatus; sent_at: string | null; sent_to_email: string | null } | null
  hasEmail: boolean
  /** Outgoing email (Resend) is configured; otherwise sending is hidden */
  emailEnabled: boolean
  /** Demo mode: "sending" only marks the letter sent; no email goes out */
  emailDemo?: boolean
}

function formatSentDate(isoTimestamp: string): string {
  return new Date(isoTimestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export default function LetterPanel({ contributionId, letter, hasEmail, emailEnabled, emailDemo = false }: LetterPanelProps) {
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()

  const status = letter?.status ?? null
  const hasGenerated = status === 'generated' || status === 'sent'

  const handleGenerate = () => {
    startTransition(async () => {
      try {
        unwrap(await generateLetter(contributionId))
        showToast(hasGenerated ? 'Letter regenerated' : 'Letter generated', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not generate letter', 'error')
      }
    })
  }

  const handleSend = (resend: boolean) => {
    const message = emailDemo
      ? 'Demo: mark the letter as emailed? No email is sent.'
      : resend
        ? 'Resend the acknowledgement letter to the donor?'
        : 'Email the acknowledgement letter to the donor?'
    if (!confirm(message)) return

    startTransition(async () => {
      try {
        unwrap(await sendLetter(contributionId))
        showToast(emailDemo ? 'Marked as sent (demo: no email was sent)' : 'Letter emailed to donor', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not send letter', 'error')
      }
    })
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-medium text-gray-900">Acknowledgement letter</h3>
        {status ? (
          <StatusBadge status={status} />
        ) : (
          <span className="text-xs text-gray-400">Not generated</span>
        )}
      </div>

      {status === 'sent' && letter?.sent_at && (
        <p className="text-sm text-gray-600 mb-3">
          Sent to {letter.sent_to_email ?? 'donor'} on {formatSentDate(letter.sent_at)}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {status !== 'sent' && (
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isPending}
            className="btn btn-primary text-xs"
          >
            {isPending
              ? 'Working…'
              : status === 'generated'
                ? 'Regenerate'
                : 'Generate letter'}
          </button>
        )}

        {hasGenerated && (
          <a
            href={withBasePath(`/api/letters/${contributionId}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary text-xs"
          >
            Preview PDF
          </a>
        )}

        {hasGenerated && !emailEnabled && (
          <p className="text-xs text-gray-400">
            Email isn&apos;t set up (add RESEND_API_KEY), so download the PDF and send it yourself.
          </p>
        )}

        {hasGenerated && emailEnabled && emailDemo && (
          <p className="text-xs text-gray-500">
            Demo: email is off. The button below only marks the letter as sent; no email goes out.
          </p>
        )}

        {status === 'generated' && emailEnabled && (
          <>
            <button
              type="button"
              onClick={() => handleSend(false)}
              disabled={isPending || !hasEmail}
              className="btn btn-secondary text-xs"
            >
              Email to donor
            </button>
            {!hasEmail && (
              <p className="text-xs text-gray-400">
                Add an email address to this contact to send the letter.
              </p>
            )}
          </>
        )}

        {status === 'sent' && emailEnabled && (
          <button
            type="button"
            onClick={() => handleSend(true)}
            disabled={isPending || !hasEmail}
            className="btn btn-secondary text-xs"
          >
            {isPending ? 'Sending…' : 'Resend'}
          </button>
        )}
      </div>
    </div>
  )
}
