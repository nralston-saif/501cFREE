'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import { withBasePath } from '@/lib/basePath'
import { formatDate } from '@/lib/utils/dates'
import DemoResearchPanel from '@/components/DemoResearchPanel'
import { grantResearchReport, type DemoGrantResearchInput } from '@/lib/ai/demo-scripts'
import type { GrantResearch } from '@/lib/supabase/types/database'

interface Source {
  url: string
  title: string
}

function parseSources(raw: GrantResearch['sources']): Source[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((s) => {
    if (typeof s !== 'object' || s === null) return []
    const src = s as { url?: unknown; title?: unknown }
    if (typeof src.url !== 'string') return []
    return [{ url: src.url, title: typeof src.title === 'string' ? src.title : src.url }]
  })
}

function parseOpenQuestions(raw: GrantResearch['open_questions']): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((q): q is string => typeof q === 'string')
}

const DESCRIPTION =
  "Sends a research agent to read the applicant's proposal letter and the web, then draft all ten memorandum sections plus suggested header fields, with sources. You review, edit, and approve — the AI never fills the memo directly."

export default function MemoResearchPanel({
  proposalId,
  research,
  applicantName,
  demoInput = null,
}: {
  proposalId: string
  research: GrantResearch | null
  applicantName: string
  /** Demo mode without a key: show the pre-written sample, built in the browser */
  demoInput?: DemoGrantResearchInput | null
}) {
  if (demoInput) {
    return (
      <DemoResearchPanel
        subjectName={applicantName}
        description={DESCRIPTION}
        build={() => grantResearchReport(demoInput)}
      />
    )
  }
  return <LiveMemoResearchPanel proposalId={proposalId} research={research} applicantName={applicantName} />
}

function LiveMemoResearchPanel({
  proposalId,
  research,
  applicantName,
}: {
  proposalId: string
  research: GrantResearch | null
  applicantName: string
}) {
  const [isRunning, setIsRunning] = useState(research?.status === 'running')
  const router = useRouter()
  const { showToast } = useToast()

  const handleRun = async () => {
    setIsRunning(true)
    try {
      const res = await fetch(withBasePath(`/api/proposals/${proposalId}/research`), {
        method: 'POST',
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(body?.error ?? 'Research failed')
      }
      showToast('Research complete — drafts are ready in the memorandum below', 'success')
      router.refresh()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Research failed', 'error')
      router.refresh()
    } finally {
      setIsRunning(false)
    }
  }

  const sources = research?.status === 'complete' ? parseSources(research.sources) : []
  const openQuestions =
    research?.status === 'complete' ? parseOpenQuestions(research.open_questions) : []

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-2 gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-medium text-gray-900">AI research</h3>
        </div>
        <button
          type="button"
          onClick={handleRun}
          disabled={isRunning}
          className="btn btn-secondary text-xs"
        >
          {isRunning
            ? 'Researching…'
            : research?.status === 'complete'
              ? 'Re-run research'
              : 'Research & draft memo'}
        </button>
      </div>

      {isRunning ? (
        <p className="text-sm text-gray-500">
          Researching {applicantName} on the web and drafting the memorandum — this typically
          takes 4–7 minutes. Keep this page open.
        </p>
      ) : research?.status === 'complete' ? (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">
            Drafts from {formatDate(research.created_at.slice(0, 10))} are available in the
            memorandum below — open <span className="font-medium text-gray-700">Edit</span> to
            review each section, adjust it, and save. Nothing counts toward decision-readiness
            until a team member saves the memo.
          </p>
          {openQuestions.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                Flagged for confirmation
              </p>
              <ul className="list-disc pl-5 space-y-0.5">
                {openQuestions.map((q) => (
                  <li key={q} className="text-sm text-amber-800">
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {sources.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Sources</p>
              <ul className="space-y-0.5">
                {sources.map((s) => (
                  <li key={s.url} className="text-sm truncate">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-gray-700 hover:text-gray-900 underline"
                    >
                      {s.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : research?.status === 'failed' ? (
        <p className="text-sm text-red-600">
          Last run failed: {research.error ?? 'unknown error'}. Try again.
        </p>
      ) : (
        <p className="text-sm text-gray-500">{DESCRIPTION}</p>
      )}
    </div>
  )
}
