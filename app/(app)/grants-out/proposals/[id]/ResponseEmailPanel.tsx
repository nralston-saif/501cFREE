'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { markResponseEmailSent, saveResponseEmailDraft } from '@/lib/actions/grants-out'
import { useToast } from '@/components/Toast'
import { formatDate } from '@/lib/utils/dates'
import { unwrap } from '@/lib/actions/result'
import { withBasePath } from '@/lib/basePath'

/**
 * The response email for a declined proposal. Auto-drafts via the AI route on
 * first view, then lets the team edit, copy, regenerate, and mark it sent
 * (sending happens from their own email client).
 */
export default function ResponseEmailPanel({
  proposalId,
  draft,
  sentAt,
  aiEnabled,
}: {
  proposalId: string
  draft: string | null
  sentAt: string | null
  aiEnabled: boolean
}) {
  const [text, setText] = useState(draft ?? '')
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const { showToast } = useToast()
  const router = useRouter()
  const autoStarted = useRef(false)

  const generate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch(withBasePath(`/api/proposals/${proposalId}/decline-email`), { method: 'POST' })
      const body = (await res.json()) as { draft?: string; error?: string }
      if (!res.ok || !body.draft) {
        throw new Error(body.error ?? 'Drafting failed')
      }
      setText(body.draft)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Drafting failed')
    } finally {
      setGenerating(false)
    }
  }

  // Draft automatically the first time someone opens a declined proposal
  // that has no response email yet.
  useEffect(() => {
    if (autoStarted.current || draft || sentAt || !aiEnabled) return
    autoStarted.current = true
    void generate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSave = () => {
    const formData = new FormData()
    formData.set('draft_response_email', text)
    startTransition(async () => {
      try {
        unwrap(await saveResponseEmailDraft(proposalId, formData))
        showToast('Draft saved', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not save draft', 'error')
      }
    })
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text)
    showToast('Copied to clipboard', 'success')
  }

  const handleMarkSent = () => {
    // Persist whatever is in the textarea first — the sent view shows the
    // saved draft, which should match what actually went out.
    const formData = new FormData()
    formData.set('draft_response_email', text)
    startTransition(async () => {
      try {
        unwrap(await saveResponseEmailDraft(proposalId, formData))
        unwrap(await markResponseEmailSent(proposalId))
        showToast('Marked as sent', 'success')
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Could not mark sent', 'error')
      }
    })
  }

  if (sentAt) {
    return (
      <div className="card p-5">
        <h3 className="font-medium text-gray-900 mb-2">Response email</h3>
        <p className="text-sm text-gray-500 mb-3">Sent {formatDate(sentAt.slice(0, 10))}.</p>
        {draft && (
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans bg-gray-50 rounded-lg p-3">
            {draft}
          </pre>
        )}
      </div>
    )
  }

  return (
    <div className="card p-5">
      <h3 className="font-medium text-gray-900 mb-1">Response email</h3>
      <p className="text-sm text-gray-500 mb-3">
        AI-drafted reply to the applicant. Edit as needed, copy it into your email client, then
        mark it sent.
      </p>

      {generating ? (
        <p className="text-sm text-gray-500 animate-pulse mb-3">Drafting response email…</p>
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={12}
          disabled={isPending}
          aria-label="Response email"
          placeholder={
            aiEnabled
              ? 'No draft yet — generate one or write your own.'
              : 'AI drafting is not configured — write the response here.'
          }
          className="input font-mono text-sm mb-3"
        />
      )}

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || generating}
          className="btn btn-primary"
        >
          {isPending ? 'Saving…' : 'Save draft'}
        </button>
        <button
          type="button"
          onClick={handleCopy}
          disabled={generating || text.trim() === ''}
          className="btn btn-secondary"
        >
          Copy
        </button>
        {aiEnabled && (
          <button
            type="button"
            onClick={generate}
            disabled={isPending || generating}
            className="btn btn-secondary"
          >
            {draft || text ? 'Regenerate' : 'Generate draft'}
          </button>
        )}
        <button
          type="button"
          onClick={handleMarkSent}
          disabled={isPending || generating || text.trim() === ''}
          className="btn btn-secondary ml-auto"
        >
          Mark as sent
        </button>
      </div>
    </div>
  )
}
